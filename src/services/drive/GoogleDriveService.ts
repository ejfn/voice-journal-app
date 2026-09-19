import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as FileSystem from "expo-file-system/legacy";
import { entriesDao } from "../../db/dao/entriesDao";
import { JournalEntry } from "../../db/schema";
import { getEntryAudioPath } from "../../utils/paths";

export interface DriveFolderInfo {
  id: string;
  name: string;
}

export class GoogleDriveService {
  private folderIdCache: Map<string, string> = new Map();
  private isConfigured: boolean = false;

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
  }> {
    const token = await this.getAccessToken();
    const date = new Date(entry.created_at);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    const monthFolderId = await this.resolveMonthFolder(year, month, token);

    // 1. Upload Sidecar JSON
    const sidecarPayload = JSON.stringify(entry, null, 2);
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
    const sidecarFileId = sidecarData.id;

    // 2. Upload Audio File if locally available
    let audioFileId = entry.drive_audio_file_id;
    if (entry.local_audio_path) {
      const fileInfo = await FileSystem.getInfoAsync(entry.local_audio_path);
      if (fileInfo.exists) {
        const audioBase64 = await FileSystem.readAsStringAsync(
          entry.local_audio_path,
          {
            encoding: FileSystem.EncodingType.Base64,
          },
        );

        const audioMetadata = {
          name: `${entry.id}.m4a`,
          parents: [monthFolderId],
          mimeType: "audio/mp4",
        };

        // Standard multipart upload
        const audioRes = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "multipart/related; boundary=boundary_separator",
            },
            body:
              `--boundary_separator\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
                audioMetadata,
              )}\r\n` +
              `--boundary_separator\r\nContent-Type: audio/mp4\r\nContent-Transfer-Encoding: base64\r\n\r\n${audioBase64}\r\n` +
              `--boundary_separator--`,
          },
        );

        if (audioRes.ok) {
          const audioData = await audioRes.json();
          audioFileId = audioData.id;
        }
      }
    }

    // Update entry with Drive IDs in SQLite
    await entriesDao.updateEntry({
      ...entry,
      drive_sidecar_file_id: sidecarFileId,
      drive_audio_file_id: audioFileId,
    });

    return { audioFileId, sidecarFileId };
  }

  /**
   * Hydrates SQLite timeline from Google Drive month folders.
   */
  async syncTimelineFromDrive(): Promise<{ importedCount: number }> {
    const token = await this.getAccessToken();
    const query = encodeURIComponent(
      "mimeType = 'application/json' and name contains '.json' and trashed = false",
    );
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=100&fields=files(id,name,modifiedTime)`;

    const res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to list Drive files: ${await res.text()}`);
    }

    const data = await res.json();
    const files: { id: string; name: string }[] = data.files || [];
    let importedCount = 0;

    for (const file of files) {
      const entryId = file.name.replace(".json", "");
      const existing = await entriesDao.getEntryById(entryId);
      if (!existing) {
        // Download and parse sidecar
        const fileContentUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
        const contentRes = await fetch(fileContentUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (contentRes.ok) {
          try {
            const entryJson: JournalEntry = await contentRes.json();
            // Check if local audio file exists
            const localAudioPath = getEntryAudioPath(
              entryJson.id,
              entryJson.created_at,
            );
            const audioExists = (await FileSystem.getInfoAsync(localAudioPath))
              .exists;

            await entriesDao.insertEntry({
              ...entryJson,
              is_audio_cached: audioExists ? 1 : 0,
              local_audio_path: audioExists ? localAudioPath : null,
              drive_sidecar_file_id: file.id,
            });
            importedCount++;
          } catch {
            // Ignore malformed JSON sidecars
          }
        }
      }
    }

    return { importedCount };
  }

  /**
   * On-demand audio download when user requests playback of cloud-only clip.
   */
  async downloadAudioOnDemand(entryId: string): Promise<string> {
    const entry = await entriesDao.getEntryById(entryId);
    if (!entry) throw new Error(`Entry ${entryId} not found`);

    const localPath = getEntryAudioPath(entryId, entry.created_at);
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) {
      await entriesDao.setAudioCached(entryId, true, localPath);
      return localPath;
    }

    if (!entry.drive_audio_file_id) {
      throw new Error(`Entry ${entryId} has no cloud audio file ID`);
    }

    const token = await this.getAccessToken();
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${entry.drive_audio_file_id}?alt=media`;

    const dir = localPath.substring(0, localPath.lastIndexOf("/") + 1);
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const downloadResult = await FileSystem.downloadAsync(
      downloadUrl,
      localPath,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (downloadResult.status !== 200) {
      throw new Error(
        `Failed to download audio from Drive (${downloadResult.status})`,
      );
    }

    await entriesDao.setAudioCached(entryId, true, localPath);
    await entriesDao.markAudioAccessed(entryId);
    return localPath;
  }

  /**
   * LRU Eviction Worker:
   * Evicts cached audio files if older than 30 days or if total cache > 500MB.
   */
  async runLruEviction(): Promise<{
    evictedCount: number;
    freedBytes: number;
  }> {
    const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500 MB
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const prunableEntries = await entriesDao.getPrunableCachedEntries();
    let totalBytes = 0;
    const entrySizes: {
      entry: JournalEntry;
      size: number;
      ageMs: number;
    }[] = [];

    for (const entry of prunableEntries) {
      if (entry.local_audio_path) {
        try {
          const info = await FileSystem.getInfoAsync(entry.local_audio_path);
          if (info.exists && typeof info.size === "number") {
            totalBytes += info.size;
            entrySizes.push({
              entry,
              size: info.size,
              ageMs: now - entry.last_accessed_at,
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
      const isOlderThan30Days = item.ageMs > THIRTY_DAYS_MS;
      const isCacheOversized = totalBytes - freedBytes > MAX_CACHE_BYTES;

      // Only evict if backed up to Drive
      const isBackedUp = Boolean(item.entry.drive_audio_file_id);

      if (isBackedUp && (isOlderThan30Days || isCacheOversized)) {
        try {
          if (item.entry.local_audio_path) {
            await FileSystem.deleteAsync(item.entry.local_audio_path, {
              idempotent: true,
            });
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
