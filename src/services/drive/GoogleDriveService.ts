import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { Directory, File, UploadType } from "expo-file-system";
import { deletedEntriesDao } from "../../db/dao/deletedEntriesDao";
import { entriesDao } from "../../db/dao/entriesDao";
import { settingsDao } from "../../db/dao/settingsDao";
import { syncQueueDao } from "../../db/dao/syncQueueDao";
import { JournalEntry } from "../../db/schema";
import { getEntryAudioPath } from "../../utils/paths";

export interface DriveFolderInfo {
  id: string;
  name: string;
}

/**
 * Per-entry transfer events fired only around real Drive I/O
 * (uploadEntry / downloadAudioOnDemand). Scan/list passes do not emit these.
 */
export type DriveTransferEvent = {
  entryId: string;
  status:
    | "uploading"
    | "downloading"
    | "uploaded"
    | "downloaded"
    | "synced"
    | "failed";
};

export type DriveTransferListener = (event: DriveTransferEvent) => void;

export class GoogleDriveService {
  private folderIdCache: Map<string, string> = new Map();
  private isConfigured: boolean = false;
  private transferListeners: Set<DriveTransferListener> = new Set();

  addTransferListener(listener: DriveTransferListener): () => void {
    this.transferListeners.add(listener);
    return () => {
      this.transferListeners.delete(listener);
    };
  }

  private notifyTransferListeners(event: DriveTransferEvent): void {
    for (const listener of this.transferListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn("Drive transfer listener error:", err);
      }
    }
  }

  configure(webClientId?: string): void {
    if (this.isConfigured) return;
    this.reconfigure(webClientId);
  }

  reconfigure(webClientId?: string): void {
    const clientId =
      webClientId || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    GoogleSignin.configure({
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      webClientId: clientId,
    });
    this.isConfigured = true;
  }

  getCurrentUser(): { email: string; name: string | null } | null {
    try {
      const user = GoogleSignin.getCurrentUser();
      if (user?.user) {
        return {
          email: user.user.email,
          name: user.user.name,
        };
      }
    } catch {
      // Ignore
    }
    return null;
  }

  async signIn(): Promise<string> {
    return this.getAccessToken();
  }

  async getAccessToken(): Promise<string> {
    this.configure();
    await GoogleSignin.hasPlayServices();
    try {
      const tokens = await GoogleSignin.getTokens();
      if (tokens.accessToken) {
        return tokens.accessToken;
      }
    } catch {
      // Prompt sign in if no valid session
    }

    await GoogleSignin.signIn();
    const tokens = await GoogleSignin.getTokens();
    return tokens.accessToken;
  }

  async signOut(): Promise<void> {
    try {
      await GoogleSignin.signOut();
      this.folderIdCache.clear();
    } catch {
      // Ignore sign out error
    }
  }

  /**
   * Finds or creates a folder under parentId.
   */
  async getOrCreateFolder(
    name: string,
    parentId: string = "root",
    token: string,
  ): Promise<string> {
    const cacheKey = `${parentId}:${name}`;
    if (this.folderIdCache.has(cacheKey)) {
      return this.folderIdCache.get(cacheKey)!;
    }

    const query = encodeURIComponent(
      `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and '${parentId}' in parents and trashed = false`,
    );
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        const id = data.files[0].id;
        this.folderIdCache.set(cacheKey, id);
        return id;
      }
    }

    // Create folder if not found
    const createUrl = "https://www.googleapis.com/drive/v3/files";
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create Google Drive folder "${name}": ${err}`);
    }

    const created = await createRes.json();
    this.folderIdCache.set(cacheKey, created.id);
    return created.id;
  }

  /**
   * Resolves the hierarchical folder path: VoiceJournal / YYYY / MM
   */
  async resolveMonthFolder(
    year: number | string,
    month: number | string,
    token: string,
  ): Promise<string> {
    const rootId = await this.getOrCreateFolder("VoiceJournal", "root", token);
    const yearId = await this.getOrCreateFolder(String(year), rootId, token);
    const mStr = String(month).padStart(2, "0");
    return this.getOrCreateFolder(mStr, yearId, token);
  }

  /**
   * Uploads entry JSON sidecar and audio file hierarchically.
   */
  async uploadEntry(entry: JournalEntry): Promise<{
    audioFileId: string | null;
    sidecarFileId: string;
    raceDetected?: boolean;
  }> {
    // Notify only for this entry's real upload — not the broader scan/check pass
    this.notifyTransferListeners({
      entryId: entry.id,
      status: "uploading",
    });

    try {
      const token = await this.getAccessToken();
      const date = new Date(entry.created_at);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;

      const monthFolderId = await this.resolveMonthFolder(year, month, token);

      // 1. Upload Audio File first if locally available and not yet uploaded
      let audioFileId = entry.drive_audio_file_id;
      const localAudioUri =
        entry.local_audio_path || getEntryAudioPath(entry.id, entry.created_at);

      if (localAudioUri) {
        const audioFile = new File(localAudioUri);
        if (audioFile.exists && !audioFileId) {
          // Create audio file placeholder with metadata in Drive
          const createAudioRes = await fetch(
            "https://www.googleapis.com/drive/v3/files",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: `${entry.id}.m4a`,
                parents: [monthFolderId],
                mimeType: "audio/mp4",
              }),
            },
          );

          if (createAudioRes.ok) {
            const audioData = await createAudioRes.json();
            audioFileId = audioData.id;

            // Stream binary audio file directly to Drive via audioFile.upload
            await audioFile.upload(
              `https://www.googleapis.com/upload/drive/v3/files/${audioFileId}?uploadType=media`,
              {
                httpMethod: "PATCH",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "audio/mp4",
                },
                uploadType: UploadType.BINARY_CONTENT,
              },
            );
          }
        }
      }

      // 2. Upload / Update Sidecar JSON (contains up-to-date audioFileId, machine-agnostic path)
      // Re-query latest entry from SQLite so any transcript, summary, or user edits
      // that completed during the audio upload step are captured in this payload
      const freshEntry = (await entriesDao.getEntryById(entry.id)) || entry;
      const snapshotUpdatedAt =
        freshEntry.updated_at != null
          ? freshEntry.updated_at
          : freshEntry.created_at;

      const entryToUpload: JournalEntry = {
        ...freshEntry,
        drive_audio_file_id: audioFileId,
        local_audio_path: null, // Device-specific absolute sandbox paths should NOT be stored in cloud sidecars
      };
      const sidecarPayload = JSON.stringify(entryToUpload, null, 2);

      let sidecarFileId =
        freshEntry.drive_sidecar_file_id || entry.drive_sidecar_file_id;
      if (sidecarFileId) {
        // Update existing sidecar file on Drive
        const updateRes = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${sidecarFileId}?uploadType=media`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json; charset=UTF-8",
            },
            body: sidecarPayload,
          },
        );

        if (!updateRes.ok) {
          if (updateRes.status === 404) {
            sidecarFileId = null;
          } else {
            throw new Error(
              `Failed to update sidecar JSON for entry ${entry.id}: ${await updateRes.text()}`,
            );
          }
        }
      }

      if (!sidecarFileId) {
        const sidecarMetadata = {
          name: `${entry.id}.json`,
          parents: [monthFolderId],
          mimeType: "application/json",
        };

        const sidecarRes = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "multipart/related; boundary=boundary_separator",
            },
            body:
              `--boundary_separator\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
                sidecarMetadata,
              )}\r\n` +
              `--boundary_separator\r\nContent-Type: application/json\r\n\r\n${sidecarPayload}\r\n` +
              `--boundary_separator--`,
          },
        );

        if (!sidecarRes.ok) {
          throw new Error(
            `Failed to upload sidecar JSON for entry ${entry.id}: ${await sidecarRes.text()}`,
          );
        }

        const sidecarData = await sidecarRes.json();
        sidecarFileId = sidecarData.id;
      }

      if (!sidecarFileId) {
        throw new Error(
          `Failed to obtain Drive sidecar file ID for entry ${entry.id}`,
        );
      }

      // Check if local entry changed while sidecar upload was in flight
      const postUploadEntry = await entriesDao.getEntryById(entry.id);
      const postUploadUpdatedAt =
        postUploadEntry?.updated_at != null
          ? postUploadEntry.updated_at
          : (postUploadEntry?.created_at ?? 0);
      const raceDetected = Boolean(
        postUploadEntry && postUploadUpdatedAt > snapshotUpdatedAt,
      );

      if (raceDetected) {
        // Local metadata changed during upload (e.g. transcript finished or user edited notes).
        // Record Drive file IDs, but set drive_synced_at to snapshotUpdatedAt so postUploadUpdatedAt > drive_synced_at
        // ensures the entry remains flagged as unsynced in SQLite.
        await entriesDao.updateSyncStatus(
          entry.id,
          sidecarFileId,
          audioFileId,
          snapshotUpdatedAt,
        );
        this.notifyTransferListeners({
          entryId: entry.id,
          status: "uploaded",
        });
        return { audioFileId, sidecarFileId, raceDetected: true };
      }

      // Update entry sync status in SQLite with current timestamp
      await entriesDao.updateSyncStatus(
        entry.id,
        sidecarFileId,
        audioFileId,
        Date.now(),
      );

      this.notifyTransferListeners({
        entryId: entry.id,
        status: "synced",
      });
      return { audioFileId, sidecarFileId, raceDetected: false };
    } catch (error) {
      this.notifyTransferListeners({
        entryId: entry.id,
        status: "failed",
      });
      throw error;
    }
  }

  /**
   * Deletes a single file from Google Drive by ID.
   * Returns true if successfully deleted or already absent (404).
   */
  async deleteFileFromDrive(fileId: string, token: string): Promise<boolean> {
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      return res.status === 204 || res.status === 200 || res.status === 404;
    } catch (err) {
      console.warn(`Failed to delete file ${fileId} from Drive:`, err);
      return false;
    }
  }

  /**
   * Deletes an entry's cloud sidecar JSON and audio file from Google Drive.
   */
  async deleteEntryFromDrive(entry: {
    id: string;
    drive_sidecar_file_id?: string | null;
    drive_audio_file_id?: string | null;
  }): Promise<void> {
    const token = await this.getAccessToken();
    const fileIdsToDelete = new Set<string>();

    if (entry.drive_sidecar_file_id) {
      fileIdsToDelete.add(entry.drive_sidecar_file_id);
    }
    if (entry.drive_audio_file_id) {
      fileIdsToDelete.add(entry.drive_audio_file_id);
    }

    // Also search Drive by filename to catch files if file IDs were missing
    try {
      const query = encodeURIComponent(
        `(name = '${entry.id}.json' or name = '${entry.id}.m4a') and trashed = false`,
      );
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (searchRes.ok) {
        const data = await searchRes.json();
        for (const file of data.files || []) {
          fileIdsToDelete.add(file.id);
        }
      }
    } catch (err) {
      console.warn("Drive search before deletion warning:", err);
    }

    for (const fileId of fileIdsToDelete) {
      await this.deleteFileFromDrive(fileId, token);
    }

    // Clean up tombstone once deleted from Google Drive
    await deletedEntriesDao.removeDeletion(entry.id);
  }

  /**
   * Helper to list all sidecar JSON files in Drive with pagination.
   */
  async listDriveSidecars(token: string): Promise<
    {
      id: string;
      name: string;
      entryId: string;
      modifiedMs: number;
    }[]
  > {
    const results: {
      id: string;
      name: string;
      entryId: string;
      modifiedMs: number;
    }[] = [];

    let pageToken: string | null = null;
    do {
      const query = encodeURIComponent(
        "mimeType = 'application/json' and name contains '.json' and trashed = false",
      );
      let searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=100&fields=nextPageToken,files(id,name,modifiedTime)`;
      if (pageToken) {
        searchUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      const res = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to list Drive files: ${await res.text()}`);
      }

      const data = await res.json();
      const files = data.files || [];
      for (const file of files) {
        if (file.name && file.name.endsWith(".json")) {
          const entryId = file.name.replace(/\.json$/i, "");
          const modifiedMs = file.modifiedTime
            ? new Date(file.modifiedTime).getTime()
            : 0;
          results.push({
            id: file.id,
            name: file.name,
            entryId,
            modifiedMs,
          });
        }
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return results;
  }

  /**
   * Complete two-way sync:
   * Rule 1: Always upload if local is newer (updated).
   * Rule 2: Download only when local is missing.
   */
  async syncTwoWay(): Promise<{
    uploadedCount: number;
    downloadedCount: number;
  }> {
    let uploadedCount = 0;
    let downloadedCount = 0;

    const token = await this.getAccessToken();

    // 0. DELETION PHASE: Process pending deletions in Google Drive
    try {
      const pendingDeletions = await deletedEntriesDao.getPendingDeletions();
      for (const pending of pendingDeletions) {
        try {
          await this.deleteEntryFromDrive(pending);
          await deletedEntriesDao.removeDeletion(pending.id);
        } catch (delErr) {
          console.warn(
            `Pending Drive deletion failed for ${pending.id}:`,
            delErr,
          );
        }
      }
    } catch (err) {
      console.warn("Failed to process pending deletions:", err);
    }

    // Fetch all existing sidecars in Drive
    const driveSidecars = await this.listDriveSidecars(token);
    const driveSidecarsMap = new Map<string, (typeof driveSidecars)[0]>();
    for (const sc of driveSidecars) {
      driveSidecarsMap.set(sc.entryId, sc);
    }

    // 1. UPLOAD PHASE: "always upload if local is newer (updated)"
    try {
      const unsyncedEntries = await entriesDao.getUnsyncedEntries();
      for (const entry of unsyncedEntries) {
        try {
          // Skip if already actively uploading in the background queue
          const queueItem = await syncQueueDao.getItemByEntryId(entry.id);
          if (queueItem && queueItem.status === "PROCESSING") {
            continue;
          }

          const cloudSidecar = driveSidecarsMap.get(entry.id);
          const localUpdatedTime = entry.updated_at || entry.created_at;

          // Upload if not in Drive or if local is newer than cloud
          const shouldUpload =
            !cloudSidecar ||
            localUpdatedTime > cloudSidecar.modifiedMs ||
            (entry.drive_synced_at != null &&
              entry.updated_at != null &&
              entry.updated_at > entry.drive_synced_at);

          if (shouldUpload) {
            const entryToUpload = {
              ...entry,
              drive_sidecar_file_id:
                entry.drive_sidecar_file_id || cloudSidecar?.id || null,
            };
            const uploadResult = await this.uploadEntry(entryToUpload);
            if (uploadResult.raceDetected) {
              // Local metadata changed while uploading; ensure queued for metadata sync pass
              const existing = await syncQueueDao.getItemByEntryId(entry.id);
              if (existing) {
                await syncQueueDao.updateAction(existing.id, "METADATA_ONLY");
                await syncQueueDao.updateStatus(existing.id, "PENDING", 0);
              } else {
                await syncQueueDao.enqueue({
                  entry_id: entry.id,
                  action: "METADATA_ONLY",
                  status: "PENDING",
                });
              }
            } else {
              uploadedCount++;
              await syncQueueDao.deleteByEntryId(entry.id);
            }
          }
        } catch (uploadErr) {
          console.warn(`Upload failed for entry ${entry.id}:`, uploadErr);
        }
      }
    } catch (err) {
      console.warn("Failed to check unsynced entries:", err);
    }

    // 2. DOWNLOAD PHASE: "download only when local is missing"
    for (const sc of driveSidecars) {
      try {
        // If entry was marked as deleted locally, do NOT download it! Ensure deleted from Drive.
        if (await deletedEntriesDao.isDeleted(sc.entryId)) {
          await this.deleteEntryFromDrive({
            id: sc.entryId,
            drive_sidecar_file_id: sc.id,
          });
          continue;
        }

        const existing = await entriesDao.getEntryById(sc.entryId);
        // Strict adherence to Rule 2: ONLY download if missing locally
        if (!existing) {
          const fileContentUrl = `https://www.googleapis.com/drive/v3/files/${sc.id}?alt=media`;
          const contentRes = await fetch(fileContentUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (contentRes.ok) {
            try {
              const entryJson: JournalEntry = await contentRes.json();
              const localAudioPath = getEntryAudioPath(
                entryJson.id,
                entryJson.created_at,
              );
              const audioExists = new File(localAudioPath).exists;

              await entriesDao.insertEntry({
                ...entryJson,
                is_audio_cached: audioExists ? 1 : 0,
                local_audio_path: audioExists ? localAudioPath : null,
                drive_sidecar_file_id: sc.id,
                drive_synced_at: Date.now(),
              });
              downloadedCount++;
            } catch {
              // Ignore malformed JSON sidecars
            }
          }
        }
      } catch (err) {
        console.warn(`Download check failed for ${sc.entryId}:`, err);
      }
    }

    return { uploadedCount, downloadedCount };
  }

  /**
   * Hydrates SQLite timeline from Google Drive (delegates to syncTwoWay).
   */
  async syncTimelineFromDrive(): Promise<{ importedCount: number }> {
    const { downloadedCount } = await this.syncTwoWay();
    return { importedCount: downloadedCount };
  }

  /**
   * On-demand audio download when user requests playback of cloud-only clip.
   */
  async downloadAudioOnDemand(entryId: string): Promise<string> {
    const entry = await entriesDao.getEntryById(entryId);
    if (!entry) throw new Error(`Entry ${entryId} not found`);

    const localPath = getEntryAudioPath(entryId, entry.created_at);
    const localFile = new File(localPath);
    if (localFile.exists) {
      await entriesDao.setAudioCached(entryId, true, localPath);
      return localPath;
    }

    if (!entry.drive_audio_file_id) {
      throw new Error(`Entry ${entryId} has no cloud audio file ID`);
    }

    this.notifyTransferListeners({
      entryId,
      status: "downloading",
    });

    try {
      const token = await this.getAccessToken();
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${entry.drive_audio_file_id}?alt=media`;

      const dir = localPath.substring(0, localPath.lastIndexOf("/") + 1);
      const directory = new Directory(dir);
      if (!directory.exists) {
        directory.create({ intermediates: true, idempotent: true });
      }

      await File.downloadFileAsync(downloadUrl, localFile, {
        headers: { Authorization: "Bearer " + token },
        idempotent: true,
      });

      await entriesDao.setAudioCached(entryId, true, localPath);
      await entriesDao.markAudioAccessed(entryId);
      this.notifyTransferListeners({
        entryId,
        status: "downloaded",
      });

      // Auto-maintain storage threshold in background after downloading new audio
      this.runLruEviction().catch((err) => {
        console.warn("Auto LRU eviction after download warning:", err);
      });

      return localPath;
    } catch (error) {
      this.notifyTransferListeners({
        entryId,
        status: "failed",
      });
      throw error;
    }
  }

  /**
   * Calculates local audio storage usage and current threshold settings.
   */
  async getStorageStats(): Promise<{
    cachedCount: number;
    totalBytes: number;
    maxMb: number;
  }> {
    const maxMb = await settingsDao.getMaxStorageMb();
    const cachedEntries = await entriesDao.getAllCachedEntries();
    let totalBytes = 0;
    let validCachedCount = 0;

    for (const entry of cachedEntries) {
      if (entry.local_audio_path) {
        try {
          const file = new File(entry.local_audio_path);
          if (file.exists && typeof file.size === "number") {
            totalBytes += file.size;
            validCachedCount++;
          }
        } catch {
          // File not accessible
        }
      }
    }

    return {
      cachedCount: validCachedCount,
      totalBytes,
      maxMb,
    };
  }

  /**
   * LRU Eviction Worker:
   * Evicts backed-up cached audio files (least accessed first)
   * if total cache exceeds the user-configured storage threshold,
   * or if forceClearAll is true.
   */
  async runLruEviction(options?: {
    forceClearAll?: boolean;
    maxBytes?: number;
  }): Promise<{
    evictedCount: number;
    freedBytes: number;
  }> {
    const { forceClearAll = false } = options || {};

    let maxAllowedBytes = options?.maxBytes;
    if (maxAllowedBytes === undefined) {
      const maxMb = await settingsDao.getMaxStorageMb();
      maxAllowedBytes = maxMb === 0 ? Infinity : maxMb * 1024 * 1024;
    }

    const prunableEntries = await entriesDao.getPrunableCachedEntries();
    // prunableEntries are already ordered by last_accessed_at ASC (least accessed first)

    let totalBytes = 0;
    const entrySizes: {
      entry: JournalEntry;
      size: number;
    }[] = [];

    for (const entry of prunableEntries) {
      if (entry.local_audio_path) {
        try {
          const file = new File(entry.local_audio_path);
          if (file.exists && typeof file.size === "number") {
            totalBytes += file.size;
            entrySizes.push({
              entry,
              size: file.size,
            });
          }
        } catch {
          // File not accessible
        }
      }
    }

    let evictedCount = 0;
    let freedBytes = 0;

    for (const item of entrySizes) {
      const isCacheOversized = totalBytes - freedBytes > maxAllowedBytes;

      if (forceClearAll || isCacheOversized) {
        // Strict safety guard: Never evict local audio unless audio and sidecar are confirmed in Google Drive
        if (
          !item.entry.drive_audio_file_id ||
          !item.entry.drive_sidecar_file_id ||
          !item.entry.drive_synced_at
        ) {
          continue;
        }

        try {
          if (item.entry.local_audio_path) {
            const file = new File(item.entry.local_audio_path);
            if (file.exists) {
              file.delete();
            }
          }
          await entriesDao.setAudioCached(item.entry.id, false, null);
          freedBytes += item.size;
          evictedCount++;
        } catch {
          // Ignore deletion error
        }
      }
    }

    return { evictedCount, freedBytes };
  }
}

export const googleDriveService = new GoogleDriveService();
