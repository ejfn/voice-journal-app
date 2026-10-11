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
import { syncQueueDao } from "../src/db/dao/syncQueueDao";
import { deletedEntriesDao } from "../src/db/dao/deletedEntriesDao";
import { JournalEntry } from "../src/db/schema";
import { transcriptionQueueService } from "../src/services/ai/TranscriptionQueueService";
import { uploadQueueService } from "../src/services/drive/UploadQueueService";
import { Platform } from "react-native";
import { VoiceRecorder } from "voice-recorder";

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

    it("preserves valid destination file and does not delete it when concurrent recovery already created it", async () => {
      const src = "file:///tmp/recording.m4a";
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      // Simulate concurrent recovery: another worker already moved source to destination
      MockFile.existingFiles = new Set([dest]);
      MockFile.fileSizes = new Map([[dest, 1024]]);

      const result = await persistAudioFile(src, dest);
      expect(result).toEqual({ uri: dest, method: "in-place" });
      expect(MockFile.mockDelete).not.toHaveBeenCalledWith(dest);
    });

    it("deletes existing corrupt 0-byte destination file before move", async () => {
      const src = "file:///tmp/recording.m4a";
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([src, dest]);
      MockFile.fileSizes = new Map([
        [src, 1024],
        [dest, 0],
      ]);

      const result = await persistAudioFile(src, dest);
      expect(result).toEqual({ uri: dest, method: "moved" });
      expect(MockFile.mockDelete).toHaveBeenCalledWith(dest);
    });

    it("falls back to copy when move fails (e.g. cross-partition EXDEV)", async () => {
      const src = "file:///tmp/recording.m4a";
      const dest = "file:///dest/entry.m4a";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([src]);

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
      MockFile.existingFiles = new Set([src]);

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
      MockFile.existingFiles = new Set([src]);

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
      const orphanJan = "11111111-1111-4111-8111-111111111111";
      const orphanNov = "22222222-2222-4222-8222-222222222222";
      const orphanCache = "33333333-3333-4333-8333-333333333333";

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

    it("ignores non-UUID cache audio files such as picker imports (Finding 1)", async () => {
      const cacheDir = Paths.cache?.uri
        ? Paths.cache.uri.replace(/\/+$/, "")
        : "file:///mock/cache";
      const voiceFile = `${cacheDir}/voice.m4a`;
      const pickerFile = `${cacheDir}/picker_asset_123.m4a`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([voiceFile, pickerFile]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/cache") {
          return [new File(voiceFile), new File(pickerFile)];
        }
        return [];
      });

      const recoveredCount =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recoveredCount).toBe(0);

      const voiceEntry = await entriesDao.getEntryById("voice");
      expect(voiceEntry).toBeNull();
    });

    it("excludes transcription chunk scratch directories and chunk files during recovery (Finding 1)", async () => {
      const chunkDir = "file:///mock/cache/chunks_entry-123";
      const chunkFile = "file:///mock/cache/chunks_entry-123/chunk_0_12345.m4a";
      const rootChunkFile = "file:///mock/cache/chunk_0_9999.m4a";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([chunkFile, rootChunkFile]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/cache") {
          return [new Directory(chunkDir), new File(rootChunkFile)];
        }
        if (normalized === chunkDir) {
          return [new File(chunkFile)];
        }
        return [];
      });

      const recoveredCount =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recoveredCount).toBe(0);

      const chunkEntry = await entriesDao.getEntryById("chunk_0_12345");
      expect(chunkEntry).toBeNull();
      const rootChunkEntry = await entriesDao.getEntryById("chunk_0_9999");
      expect(rootChunkEntry).toBeNull();
    });

    it("skips tombstoned recordings in deleted_entries table and cleans up abandoned file (Finding 2)", async () => {
      const tombstonedId = "44444444-4444-4444-8444-444444444444";
      const fileUri = `file:///mock/document/audio/2026/01/recording_${tombstonedId}.m4a`;

      // Record tombstone deletion in DB
      await deletedEntriesDao.recordDeletion(tombstonedId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([fileUri]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/document/audio") {
          return [new Directory("file:///mock/document/audio/2026/01/")];
        }
        if (normalized === "file:///mock/document/audio/2026/01") {
          return [new File(fileUri)];
        }
        return [];
      });

      const recoveredCount =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recoveredCount).toBe(0);

      const entry = await entriesDao.getEntryById(tombstonedId);
      expect(entry).toBeNull();
      // Should delete the abandoned file
      expect(MockFile.mockDelete).toHaveBeenCalledWith(fileUri);
    });

    it("infers historical timestamp from year/month directory path for stranded recordings", async () => {
      const historicalId = "55555555-5555-5555-8555-555555555555";
      const fileUri = `file:///mock/document/audio/2025/11/recording_${historicalId}.m4a`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([fileUri]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/document/audio") {
          return [new Directory("file:///mock/document/audio/2025/11/")];
        }
        if (normalized === "file:///mock/document/audio/2025/11") {
          return [new File(fileUri)];
        }
        return [];
      });

      const recoveredCount =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recoveredCount).toBe(1);

      const entry = await entriesDao.getEntryById(historicalId);
      expect(entry).not.toBeNull();
      const recDate = new Date(entry!.created_at);
      expect(recDate.getFullYear()).toBe(2025);
      expect(recDate.getMonth()).toBe(10); // 10 is 0-indexed November
      expect(entry!.local_audio_path).toContain("/audio/2025/11/");
    });

    it("cleans up 0-byte corrupt abandoned orphaned files with no DB record", async () => {
      const corruptId = "66666666-6666-6666-8666-666666666666";
      const fileUri = `file:///mock/document/audio/2026/01/recording_${corruptId}.m4a`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([fileUri]);
      MockFile.fileSizes = new Map([[fileUri, 0]]); // 0 bytes

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/document/audio") {
          return [new Directory("file:///mock/document/audio/2026/01/")];
        }
        if (normalized === "file:///mock/document/audio/2026/01") {
          return [new File(fileUri)];
        }
        return [];
      });

      const recoveredCount =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recoveredCount).toBe(0);

      const entry = await entriesDao.getEntryById(corruptId);
      expect(entry).toBeNull();
      expect(MockFile.mockDelete).toHaveBeenCalledWith(fileUri);
    });

    it("promotes existing entry fallback temp path to canonical path", async () => {
      const entryId = "77777777-7777-7777-8777-777777777777";
      const now = new Date(2026, 0, 15).getTime();
      const tempPath = `file:///mock/document/audio/2026/01/recording_${entryId}.m4a`;
      const canonicalPath = `file:///mock/document/audio/2026/01/${entryId}.m4a`;

      const existingEntry: JournalEntry = {
        id: entryId,
        title: "Test Entry",
        summary: "Summary",
        transcript: "Transcript",
        tags: ["voice"],
        duration_sec: 15,
        source_type: "recorded",
        local_audio_path: tempPath,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        updated_at: now,
        last_accessed_at: now,
        transcription_status: "completed",
      };
      await entriesDao.insertEntry(existingEntry);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([tempPath]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/document/audio") {
          return [new Directory("file:///mock/document/audio/2026/01/")];
        }
        if (normalized === "file:///mock/document/audio/2026/01") {
          return [new File(tempPath)];
        }
        return [];
      });

      await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();

      const updated = await entriesDao.getEntryById(entryId);
      expect(updated).not.toBeNull();
      expect(updated?.local_audio_path).toBe(canonicalPath);
      expect(MockFile.existingFiles.has(canonicalPath)).toBe(true);
    });
  });

  describe("entriesDao fallback temp path preservation (Finding 4)", () => {
    beforeEach(async () => {
      const db = createTestDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDatabaseConnection(db as any);
      await initDatabase();
    });

    it("preserves fallback temporary sandbox URI instead of replacing with canonical path", async () => {
      const entryId = "entry-with-fallback";
      const now = Date.now();
      const fallbackTempUri = `${Paths.document.uri}audio/fallback_${entryId}.tmp.m4a`;

      const entry: JournalEntry = {
        id: entryId,
        title: "Fallback Entry",
        summary: "Summary",
        transcript: "",
        tags: ["voice"],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: fallbackTempUri,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1, // Marked cached
        created_at: now,
        updated_at: now,
        last_accessed_at: now,
        transcription_status: "queued",
      };

      await entriesDao.insertEntry(entry);
      const loaded = await entriesDao.getEntryById(entryId);
      expect(loaded).not.toBeNull();
      // Must preserve the actual fallback path on disk
      expect(loaded?.local_audio_path).toBe(fallbackTempUri);
    });
  });

  describe("Producer-only recovery, directory traversal, and recording state detachment", () => {
    beforeEach(async () => {
      const db = createTestDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDatabaseConnection(db as any);
      await initDatabase();
    });

    it("recovery scan does not trigger queue passes and leaves PENDING sync_queue items for recovered entries", async () => {
      const file1 =
        "file:///mock/document/audio/2026/09/a1111111-1111-1111-1111-111111111111.m4a";
      const file2 =
        "file:///mock/document/audio/2026/09/b2222222-2222-2222-2222-222222222222.m4a";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([file1, file2]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/document/audio") {
          return [new Directory("file:///mock/document/audio/2026/09/")];
        }
        if (normalized === "file:///mock/document/audio/2026/09") {
          return [new File(file1), new File(file2)];
        }
        return [];
      });

      const transcriptionSpy = jest
        .spyOn(transcriptionQueueService, "processQueue")
        .mockImplementation(async () => {});
      const uploadSpy = jest
        .spyOn(uploadQueueService, "processQueue")
        .mockImplementation(async () => {});

      const recovered =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recovered).toBe(2);

      // Must NOT trigger queue processing during scan (pure producer)
      expect(transcriptionSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();

      // Must leave pending items in sync_queue for both recovered entries
      const pendingUploads = await syncQueueDao.getPendingItems();
      expect(pendingUploads).toHaveLength(2);
      const enqueuedEntryIds = pendingUploads.map((i) => i.entry_id).sort();
      expect(enqueuedEntryIds).toEqual([
        "a1111111-1111-1111-1111-111111111111",
        "b2222222-2222-2222-2222-222222222222",
      ]);

      transcriptionSpy.mockRestore();
      uploadSpy.mockRestore();
    });

    it("traverses Directory.list() returning primitive string URIs without throwing TypeError", async () => {
      const file1 =
        "file:///mock/document/audio/2026/09/c3333333-3333-3333-3333-333333333333.m4a";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([file1]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation((uri: string) => {
        const normalized = uri.replace(/\/+$/, "");
        if (normalized === "file:///mock/document/audio") {
          // Returning primitive string path instead of Directory instance
          return ["file:///mock/document/audio/2026/09/"];
        }
        if (normalized === "file:///mock/document/audio/2026/09") {
          // Returning primitive string path instead of File instance
          return [file1];
        }
        return [];
      });

      // Must not throw "TypeError: Cannot use 'in' operator to search for 'list' in file:///..."
      await expect(
        audioRecoveryService.scanAndRecoverOrphanedAudioFiles(),
      ).resolves.toBe(1);

      const entry = await entriesDao.getEntryById(
        "c3333333-3333-3333-3333-333333333333",
      );
      expect(entry).not.toBeNull();
    });

    it("allows consecutive recordings without previous stop clobbering new recording state", async () => {
      const entryId1 = "entry-rec-1";
      const entryId2 = "entry-rec-2";

      // First recording
      await audioRecordingService.startRecording(entryId1);
      // Advance duration beyond minimum 3s
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).durationMillis = 4000;
      const res1 = await audioRecordingService.stopRecording();
      expect(res1.localUri).toBeTruthy();
      expect(res1.durationSec).toBe(4);

      // Verify instance fields were detached and reset to IDLE immediately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((audioRecordingService as any).activeRecorder).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((audioRecordingService as any).currentEntryId).toBeNull();

      // Second recording starts immediately
      await audioRecordingService.startRecording(entryId2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((audioRecordingService as any).currentEntryId).toBe(entryId2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).durationMillis = 5000;

      const res2 = await audioRecordingService.stopRecording();
      expect(res2.localUri).toBeTruthy();
      expect(res2.durationSec).toBe(5);
      expect(res2.localUri).toContain(entryId2);
    });

    it("provides accurate state helper methods (getActiveRecordingPath, getCurrentEntryId, isRecording)", async () => {
      const entryId = "entry-state-helpers-1";
      expect(audioRecordingService.getActiveRecordingPath()).toBeNull();
      expect(audioRecordingService.getCurrentEntryId()).toBeNull();
      expect(audioRecordingService.isRecording()).toBe(false);

      await audioRecordingService.startRecording(entryId);

      expect(audioRecordingService.getCurrentEntryId()).toBe(entryId);
      expect(audioRecordingService.getActiveRecordingPath()).toContain(entryId);
      expect(audioRecordingService.isRecording()).toBe(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).durationMillis = 4000;
      await audioRecordingService.stopRecording();

      expect(audioRecordingService.getActiveRecordingPath()).toBeNull();
      expect(audioRecordingService.getCurrentEntryId()).toBeNull();
      expect(audioRecordingService.isRecording()).toBe(false);
    });

    it("evaluates Android VoiceRecorder fallback in state helper methods when recorder is idle", () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, "OS", {
        value: "android",
        configurable: true,
      });

      const isAvailSpy = jest
        .spyOn(VoiceRecorder, "isAvailable")
        .mockReturnValue(true);
      const getStatusSpy = jest
        .spyOn(VoiceRecorder, "getStatus")
        .mockReturnValue({
          isRecording: true,
          isPaused: false,
          durationMillis: 1000,
          currentFilePath: "file:///android/path/recording.m4a",
        });

      expect(audioRecordingService.getActiveRecordingPath()).toBe(
        "file:///android/path/recording.m4a",
      );
      expect(audioRecordingService.isRecording()).toBe(true);

      isAvailSpy.mockRestore();
      getStatusSpy.mockRestore();
      Object.defineProperty(Platform, "OS", {
        value: originalOS,
        configurable: true,
      });
    });

    it("serializes in-flight stops so startRecording awaits ongoing stop completion", async () => {
      const entryId2 = "entry-stop-serialize-2";

      let resolveSlowStop!: () => void;
      const slowStopPromise = new Promise<void>((resolve) => {
        resolveSlowStop = resolve;
      });

      // Inject a stopPromise representing in-flight stop/persistence
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).stopPromise = slowStopPromise;

      let startCompleted = false;
      const startPromise = audioRecordingService
        .startRecording(entryId2)
        .then(() => {
          startCompleted = true;
        });

      // While stopPromise is in-flight, startRecording must be waiting
      expect(startCompleted).toBe(false);

      // Resolve stopPromise
      resolveSlowStop();
      await startPromise;

      expect(startCompleted).toBe(true);
      expect(audioRecordingService.getCurrentEntryId()).toBe(entryId2);

      await audioRecordingService.cancelRecording();
    });

    it("AudioRecoveryService skips active recording files and active entries", async () => {
      const activeId = "44444444-4444-4444-8444-444444444444";
      await audioRecordingService.startRecording(activeId);

      const activeTempPath = audioRecordingService.getActiveRecordingPath();
      expect(activeTempPath).toBeTruthy();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([activeTempPath!]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation(() => [activeTempPath!]);

      // Should skip active recording and recover 0
      const recovered =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(recovered).toBe(0);

      await audioRecordingService.cancelRecording();
    });

    it("AudioRecoveryService heals existing entry missing local audio by directly persisting valid fileUri", async () => {
      const entryId = "55555555-5555-4555-8555-555555555555";
      const t0 = 1758290000000;
      const canonical = getEntryAudioPath(entryId, t0);
      const tempUri = `file:///mock/cache/recording_${entryId}.m4a`;

      // Existing entry in SQLite with non-existent local_audio_path
      const entry: JournalEntry = {
        id: entryId,
        title: "Existing Entry Missing Audio",
        summary: "Summary",
        transcript: "",
        tags: ["voice"],
        duration_sec: 20,
        source_type: "recorded",
        local_audio_path: canonical,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 0,
        created_at: t0,
        updated_at: t0,
        last_accessed_at: t0,
        transcription_status: "failed",
      };
      await entriesDao.insertEntry(entry);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      // canonical does NOT exist, but tempUri DOES exist and is valid
      MockFile.existingFiles = new Set([tempUri]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation(() => [tempUri]);

      const count =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(count).toBe(1);

      const updated = await entriesDao.getEntryById(entryId);
      expect(updated).not.toBeNull();
      expect(updated!.is_audio_cached).toBe(1);
      expect(updated!.local_audio_path).toBe(canonical);
      expect(updated!.transcription_status).toBe("queued"); // retry reset
    });

    it("AudioRecoveryService falls back to recoverAudioFromCache when fileUri is invalid for existing entry", async () => {
      const entryId = "66666666-6666-4666-8666-666666666666";
      const t0 = 1758290000000;
      const canonical = getEntryAudioPath(entryId, t0);
      const invalidTempUri = `file:///mock/cache/recording_${entryId}.m4a`;
      const cacheDir = Paths.cache?.uri
        ? Paths.cache.uri.replace(/\/+$/, "")
        : "file:///mock/cache";
      const fallbackCacheUri = `${cacheDir}/${entryId}.m4a`;

      const entry: JournalEntry = {
        id: entryId,
        title: "Existing Entry Fallback",
        summary: "Summary",
        transcript: "",
        tags: ["voice"],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: canonical,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 0,
        created_at: t0,
        updated_at: t0,
        last_accessed_at: t0,
        transcription_status: "queued",
      };
      await entriesDao.insertEntry(entry);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockFile = File as any;
      MockFile.existingFiles = new Set([invalidTempUri, fallbackCacheUri]);
      MockFile.fileSizes = new Map([
        [invalidTempUri, 0], // 0-byte invalid fileUri
        [fallbackCacheUri, 2048], // valid fallback in cache
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MockDirectory = Directory as any;
      MockDirectory.mockList.mockImplementation(() => [invalidTempUri]);

      const count =
        await audioRecoveryService.scanAndRecoverOrphanedAudioFiles();
      expect(count).toBe(1);

      const updated = await entriesDao.getEntryById(entryId);
      expect(updated).not.toBeNull();
      expect(updated!.is_audio_cached).toBe(1);
    });
  });
});
