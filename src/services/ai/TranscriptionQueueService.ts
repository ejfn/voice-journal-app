import { entriesDao } from "../../db/dao/entriesDao";
import { TranscriptionStatus } from "../../db/schema";
import { geminiService } from "./GeminiService";
import { File } from "expo-file-system";

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
        const isCloudEntry = Boolean(
          entry.drive_audio_file_id || entry.drive_sidecar_file_id,
        );

        // Never attempt transcription on cloud-only entries until downloaded to local
        if (entry.is_audio_cached === 0 && isCloudEntry) {
          continue;
        }

        // If entry has no local audio path, check if it's cloud-only or genuinely missing
        if (!entry.local_audio_path) {
          if (isCloudEntry) {
            if (entry.is_audio_cached !== 0) {
              await entriesDao.setAudioCached(entry.id, false, null);
            }
            continue;
          }
          await entriesDao.updateTranscriptionStatus(entry.id, "failed");
          this.notifyListeners({ entryId: entry.id, status: "failed" });
          continue;
        }

        let fileExists = false;
        try {
          const audioFile = new File(entry.local_audio_path);
          fileExists = audioFile.exists;
        } catch {
          fileExists = false;
        }

        if (!fileExists) {
          if (isCloudEntry) {
            if (entry.is_audio_cached !== 0) {
              await entriesDao.setAudioCached(entry.id, false, null);
            }
            continue;
          }
          await entriesDao.updateTranscriptionStatus(entry.id, "failed");
          this.notifyListeners({ entryId: entry.id, status: "failed" });
          continue;
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
