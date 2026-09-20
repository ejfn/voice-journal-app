import { deletedEntriesDao } from "../src/db/dao/deletedEntriesDao";
import { entriesDao } from "../src/db/dao/entriesDao";
import { initDatabase, setDatabaseConnection } from "../src/db/database";
import { JournalEntry } from "../src/db/schema";
import { GoogleDriveService } from "../src/services/drive/GoogleDriveService";
import { createTestDb } from "./helpers/testDb";
import { File } from "expo-file-system";

describe("GoogleDriveService Two-Way Sync Rules", () => {
  let driveService: GoogleDriveService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    const testDb = createTestDb();
    setDatabaseConnection(testDb);
    await initDatabase();

    driveService = new GoogleDriveService();
    originalFetch = global.fetch;
  });

  afterEach(async () => {
    setDatabaseConnection(null);
    global.fetch = originalFetch;
  });

  it("Rule 1: Always upload if local is newer (updated) or missing in Drive", async () => {
    const t0 = 1758290000000;
    // 1. Entry missing in Drive (needs upload)
    const localNewEntry: JournalEntry = {
      id: "entry-uuid-new",
      title: "New Local Clip",
      summary: "Summary",
      transcript: "Transcript",
      tags: ["new"],
      duration_sec: 15,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0,
      drive_synced_at: null,
      last_accessed_at: t0,
    };

    // 2. Entry in Drive, but local was updated after cloud modifiedTime
    const localUpdatedEntry: JournalEntry = {
      id: "entry-uuid-updated",
      title: "Updated Clip Title",
      summary: "Updated Summary",
      transcript: "Transcript",
      tags: ["updated"],
      duration_sec: 25,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: "audio-cloud-1",
      drive_sidecar_file_id: "sidecar-cloud-1",
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0 + 100000, // 100s after cloud modified
      drive_synced_at: t0,
      last_accessed_at: t0,
    };

    // 3. Entry in Drive, local is older than cloud (should NOT upload)
    const localOldEntry: JournalEntry = {
      id: "entry-uuid-old",
      title: "Old Local Clip",
      summary: "Old Summary",
      transcript: "Transcript",
      tags: ["old"],
      duration_sec: 30,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: "audio-cloud-2",
      drive_sidecar_file_id: "sidecar-cloud-2",
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0, // older than cloud modified
      drive_synced_at: t0,
      last_accessed_at: t0,
    };

    await entriesDao.insertEntry(localNewEntry);
    await entriesDao.insertEntry(localUpdatedEntry);
    await entriesDao.insertEntry(localOldEntry);

    // Mock Drive API
    const uploadedFileIds: string[] = [];
    const patchedFileIds: string[] = [];

    global.fetch = jest.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        const decodedUrl = decodeURIComponent(urlStr);

        // Folder queries & creation
        if (
          urlStr.includes("mimeType = 'application/vnd.google-apps.folder'")
        ) {
          return {
            ok: true,
            json: async () => ({
              files: [{ id: "mock-folder-id", name: "folder" }],
            }),
          } as Response;
        }

        // Listing sidecar files in Drive
        if (
          decodedUrl.includes("application/json") &&
          decodedUrl.includes("files?q=")
        ) {
          return {
            ok: true,
            json: async () => ({
              files: [
                {
                  id: "sidecar-cloud-1",
                  name: "entry-uuid-updated.json",
                  modifiedTime: new Date(t0 + 50000).toISOString(), // older than localUpdatedEntry.updated_at (t0 + 100000)
                },
                {
                  id: "sidecar-cloud-2",
                  name: "entry-uuid-old.json",
                  modifiedTime: new Date(t0 + 50000).toISOString(), // newer than localOldEntry.updated_at (t0)
                },
              ],
            }),
          } as Response;
        }

        // New file POST upload
        if (
          init?.method === "POST" &&
          urlStr.includes("/upload/drive/v3/files")
        ) {
          uploadedFileIds.push("new-sidecar-id");
          return {
            ok: true,
            json: async () => ({ id: "new-sidecar-id" }),
          } as Response;
        }

        // PATCH file upload
        if (
          init?.method === "PATCH" &&
          urlStr.includes("/upload/drive/v3/files/")
        ) {
          const fileId = urlStr.split("/files/")[1].split("?")[0];
          patchedFileIds.push(fileId);
          return {
            ok: true,
            json: async () => ({ id: fileId }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      },
    );

    const result = await driveService.syncTwoWay();

    // localNewEntry was uploaded (POST)
    expect(uploadedFileIds).toContain("new-sidecar-id");
    // localUpdatedEntry was uploaded/patched because local was newer than cloud
    expect(patchedFileIds).toContain("sidecar-cloud-1");
    // localOldEntry was NOT patched because local was NOT newer
    expect(patchedFileIds).not.toContain("sidecar-cloud-2");

    expect(result.uploadedCount).toBe(2);
  });

  it("Rule 2: Download only when local is missing (never overwrite local)", async () => {
    const t0 = 1758290000000;

    // Local already has entry-existing with its own custom title
    const localExistingEntry: JournalEntry = {
      id: "entry-existing",
      title: "Local Title Kept",
      summary: "Local Summary",
      transcript: "Local Transcript",
      tags: ["local"],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: "sidecar-existing",
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0,
      drive_synced_at: t0 + 100,
      last_accessed_at: t0,
    };
    await entriesDao.insertEntry(localExistingEntry);

    // Drive has:
    // 1. entry-existing.json (already exists locally - MUST NOT DOWNLOAD)
    // 2. entry-remote-only.json (missing locally - MUST DOWNLOAD)
    const downloadedIds: string[] = [];

    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      const decodedUrl = decodeURIComponent(urlStr);

      // Folder queries
      if (urlStr.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        return {
          ok: true,
          json: async () => ({ files: [{ id: "mock-folder-id" }] }),
        } as Response;
      }

      // Drive listing
      if (
        decodedUrl.includes("application/json") &&
        decodedUrl.includes("files?q=")
      ) {
        return {
          ok: true,
          json: async () => ({
            files: [
              {
                id: "sidecar-existing",
                name: "entry-existing.json",
                modifiedTime: new Date(t0 + 20000).toISOString(),
              },
              {
                id: "sidecar-remote-only",
                name: "entry-remote-only.json",
                modifiedTime: new Date(t0 + 10000).toISOString(),
              },
            ],
          }),
        } as Response;
      }

      // Download content
      if (urlStr.includes("alt=media")) {
        if (urlStr.includes("sidecar-existing")) {
          downloadedIds.push("entry-existing");
          return {
            ok: true,
            json: async () => ({
              id: "entry-existing",
              title: "OVERWRITTEN CLOUD TITLE",
              summary: "OVERWRITTEN",
              transcript: "OVERWRITTEN",
              tags: [],
              duration_sec: 99,
              source_type: "recorded",
              created_at: t0,
              last_accessed_at: t0,
            }),
          } as Response;
        }

        if (urlStr.includes("sidecar-remote-only")) {
          downloadedIds.push("entry-remote-only");
          return {
            ok: true,
            json: async () => ({
              id: "entry-remote-only",
              title: "Downloaded Remote Clip",
              summary: "Remote Summary",
              transcript: "Remote Transcript",
              tags: ["remote"],
              duration_sec: 45,
              source_type: "recorded",
              local_audio_path: null,
              drive_audio_file_id: "audio-remote",
              drive_sidecar_file_id: "sidecar-remote-only",
              created_at: t0 + 10000,
              last_accessed_at: t0 + 10000,
            }),
          } as Response;
        }
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    const result = await driveService.syncTwoWay();

    // Verify downloadedCount is 1 (only the missing clip was downloaded)
    expect(result.downloadedCount).toBe(1);
    expect(downloadedIds).toContain("entry-remote-only");
    expect(downloadedIds).not.toContain("entry-existing");

    // Verify local entry was NOT overwritten
    const existingAfterSync = await entriesDao.getEntryById("entry-existing");
    expect(existingAfterSync?.title).toBe("Local Title Kept");

    // Verify missing entry was added to SQLite
    const remoteEntryInDb = await entriesDao.getEntryById("entry-remote-only");
    expect(remoteEntryInDb).not.toBeNull();
    expect(remoteEntryInDb?.title).toBe("Downloaded Remote Clip");
  });

  it("enforces storage threshold via LRU eviction (least accessed first, only backed-up)", async () => {
    // Clip 1: accessed long ago (t = 100), backed up to Drive, size = 1000 bytes
    await entriesDao.insertEntry({
      id: "clip-old-backedup",
      title: "Old Accessed Clip",
      summary: "Summary",
      transcript: "Transcript",
      tags: [],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///mock/document/audio/2026/09/clip-old.m4a",
      drive_audio_file_id: "drive-audio-1",
      drive_sidecar_file_id: "drive-sc-1",
      is_audio_cached: 1,
      created_at: 100,
      drive_synced_at: 100,
      last_accessed_at: 100,
    });

    // Clip 2: accessed recently (t = 500), backed up to Drive, size = 1000 bytes
    await entriesDao.insertEntry({
      id: "clip-new-backedup",
      title: "Recently Accessed Clip",
      summary: "Summary",
      transcript: "Transcript",
      tags: [],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///mock/document/audio/2026/09/clip-new.m4a",
      drive_audio_file_id: "drive-audio-2",
      drive_sidecar_file_id: "drive-sc-2",
      is_audio_cached: 1,
      created_at: 500,
      drive_synced_at: 500,
      last_accessed_at: 500,
    });

    // Clip 3: accessed long ago (t = 50), NOT backed up to Drive (must NEVER be deleted)
    await entriesDao.insertEntry({
      id: "clip-unbackedup",
      title: "Unbacked Local Clip",
      summary: "Summary",
      transcript: "Transcript",
      tags: [],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///mock/document/audio/2026/09/clip-unbacked.m4a",
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 50,
      last_accessed_at: 50,
    });

    // Each MockFile has size = 1000 bytes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (File as any).defaultSize = 1000;

    // With maxBytes = 1500: total prunable is 2000 bytes (clip-old + clip-new).
    // It should evict 1 clip (clip-old-backedup, because last_accessed_at is 100 vs 500).
    // And clip-unbackedup must NOT be touched.
    const eviction = await driveService.runLruEviction({ maxBytes: 1500 });
    expect(eviction.evictedCount).toBe(1);

    const oldClip = await entriesDao.getEntryById("clip-old-backedup");
    expect(oldClip?.is_audio_cached).toBe(0);
    expect(oldClip?.local_audio_path).toBeNull();
    // Entry metadata is preserved
    expect(oldClip?.title).toBe("Old Accessed Clip");

    const newClip = await entriesDao.getEntryById("clip-new-backedup");
    expect(newClip?.is_audio_cached).toBe(1);

    const unbackedClip = await entriesDao.getEntryById("clip-unbackedup");
    expect(unbackedClip?.is_audio_cached).toBe(1);
    expect(unbackedClip?.local_audio_path).not.toBeNull();
  });

  it("deleting an entry deletes it from Drive and syncTwoWay deletes pending deletions without resurrecting", async () => {
    const t0 = 1758290000000;
    const entryToDelete: JournalEntry = {
      id: "entry-to-delete",
      title: "Delete Me",
      summary: "Summary",
      transcript: "Transcript",
      tags: [],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///mock/audio/delete-me.m4a",
      drive_audio_file_id: "audio-file-del-1",
      drive_sidecar_file_id: "sidecar-file-del-1",
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0,
      drive_synced_at: t0,
      last_accessed_at: t0,
    };

    await entriesDao.insertEntry(entryToDelete);

    // 1. Calling entriesDao.deleteEntry deletes the local file and records a tombstone
    const deleted = await entriesDao.deleteEntry("entry-to-delete");
    expect(deleted).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((File as any).mockDelete).toHaveBeenCalledWith(
      expect.stringContaining("entry-to-delete.m4a"),
    );

    const isMarkedDeleted =
      await deletedEntriesDao.isDeleted("entry-to-delete");
    expect(isMarkedDeleted).toBe(true);

    // 2. Test deleting from Drive via deleteEntryFromDrive
    const deletedFileIds: string[] = [];
    global.fetch = jest.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (init?.method === "DELETE") {
          const fileId = urlStr.split("/").pop() || "";
          deletedFileIds.push(fileId);
          return new Response(null, { status: 204 });
        }
        // Search Drive for file IDs
        if (urlStr.includes("drive/v3/files?q=")) {
          return new Response(
            JSON.stringify({
              files: [
                { id: "sidecar-file-del-1", name: "entry-to-delete.json" },
                { id: "audio-file-del-1", name: "entry-to-delete.m4a" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      },
    );

    await driveService.deleteEntryFromDrive(deleted!);
    expect(deletedFileIds).toContain("sidecar-file-del-1");
    expect(deletedFileIds).toContain("audio-file-del-1");

    // Once deleted from cloud, tombstone should be cleaned up
    const isMarkedDeletedAfter =
      await deletedEntriesDao.isDeleted("entry-to-delete");
    expect(isMarkedDeletedAfter).toBe(false);

    // 3. Test offline deletion handled by syncTwoWay
    const offlineEntry: JournalEntry = {
      id: "entry-offline-del",
      title: "Offline Deleted Clip",
      summary: "Summary",
      transcript: "Transcript",
      tags: [],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///mock/audio/offline.m4a",
      drive_audio_file_id: "audio-offline-id",
      drive_sidecar_file_id: "sidecar-offline-id",
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0,
      drive_synced_at: t0,
      last_accessed_at: t0,
    };
    await entriesDao.insertEntry(offlineEntry);
    await entriesDao.deleteEntry("entry-offline-del");

    deletedFileIds.length = 0;
    global.fetch = jest.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (init?.method === "DELETE") {
          const fileId = urlStr.split("/").pop() || "";
          deletedFileIds.push(fileId);
          return new Response(null, { status: 204 });
        }
        if (urlStr.includes("mimeType = 'application/json'")) {
          return new Response(
            JSON.stringify({
              files: [
                {
                  id: "sidecar-offline-id",
                  name: "entry-offline-del.json",
                  modifiedTime: new Date(t0).toISOString(),
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      },
    );

    const syncResult = await driveService.syncTwoWay();
    // It should NOT download the deleted entry!
    expect(syncResult.downloadedCount).toBe(0);
    // It should have executed the pending deletion on Drive during sync
    expect(deletedFileIds).toContain("sidecar-offline-id");

    // And it should not be present in SQLite
    const entryAfterSync = await entriesDao.getEntryById("entry-offline-del");
    expect(entryAfterSync).toBeNull();
  });
});
