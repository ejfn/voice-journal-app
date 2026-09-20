import { entriesDao } from "../../db/dao/entriesDao";
import { TranscriptionStatus } from "../../db/schema";
import { geminiService } from "./GeminiService";
import { uploadQueueService } from "../drive/UploadQueueService";
import * as FileSystem from "expo-file-system/legacy";

export type TranscriptionEvent = {
  entryId: string;
  status: TranscriptionStatus;
};

export type TranscriptionListener = (event: TranscriptionEvent) => void;

/**
 * Graduated backoff intervals for failed transcriptions:
 * Attempt 1: 5s
 * Attempt 2: 15s
 * Attempt 3: 45s
 * Attempt 4: 2m (120s)
 * Attempt 5: 5m (300s)
 */
export const BACKOFF_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

export const MAX_TRANSCRIPTION_RETRIES = BACKOFF_DELAYS_MS.length;

export function getBackoffDelayMs(retryCount: number): number {
  const index = Math.min(Math.max(0, retryCount), BACKOFF_DELAYS_MS.length - 1);
  return BACKOFF_DELAYS_MS[index];
}

export class TranscriptionQueueService {
  private isProcessing = false;
  private listeners: Set<TranscriptionListener> = new Set();
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;

  addListener(listener: TranscriptionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: TranscriptionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn("Transcription listener error:", err);
      }
    }
  }

  getIsProcessing(): boolean {
    return this.isProcessing;
  }

  scheduleNextRetry(targetTime: number): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    const delay = Math.max(100, targetTime - Date.now());
    this.retryTimeout = setTimeout(() => {
      this.processQueue().catch((err) => {
        console.warn("Scheduled queue retry error:", err);
      });
    }, delay);
  }

  cancelScheduledRetry(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    // Auto-transcription is disabled when key is unprovided
    const hasKey = await geminiService.hasKeyConfigured();
    if (!hasKey) {
      return;
    }

    this.isProcessing = true;

    try {
      const now = Date.now();
      const queuedEntries = await entriesDao.getQueuedEntries(now);

      for (const entry of queuedEntries) {
        // If entry has no local audio or file does not exist, mark failed
        if (!entry.local_audio_path) {
          await entriesDao.updateTranscriptionStatus(entry.id, "failed");
          this.notifyListeners({ entryId: entry.id, status: "failed" });
          continue;
        }

        try {
          const fileInfo = await FileSystem.getInfoAsync(
            entry.local_audio_path,
          );
          if (!fileInfo.exists) {
            await entriesDao.updateTranscriptionStatus(entry.id, "failed");
            this.notifyListeners({ entryId: entry.id, status: "failed" });
            continue;
          }
        } catch {
          // If filesystem check fails, attempt analysis anyway
        }

        // Mark as actively processing
        await entriesDao.updateTranscriptionStatus(entry.id, "processing");
        this.notifyListeners({ entryId: entry.id, status: "processing" });

        try {
          const aiResult = await geminiService.analyzeAudio(
            entry.local_audio_path,
          );

          await entriesDao.updateTranscription(entry.id, {
            title: aiResult.title,
            summary: aiResult.summary,
            transcript: aiResult.transcript,
            tags: aiResult.tags,
            transcription_status: "completed",
          });

          this.notifyListeners({ entryId: entry.id, status: "completed" });

          // Enqueue for background Google Drive upload with updated title/summary/tags
          uploadQueueService.enqueueUpload(entry.id, "METADATA_ONLY");
        } catch (error) {
          const errMessage = (error as Error).message || "";
          const isInvalidKey =
            errMessage.includes("API key not valid") ||
            errMessage.includes("API_KEY_INVALID") ||
            errMessage.includes("Gemini API key is not configured") ||
            errMessage.includes("API key expired");

          if (isInvalidKey) {
            // Unprovided or invalid key disables auto-transcription immediately without backoff retries
            await entriesDao.recordTranscriptionFailure(
              entry.id,
              entry.transcription_retry_count ?? 0,
              null,
              "failed",
            );
            this.notifyListeners({ entryId: entry.id, status: "failed" });
            break;
          }

          const currentRetries = entry.transcription_retry_count ?? 0;
          const hasMoreRetries = currentRetries < MAX_TRANSCRIPTION_RETRIES;

          if (hasMoreRetries) {
            const backoffMs = getBackoffDelayMs(currentRetries);
            const nextRetryAt = Date.now() + backoffMs;

            await entriesDao.recordTranscriptionFailure(
              entry.id,
              currentRetries + 1,
              nextRetryAt,
              "queued",
            );
            this.notifyListeners({ entryId: entry.id, status: "queued" });
            this.scheduleNextRetry(nextRetryAt);
          } else {
            // Exceeded maximum retry attempts; mark as failed
            await entriesDao.recordTranscriptionFailure(
              entry.id,
              currentRetries,
              null,
              "failed",
            );
            this.notifyListeners({ entryId: entry.id, status: "failed" });
          }

          const isNetworkError =
            errMessage.includes("Network request failed") ||
            errMessage.includes("Failed to fetch") ||
            errMessage.includes("network") ||
            errMessage.includes("503") ||
            errMessage.includes("429");

          // Stop processing remaining items in this batch if network is unreachable
          if (isNetworkError) {
            break;
          }
        }
      }
    } finally {
      this.isProcessing = false;

      // Check if there are other scheduled items pending in the future
      try {
        const nextScheduledTime = await entriesDao.getNextScheduledRetryTime(
          Date.now(),
        );
        if (nextScheduledTime) {
          this.scheduleNextRetry(nextScheduledTime);
        }
      } catch {
        // Ignore DB check error
      }
    }
  }

  async retryEntry(entryId: string): Promise<void> {
    await entriesDao.resetTranscriptionRetry(entryId);
    this.notifyListeners({ entryId, status: "queued" });
    this.processQueue().catch((err) => {
      console.warn("Error processing queue on retry:", err);
    });
  }
}

export const transcriptionQueueService = new TranscriptionQueueService();
