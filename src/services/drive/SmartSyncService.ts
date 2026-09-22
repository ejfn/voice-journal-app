import { AppState, AppStateStatus } from "react-native";
import { googleDriveService } from "./GoogleDriveService";
import { uploadQueueService } from "./UploadQueueService";
import { entriesDao } from "../../db/dao/entriesDao";
import { settingsDao } from "../../db/dao/settingsDao";

export type SmartSyncStatus = "idle" | "syncing" | "synced" | "error";

export type SmartSyncEvent = {
  status: SmartSyncStatus;
  uploadedCount?: number;
  downloadedCount?: number;
  error?: string;
  timestamp: number;
};

export type SmartSyncListener = (event: SmartSyncEvent) => void;

export class SmartSyncService {
  private isSyncing = false;
  private pendingSync = false;
  private lastSyncTime = 0;
  private listeners: Set<SmartSyncListener> = new Set();
  private appStateSubscription: { remove: () => void } | null = null;
  private periodicInterval: ReturnType<typeof setInterval> | null = null;

  // Minimum cooldown between full sync scans (20 seconds) unless forced
  private readonly COOLDOWN_MS = 20_000;
  // Periodic sync interval when app is active (2 minutes)
  private readonly PERIODIC_INTERVAL_MS = 120_000;

  addListener(listener: SmartSyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: SmartSyncEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn("SmartSync listener error:", err);
      }
    }
  }

  getIsSyncing(): boolean {
    return this.isSyncing;
  }

  getLastSyncTime(): number {
    return this.lastSyncTime;
  }

  /**
   * Starts automatic smart syncing:
   * 1. Listens for AppState transitions to 'active' (foreground)
   * 2. Runs periodic sync while app is active
   */
  startAutoSync(): void {
    this.stopAutoSync();

    // App foreground listener
    this.appStateSubscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          this.sync({ reason: "app_foreground" }).catch((err) => {
            console.warn("Auto-sync on foreground error:", err);
          });
        }
      },
    );

    // Periodic sync interval
    this.periodicInterval = setInterval(() => {
      this.sync({ reason: "periodic" }).catch((err) => {
        console.warn("Periodic smart sync error:", err);
      });
    }, this.PERIODIC_INTERVAL_MS);

    // Initial sync on start
    this.sync({ reason: "startup" }).catch((err) => {
      console.warn("Initial smart sync error:", err);
    });
  }

  stopAutoSync(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    if (this.periodicInterval) {
      clearInterval(this.periodicInterval);
      this.periodicInterval = null;
    }
  }

  /**
   * Performs smart two-way synchronization:
   * - Deletions processed
   * - Missing cloud items downloaded
   * - Local unsynced items uploaded via UploadQueueService / syncTwoWay
   * - LRU cache pruned
   */
  async sync(options?: {
    force?: boolean;
    reason?: string;
  }): Promise<{ uploadedCount: number; downloadedCount: number }> {
    // Only sync if user is signed into Google Drive
    if (!googleDriveService.getCurrentUser()) {
      return { uploadedCount: 0, downloadedCount: 0 };
    }

    const now = Date.now();
    const isForced = Boolean(options?.force);

    // Cooldown check (prevent rapid duplicate Drive API polling)
    if (!isForced && now - this.lastSyncTime < this.COOLDOWN_MS) {
      return { uploadedCount: 0, downloadedCount: 0 };
    }

    // Concurrency guard: coalesce overlapping sync requests
    if (this.isSyncing) {
      this.pendingSync = true;
      return { uploadedCount: 0, downloadedCount: 0 };
    }

    this.isSyncing = true;
    this.notifyListeners({ status: "syncing", timestamp: Date.now() });

    try {
      // Auto-purge expired binned entries (30-day policy) before sync phases
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      await entriesDao.purgeExpiredBinnedEntries(thirtyDaysAgo);

      // Run two-way sync (deletions, download missing, upload unsynced)
      const result = await googleDriveService.syncTwoWay();
      await googleDriveService.runLruEviction();

      // Trigger upload queue to process any items
      await uploadQueueService.processQueue();

      this.lastSyncTime = Date.now();
      await settingsDao.setSetting("last_synced_at", String(this.lastSyncTime));

      this.notifyListeners({
        status: "synced",
        uploadedCount: result.uploadedCount,
        downloadedCount: result.downloadedCount,
        timestamp: this.lastSyncTime,
      });

      return result;
    } catch (error) {
      const errMsg = (error as Error).message || "Smart sync failed";
      this.notifyListeners({
        status: "error",
        error: errMsg,
        timestamp: Date.now(),
      });
      if (isForced) {
        throw error;
      } else {
        console.warn(`[SmartSync] ${options?.reason || "auto"} error:`, errMsg);
        return { uploadedCount: 0, downloadedCount: 0 };
      }
    } finally {
      this.isSyncing = false;
      // If another sync was requested while running, run follow-up sync
      if (this.pendingSync) {
        this.pendingSync = false;
        setTimeout(() => {
          this.sync({ force: true, reason: "coalesced_followup" }).catch(
            (err) => {
              console.warn("Followup smart sync error:", err);
            },
          );
        }, 1000);
      }
    }
  }
}

export const smartSyncService = new SmartSyncService();
