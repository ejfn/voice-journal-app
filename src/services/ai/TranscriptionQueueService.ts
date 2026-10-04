import { entriesDao } from "../../db/dao/entriesDao";
import {
  JournalEntry,
  TranscriptionCheckpoint,
  TranscriptionStatus,
} from "../../db/schema";
import { GeminiAnalysisResult, geminiService } from "./GeminiService";
import { Directory, File, Paths } from "expo-file-system";
import { VoiceRecorder } from "voice-recorder";

export type TranscriptionEvent = {
  entryId: string;
  status: TranscriptionStatus;
};

export type TranscriptionListener = (event: TranscriptionEvent) => void;

export const LONG_AUDIO_THRESHOLD_SEC = 600; // 10 minutes
export const CHUNK_DURATION_MS = 300_000; // 5 minutes

export function buildContextTail(text: string, maxChars = 350): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const slice = trimmed.slice(-maxChars);
  const firstSpace = slice.indexOf(" ");
  if (firstSpace > 0 && firstSpace < 60) {
    return slice.slice(firstSpace + 1).trim();
  }
  return slice.trim();
}

export async function isLongAudioEntry(entry: JournalEntry): Promise<boolean> {
  if (entry.transcription_checkpoint) {
    return true;
  }

  if (entry.duration_sec && entry.duration_sec > LONG_AUDIO_THRESHOLD_SEC) {
    return true;
  }

  if (!entry.duration_sec || entry.duration_sec <= 0) {
    if (!entry.local_audio_path) {
      return false;
    }

    // Large files (> 15 MB) are definitely long audio (or high-bitrate long recordings)
    try {
      const file = new File(entry.local_audio_path);
      if (file.exists && file.size && file.size > 15 * 1024 * 1024) {
        return true;
      }
    } catch {
      // Non-fatal
    }

    // Probe native duration via MediaExtractor
    try {
      const durationMs = await VoiceRecorder.getAudioDuration(
        entry.local_audio_path,
      );
      const durationSec = Math.round(durationMs / 1000);
      if (durationSec > 0) {
        entry.duration_sec = durationSec;
        await entriesDao.updateDuration(entry.id, durationSec);
        if (durationSec > LONG_AUDIO_THRESHOLD_SEC) {
          return true;
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return false;
}

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

  async transcribeLongAudio(
    entry: JournalEntry,
  ): Promise<GeminiAnalysisResult> {
    if (!entry.local_audio_path) {
      throw new Error(`No local audio path for entry ${entry.id}`);
    }

    let checkpoint: TranscriptionCheckpoint =
      entry.transcription_checkpoint || {
        totalChunks: 1,
        completedChunks: 0,
        partialTranscript: "",
        lastContextTail: "",
      };

    const cacheDir = Paths.cache?.uri || "";
    const chunksDir = `${cacheDir.replace(/\/+$/, "")}/chunks_${entry.id}`;

    let isFinished = false;
    try {
      while (!isFinished) {
        const chunkIndex = checkpoint.completedChunks;
        const startTimeMs = chunkIndex * CHUNK_DURATION_MS;

        const chunkResult = await VoiceRecorder.extractAudioChunk(
          entry.local_audio_path,
          startTimeMs,
          CHUNK_DURATION_MS,
          chunksDir,
        );

        // If chunk extraction failed on long audio, do NOT fall back to analyzeAudio!
        // Throw retryable error so it remains in queue with exponential backoff.
        if (!chunkResult || !chunkResult.chunkUri) {
          throw new Error(
            `Unable to extract audio chunk ${chunkIndex} for long audio entry ${entry.id}`,
          );
        }

        const chunkUri = chunkResult.chunkUri;
        try {
          const chunkText = await geminiService.transcribeChunk(
            chunkUri,
            checkpoint.lastContextTail,
          );

          const stitched: string = checkpoint.partialTranscript
            ? `${checkpoint.partialTranscript.trim()} ${chunkText.trim()}`.trim()
            : chunkText.trim();

          const lastContextTail = buildContextTail(stitched, 350);

          const estimatedTotal =
            chunkResult.totalDurationMs > 0
              ? Math.max(
                  Math.ceil(chunkResult.totalDurationMs / CHUNK_DURATION_MS),
                  chunkIndex + 1,
                )
              : chunkIndex + (chunkResult.isLastChunk ? 1 : 2);

          checkpoint = {
            totalChunks: estimatedTotal,
            completedChunks: chunkIndex + 1,
            partialTranscript: stitched,
            lastContextTail,
          };

          // Save checkpoint to DB FIRST
          await entriesDao.updateTranscriptionCheckpoint(entry.id, checkpoint);
        } finally {
          // Always delete the processed chunk from disk so failed retries do not leak cache files
          try {
            const chunkFile = new File(chunkUri);
            if (chunkFile.exists) {
              chunkFile.delete();
            }
          } catch {
            // Non-fatal
          }
        }

        if (chunkResult.isLastChunk) {
          isFinished = true;
        }
      }
    } finally {
      try {
        const dir = new Directory(chunksDir);
        if (dir.exists) {
          dir.delete();
        }
      } catch {
        // Non-fatal
      }
    }

    const finalTranscript = checkpoint.partialTranscript.trim();
    const promptTranscript =
      finalTranscript || "No speech detected in recording.";
    const analysis = await geminiService.analyzeTranscript(promptTranscript);

    return {
      title: analysis.title,
      summary: analysis.summary,
      tags: analysis.tags,
      transcript: finalTranscript,
    };
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
          const isLongAudio = await isLongAudioEntry(entry);

          const aiResult = isLongAudio
            ? await this.transcribeLongAudio(entry)
            : await geminiService.analyzeAudio(entry.local_audio_path);

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
