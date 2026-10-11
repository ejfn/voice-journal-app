import {
  isAudioFileValid,
  persistAudioFile,
  recoverAudioFromCache,
  ensureAudioDirectoryExists,
} from "../src/utils/audioPersistence";
import { getEntryAudioPath, getEntryAudioTempPath } from "../src/utils/paths";
import { Directory, File, Paths } from "expo-file-system";
import { audioRecordingService } from "../src/services/audio/AudioRecordingService";
import { audioRecoveryService } from "../src/services/audio/AudioRecoveryService";
import { GoogleDriveService } from "../src/services/drive/GoogleDriveService";
import { createTestDb } from "./helpers/testDb";
import { setDatabaseConnection, initDatabase } from "../src/db/database";
import { entriesDao } from "../src/db/dao/entriesDao";
import { JournalEntry } from "../src/db/schema";

describe("Audio Persistence & Storage Resilience", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MockFile = File as any;
    MockFile.defaultExists = true;
    MockFile.defaultSize = 1024;
    MockFile.existingFiles = null;
    MockFile.fileSizes = null;
    MockFile.mockCopy.mockClear();
    MockFile.mockMove.mockClear();
    MockFile.mockDelete.mockClear();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const MockFile = File as any;
    MockFile.defaultExists = true;
    MockFile.defaultSize = 1024;
    MockFile.existingFiles = null;
    MockFile.fileSizes = null;
  });

  describe("isAudioFileValid", () => {
    it("returns false for null, undefined, or empty path", () => {
      expect(isAudioFileValid(null)).toBe(false);
      expect(isAudioFileValid(undefined)).toBe(false);
      expect(isAudioFileValid("")).toBe(false);
      expect(isAudioFileValid("   ")).toBe(false);
    });

    it("returns false when file does not exist", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultExists = false;
      expect(isAudioFileValid("file:///path/to/missing.m4a")).toBe(false);
    });

    it("returns false when file size is 0 bytes (empty recording)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 0;
      expect(isAudioFileValid("file:///path/to/empty.m4a")).toBe(false);
    });

    it("returns true when file exists and size is positive", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultExists = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 4096;
      expect(isAudioFileValid("file:///path/to/valid.m4a")).toBe(true);
    });
  });

  describe("ensureAudioDirectoryExists", () => {
    it("creates directory without error", async () => {
      await expect(
        ensureAudioDirectoryExists(
          "file:///mock/document/audio/2026/09/test.m4a",
        ),
      ).resolves.not.toThrow();
    });

    it("handles paths with no directory separator safely", async () => {
      await expect(
        ensureAudioDirectoryExists("nodir.m4a"),
      ).resolves.not.toThrow();
    });
  });

  describe("persistAudioFile", () => {
    it("throws if source URI is empty", async () => {
      await expect(
        persistAudioFile("", "file:///dest/dest.m4a"),
      ).rejects.toThrow("temporary recording path is missing");
    });

    it("succeeds with in-place method when source equals destination and file is valid", async () => {
      const uri = "file:///dest/audio/2026/09/entry-1.m4a";
      const result = await persistAudioFile(uri, uri);
      expect(result).toEqual({ uri, method: "in-place" });
    });

    it("throws loud error on in-place if file is empty or missing (storage full)", async () => {
      const uri = "file:///dest/audio/2026/09/entry-1.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 0;
      await expect(persistAudioFile(uri, uri)).rejects.toThrow(
        "device storage may be full",
      );
    });

    it("throws loud error if source file is 0 bytes", async () => {
      const src = "file:///tmp/recording.m4a";
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 0;
      await expect(persistAudioFile(src, dest)).rejects.toThrow(
        "Recorded audio file is missing or empty",
      );
    });

    it("moves file atomically when move succeeds (instantaneous, 0 extra bytes)", async () => {
      const src = "file:///tmp/recording.m4a";
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;

      const result = await persistAudioFile(src, dest);
      expect(result).toEqual({ uri: dest, method: "moved" });
      expect(MockFile.mockMove).toHaveBeenCalled();
    });

    it("falls back to copy when move fails (e.g. cross-partition EXDEV)", async () => {
      const src = "file:///tmp/recording.m4a";
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;

      MockFile.mockMove.mockImplementationOnce(() => {
        throw new Error("EXDEV: cross-device link");
      });

      const result = await persistAudioFile(src, dest);
      expect(result).toEqual({ uri: dest, method: "copied" });
      expect(MockFile.mockCopy).toHaveBeenCalled();
      expect(MockFile.mockDelete).toHaveBeenCalledWith(src);
    });

    it("retains source URI as fallback-temp if both copy and move fail but source is in permanent sandbox", async () => {
      const src = `${Paths.document.uri}temp_recording.m4a`;
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;

      MockFile.mockCopy.mockImplementationOnce(() => {
        throw new Error("Disk full");
      });
      MockFile.mockMove.mockImplementationOnce(() => {
        throw new Error("Disk full");
      });

      const result = await persistAudioFile(src, dest);
      expect(result).toEqual({ uri: src, method: "fallback-temp" });
    });

    it("throws error and refuses fallback-temp if source is in volatile cache (Finding 2)", async () => {
      const src = `${Paths.cache.uri}recording.m4a`;
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;

      MockFile.mockCopy.mockImplementationOnce(() => {
        throw new Error("Disk full");
      });
      MockFile.mockMove.mockImplementationOnce(() => {
        throw new Error("Disk full");
      });

      await expect(persistAudioFile(src, dest)).rejects.toThrow(
        "device may be out of disk space",
      );
    });

    it("throws loud out-of-disk-space error if copy/move fail and destination is not valid", async () => {
      const src = `${Paths.document.uri}temp_recording.m4a`;
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;

      MockFile.existingFiles = new Set([src]);
      MockFile.mockCopy.mockImplementationOnce(() => {
        throw new Error("Disk error");
      });
      MockFile.mockMove.mockImplementationOnce(() => {
        MockFile.existingFiles.delete(src); // Source lost during failed move
        throw new Error("Disk error");
      });

      await expect(persistAudioFile(src, dest)).rejects.toThrow(
        "device may be out of disk space",
      );
    });
  });

  describe("recoverAudioFromCache", () => {
    it("returns canonical path immediately if it is already valid", async () => {
      const entryId = "entry-valid";
      const createdAt = 1758290000000;
      const canonical = getEntryAudioPath(entryId, createdAt);

      const recovered = await recoverAudioFromCache(entryId, createdAt);
      expect(recovered).toBe(canonical);
    });

    it("recovers audio from sandbox temporary path into canonical path", async () => {
      const entryId = "entry-stranded-sandbox";
      const createdAt = 1758290000000;
      const canonical = getEntryAudioPath(entryId, createdAt);
      const sandboxTemp = getEntryAudioTempPath(entryId, createdAt);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([sandboxTemp]);

      const recovered = await recoverAudioFromCache(entryId, createdAt);
      expect(recovered).toBe(canonical);
      expect(MockFile.existingFiles.has(canonical)).toBe(true);
    });

    it("recovers audio from cache directory if found there", async () => {
      const entryId = "entry-stranded-cache";
      const createdAt = 1758290000000;
      const canonical = getEntryAudioPath(entryId, createdAt);
      const cacheDir = Paths.cache?.uri
        ? Paths.cache.uri.replace(/\/+$/, "")
        : "";
      const cacheFile = `${cacheDir}/recording_${entryId}.m4a`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([cacheFile]);

      const recovered = await recoverAudioFromCache(entryId, createdAt);
      expect(recovered).toBe(canonical);
      expect(MockFile.existingFiles.has(canonical)).toBe(true);
    });

    it("returns null if no candidates exist or all candidates are empty", async () => {
      const entryId = "entry-nowhere";
      const createdAt = 1758290000000;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set(); // Nothing exists

      const recovered = await recoverAudioFromCache(entryId, createdAt);
      expect(recovered).toBeNull();
    });

    it("returns canonical path if a concurrent task populated it during recovery candidate scan (Finding 3)", async () => {
      const entryId = "entry-concurrent-recovery";
      const createdAt = 1758290000000;
      const canonical = getEntryAudioPath(entryId, createdAt);
      const sandboxTemp = getEntryAudioTempPath(entryId, createdAt);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([sandboxTemp]);

      // When persistAudioFile attempts to move the candidate, simulate another process having moved it to canonical
      MockFile.mockMove.mockImplementationOnce(() => {
        MockFile.existingFiles.add(canonical);
        MockFile.existingFiles.delete(sandboxTemp);
        throw new Error("File moved by concurrent worker");
      });

      const recovered = await recoverAudioFromCache(entryId, createdAt);
      expect(recovered).toBe(canonical);
    });
  });

  describe("AudioRecordingService zero-byte loud failure", () => {
    it("throws loud error when recording stopped with empty audio", async () => {
      const entryId = "entry-empty-rec";
      await audioRecordingService.startRecording(entryId);

      // Advance timer beyond 3s threshold
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).durationMillis = 4000;

      // Simulate 0-byte file written by native layer due to full disk
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 0;

      await expect(audioRecordingService.stopRecording()).rejects.toThrow(
        "Recorded audio file is missing or empty. Please check available device storage.",
      );
    });
  });

  describe("GoogleDriveService missing audio protection", () => {
    let driveService: GoogleDriveService;
    let originalFetch: typeof global.fetch;

    beforeEach(async () => {
      const testDb = createTestDb();
      setDatabaseConnection(testDb);
      await initDatabase();
      driveService = new GoogleDriveService();
      originalFetch = global.fetch;
    });

    afterEach(() => {
      setDatabaseConnection(null);
      global.fetch = originalFetch;
    });

    it("throws error and refuses to upload hollow sidecar when voice entry audio is missing locally and in Drive", async () => {
      const t0 = 1758290000000;
      const entry: JournalEntry = {
        id: "entry-missing-audio",
        title: "Missing Audio Entry",
        summary: "Summary",
        transcript: "Transcript",
        tags: ["voice"],
        duration_sec: 25,
        source_type: "recorded",
        local_audio_path:
          "file:///mock/document/audio/2026/09/entry-missing-audio.m4a",
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: t0,
        updated_at: t0,
        drive_synced_at: null,
        last_accessed_at: t0,
      };
      await entriesDao.insertEntry(entry);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set(); // Neither local nor cache audio exists

      global.fetch = jest.fn(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (
          urlStr.includes("mimeType = 'application/vnd.google-apps.folder'")
        ) {
          return new Response(
            JSON.stringify({ files: [{ id: "folder-id" }] }),
            {
              status: 200,
            },
          );
        }
        // findFileId returns no audio on Drive
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      });

      await expect(driveService.uploadEntry(entry)).rejects.toThrow(
        "audio file is missing locally and not present in Drive",
      );

      const unSynced = await entriesDao.getEntryById("entry-missing-audio");
      expect(unSynced?.drive_synced_at).toBeNull();
      expect(unSynced?.drive_sidecar_file_id).toBeNull();
    });

    it("recovers stranded audio from cache before upload and proceeds with upload", async () => {
      const t0 = 1758290000000;
      const entryId = "entry-recover-upload";
      const canonical = getEntryAudioPath(entryId, t0);
      const cacheDir = Paths.cache?.uri
        ? Paths.cache.uri.replace(/\/+$/, "")
        : "";
      const cacheFile = `${cacheDir}/recording_${entryId}.m4a`;

      const entry: JournalEntry = {
        id: entryId,
        title: "Recovered Upload Entry",
        summary: "Summary",
        transcript: "Transcript",
        tags: ["voice"],
        duration_sec: 25,
        source_type: "recorded",
        local_audio_path: canonical,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: t0,
        updated_at: t0,
        drive_synced_at: null,
        last_accessed_at: t0,
      };
      await entriesDao.insertEntry(entry);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      // Audio is not at canonical path, but stranded in cache
      MockFile.existingFiles = new Set([cacheFile]);

      global.fetch = jest.fn(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          if (
            urlStr.includes("mimeType = 'application/vnd.google-apps.folder'")
          ) {
            return new Response(
              JSON.stringify({ files: [{ id: "folder-id" }] }),
              {
                status: 200,
              },
            );
          }
          if (
            init?.method === "POST" &&
            urlStr === "https://www.googleapis.com/drive/v3/files"
          ) {
            return new Response(JSON.stringify({ id: "recovered-audio-id" }), {
              status: 200,
            });
          }
          if (
            init?.method === "POST" &&
            urlStr.includes("/upload/drive/v3/files?uploadType=multipart")
          ) {
            return new Response(
              JSON.stringify({ id: "recovered-sidecar-id" }),
              {
                status: 200,
              },
            );
          }
          return new Response("{}", { status: 200 });
        },
      );

      const result = await driveService.uploadEntry(entry);
      expect(result.audioFileId).toBe("recovered-audio-id");
      expect(result.sidecarFileId).toBe("recovered-sidecar-id");

      const synced = await entriesDao.getEntryById(entryId);
      expect(synced?.drive_synced_at).not.toBeNull();
      expect(synced?.drive_audio_file_id).toBe("recovered-audio-id");
    });

    it("guards zero-duration audio entries (such as imported audio) from hollow sidecar upload", async () => {
      const t0 = 1758290000000;
      const entry: JournalEntry = {
        id: "entry-zero-duration-imported",
        title: "Imported Audio Zero Dur",
        summary: "Summary",
        transcript: "Transcript",
        tags: ["imported"],
        duration_sec: 0,
        source_type: "imported",
        local_audio_path:
          "file:///mock/document/audio/2026/09/entry-zero-duration-imported.m4a",
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: t0,
        updated_at: t0,
        drive_synced_at: null,
        last_accessed_at: t0,
      };
      await entriesDao.insertEntry(entry);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set(); // missing

      global.fetch = jest.fn(async () => {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      });

      await expect(driveService.uploadEntry(entry)).rejects.toThrow(
        "audio file is missing locally and not present in Drive",
      );
    });

    it("recovers audio for legacy hollow-sidecar entries where drive_sidecar_file_id is set but drive_audio_file_id is null", async () => {
      const t0 = 1758290000000;
      const entryId = "entry-legacy-hollow";
      const canonical = getEntryAudioPath(entryId, t0);

      const entry: JournalEntry = {
        id: entryId,
        title: "Legacy Hollow Entry",
        summary: "Summary",
        transcript: "",
        tags: ["voice"],
        duration_sec: 15,
        source_type: "recorded",
        local_audio_path: canonical,
        drive_audio_file_id: null,
        drive_sidecar_file_id: "legacy-sidecar-id",
        is_audio_cached: 1,
        created_at: t0,
        updated_at: t0,
        drive_synced_at: t0, // marked synced despite missing audio
        last_accessed_at: t0,
        transcription_status: "queued",
      };
      await entriesDao.insertEntry(entry);

      // Verify getEntriesNeedingAudioRecovery finds it
      const needing = await entriesDao.getEntriesNeedingAudioRecovery();
      expect(needing.some((e) => e.id === entryId)).toBe(true);
    });
  });

  describe("AudioRecordingService finally cleanup block", () => {
    it("cleans up active recorder and resets audio mode in finally block even if persist throws", async () => {
      const entryId = "entry-persist-throws";
      await audioRecordingService.startRecording(entryId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).durationMillis = 4000;

      // Mock zero-size to cause persistAudioFile error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 0;

      await expect(audioRecordingService.stopRecording()).rejects.toThrow();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((audioRecordingService as any).activeRecorder).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((audioRecordingService as any).currentEntryId).toBeNull();
    });
  });

  describe("AudioRecoveryService recursive multi-month & cache scanning (Finding 1)", () => {
    beforeEach(async () => {
      const db = createTestDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDatabaseConnection(db as any);
      await initDatabase();
    });

    it("recovers orphaned recordings across older month subdirectories and cache", async () => {
      const orphanJan = "orphan-jan-entry";
      const orphanNov = "orphan-nov-entry";
      const orphanCache = "orphan-cache-entry";

      const janFile = `file:///mock/document/audio/2026/01/recording_${orphanJan}.m4a`;
      const novFile = `file:///mock/document/audio/2025/11/recording_${orphanNov}.m4a`;
      const cacheDir = Paths.cache?.uri
        ? Paths.cache.uri.replace(/\/+$/, "")
        : "file:///mock/cache";
      const cacheFile = `${cacheDir}/recording_${orphanCache}.m4a`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([janFile, novFile, cacheFile]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/document/audio") {
          return [
            new Directory("file:///mock/document/audio/2025/"),
            new Directory("file:///mock/document/audio/2026/"),
          ];
        }
        if (normalized === "file:///mock/document/audio/2025") {
          return [new Directory("file:///mock/document/audio/2025/11/")];
        }
        if (normalized === "file:///mock/document/audio/2025/11") {
          return [new File(novFile)];
        }
        if (normalized === "file:///mock/document/audio/2026") {
          return [new Directory("file:///mock/document/audio/2026/01/")];
        }
        if (normalized === "file:///mock/document/audio/2026/01") {
          return [new File(janFile)];
        }
        if (normalized === "file:///mock/cache") {
          return [new File(cacheFile)];
        }
        return [];
      });

      const recoveredCount =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recoveredCount).toBe(3);

      const janEntry = await entriesDao.getEntryById(orphanJan);
      expect(janEntry).not.toBeNull();
      expect(janEntry?.tags).toContain("recovered");
      expect(janEntry?.transcription_status).toBe("queued");

      const novEntry = await entriesDao.getEntryById(orphanNov);
      expect(novEntry).not.toBeNull();
      expect(novEntry?.tags).toContain("recovered");

      const cacheEntry = await entriesDao.getEntryById(orphanCache);
      expect(cacheEntry).not.toBeNull();
      expect(cacheEntry?.tags).toContain("recovered");
    });
  });
});
