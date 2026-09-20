import { entriesDao } from "../../db/dao/entriesDao";
import { syncQueueDao } from "../../db/dao/syncQueueDao";
import { TranscriptionStatus } from "../../db/schema";
import { geminiService } from "./GeminiService";
import { googleDriveService } from "../drive/GoogleDriveService";
import * as FileSystem from "expo-file-system/legacy";

export type TranscriptionEvent = {
  entryId: string;
  status: TranscriptionStatus;
};

export type TranscriptionListener = (event: TranscriptionEvent) => void;

export class TranscriptionQueueService {
  private isProcessing = false;
  private listeners: Set<TranscriptionListener> = new Set();

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

  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const queuedEntries = await entriesDao.getQueuedEntries();
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

          // If connected to Google Drive, upload with updated title/summary/tags
          if (googleDriveService.getCurrentUser()) {
            const updated = await entriesDao.getEntryById(entry.id);
            if (updated) {
              await syncQueueDao.enqueue({
                entry_id: entry.id,
                action: "ANALYZE_AND_UPLOAD",
              });
              googleDriveService
                .uploadEntry(updated)
                .then(async () => {
                  await syncQueueDao.deleteByEntryId(entry.id);
                })
                .catch((uploadErr) => {
                  console.warn(
                    "Deferred background Drive upload after transcription:",
                    uploadErr,
                  );
                });
            }
          }
        } catch (error) {
          const errMessage = (error as Error).message || "";
          const isNetworkError =
            errMessage.includes("Network request failed") ||
            errMessage.includes("Failed to fetch") ||
            errMessage.includes("network") ||
            errMessage.includes("503") ||
            errMessage.includes("429");

          // Keep as queued if offline/network error so it can retry later
          const nextStatus: TranscriptionStatus = isNetworkError
            ? "queued"
            : "failed";

          await entriesDao.updateTranscriptionStatus(entry.id, nextStatus);
          this.notifyListeners({ entryId: entry.id, status: nextStatus });

          // If network error, stop processing further items in this run
          if (isNetworkError) {
            break;
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async retryEntry(entryId: string): Promise<void> {
    await entriesDao.updateTranscriptionStatus(entryId, "queued");
    this.notifyListeners({ entryId, status: "queued" });
    this.processQueue().catch((err) => {
      console.warn("Error processing queue on retry:", err);
    });
  }
}

export const transcriptionQueueService = new TranscriptionQueueService();
