import { entriesDao } from "../../db/dao/entriesDao";
import { syncQueueDao } from "../../db/dao/syncQueueDao";
import { googleDriveService } from "./GoogleDriveService";
import { SyncQueueItem } from "../../db/schema";

export type UploadEvent = {
  entryId: string;
  status: "uploading" | "synced" | "failed";
};

export type UploadListener = (event: UploadEvent) => void;

/**
 * Graduated backoff intervals for failed uploads:
 * Attempt 1: 5s
 * Attempt 2: 15s
 * Attempt 3: 45s
 * Attempt 4: 2m (120s)
 * Attempt 5: 5m (300s)
 */
export const UPLOAD_BACKOFF_DELAYS_MS = [
  5_000, 15_000, 45_000, 120_000, 300_000,
];

export const MAX_UPLOAD_RETRIES = UPLOAD_BACKOFF_DELAYS_MS.length;

export function getUploadBackoffDelayMs(retryCount: number): number {
  const index = Math.min(
    Math.max(0, retryCount),
    UPLOAD_BACKOFF_DELAYS_MS.length - 1,
  );
  return UPLOAD_BACKOFF_DELAYS_MS[index];
}

export class UploadQueueService {
  private isProcessing = false;
  private listeners: Set<UploadListener> = new Set();
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeUploadingEntryIds: Set<string> = new Set();

  addListener(listener: UploadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: UploadEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn("Upload listener error:", err);
      }
    }
  }

  getIsProcessing(): boolean {
    return this.isProcessing;
  }

  isEntryUploading(entryId: string): boolean {
    return this.activeUploadingEntryIds.has(entryId);
  }

  scheduleNextRetry(targetTime: number): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    const delay = Math.max(100, targetTime - Date.now());
    this.retryTimeout = setTimeout(() => {
      this.processQueue().catch((err) => {
        console.warn("Scheduled upload queue retry error:", err);
      });
    }, delay);
  }

  cancelScheduledRetry(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  /**
   * Enqueues an entry for upload and triggers queue processing.
   */
  async enqueueUpload(
    entryId: string,
    action: SyncQueueItem["action"] = "ANALYZE_AND_UPLOAD",
  ): Promise<void> {
    const existing = await syncQueueDao.getItemByEntryId(entryId);
    if (existing) {
      await syncQueueDao.updateStatus(existing.id, "PENDING", 0);
    } else {
      await syncQueueDao.enqueue({
        entry_id: entryId,
        action,
        status: "PENDING",
      });
    }

    this.processQueue().catch((err) => {
      console.warn("Background upload queue error after enqueue:", err);
    });
  }

  /**
   * Ensures no missed uploads by scanning for all unsynced entries in SQLite
   * (never uploaded, or local edits made after last sync timestamp) and enqueuing them.
   */
  async enqueueAllUnsynced(): Promise<void> {
    if (!googleDriveService.getCurrentUser()) {
      return;
    }

    try {
      const unsynced = await entriesDao.getUnsyncedEntries();
      for (const entry of unsynced) {
        const action: SyncQueueItem["action"] = entry.drive_audio_file_id
          ? "METADATA_ONLY"
          : "ANALYZE_AND_UPLOAD";

        const existing = await syncQueueDao.getItemByEntryId(entry.id);
        if (existing) {
          if (
            existing.status !== "PENDING" &&
            existing.status !== "PROCESSING"
          ) {
            await syncQueueDao.updateStatus(existing.id, "PENDING", 0);
          }
        } else {
          await syncQueueDao.enqueue({
            entry_id: entry.id,
            action,
            status: "PENDING",
          });
        }
      }

      this.processQueue().catch((err) => {
        console.warn("Error processing upload queue for unsynced:", err);
      });
    } catch (err) {
      console.warn("Failed to enqueue unsynced entries:", err);
    }
  }

  /**
   * Processes the upload queue sequentially.
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    // Only upload when user is signed into Google Drive
    if (!googleDriveService.getCurrentUser()) {
      return;
    }

    this.isProcessing = true;

    try {
      // 1. First sync any unsynced entries into sync_queue table
      const unsynced = await entriesDao.getUnsyncedEntries();
      for (const entry of unsynced) {
        const existing = await syncQueueDao.getItemByEntryId(entry.id);
        if (!existing) {
          const action: SyncQueueItem["action"] = entry.drive_audio_file_id
            ? "METADATA_ONLY"
            : "ANALYZE_AND_UPLOAD";
          await syncQueueDao.enqueue({
            entry_id: entry.id,
            action,
            status: "PENDING",
          });
        }
      }

      // 2. Fetch pending items
      const pendingItems = await syncQueueDao.getPendingItems();

      for (const item of pendingItems) {
        // Re-check user sign-in status
        if (!googleDriveService.getCurrentUser()) {
          break;
        }

        const entry = await entriesDao.getEntryById(item.entry_id);
        if (!entry) {
          // Entry was deleted locally; remove from sync queue
          await syncQueueDao.deleteItem(item.id);
          continue;
        }

        // Mark as actively processing
        await syncQueueDao.updateStatus(item.id, "PROCESSING");
        this.activeUploadingEntryIds.add(entry.id);
        this.notifyListeners({ entryId: entry.id, status: "uploading" });

        try {
          // Upload audio and sidecar to Google Drive
          await googleDriveService.uploadEntry(entry);

          // Mark completed and remove from queue
          await syncQueueDao.deleteItem(item.id);
          this.activeUploadingEntryIds.delete(entry.id);
          this.notifyListeners({ entryId: entry.id, status: "synced" });
        } catch (error) {
          this.activeUploadingEntryIds.delete(entry.id);
          const currentRetries = item.retry_count ?? 0;
          const hasMoreRetries = currentRetries < MAX_UPLOAD_RETRIES;

          if (hasMoreRetries) {
            const nextRetries = currentRetries + 1;
            await syncQueueDao.updateStatus(item.id, "PENDING", nextRetries);
            this.notifyListeners({ entryId: entry.id, status: "uploading" });

            const backoffMs = getUploadBackoffDelayMs(currentRetries);
            const nextRetryAt = Date.now() + backoffMs;
            this.scheduleNextRetry(nextRetryAt);
          } else {
            // Exceeded max retries; mark failed
            await syncQueueDao.updateStatus(item.id, "FAILED", currentRetries);
            this.notifyListeners({ entryId: entry.id, status: "failed" });
          }

          const errMessage = (error as Error).message || "";
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
    }
  }
}

export const uploadQueueService = new UploadQueueService();
