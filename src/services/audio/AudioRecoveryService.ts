import { Directory, Paths } from "expo-file-system";
import { entriesDao } from "../../db/dao/entriesDao";
import { JournalEntry } from "../../db/schema";
import { uploadQueueService } from "../drive/UploadQueueService";
import { transcriptionQueueService } from "../ai/TranscriptionQueueService";
import { getEntryAudioPath } from "../../utils/paths";
import {
  isAudioFileValid,
  persistAudioFile,
  recoverAudioFromCache,
} from "../../utils/audioPersistence";

/**
 * Recursively collects all audio files (.m4a, .tmp) within a given directory URI.
 */
async function collectAudioFilesRecursively(dirUri: string): Promise<string[]> {
  const collected: string[] = [];
  try {
    const dir = new Directory(dirUri);
    if (!dir.exists || typeof dir.list !== "function") return collected;
    const items = dir.list();
    for (const item of items) {
      if (!item || !item.uri) continue;
      const isDir =
        item instanceof Directory ||
        item.uri.endsWith("/") ||
        ("list" in item &&
          typeof (item as unknown as { list: unknown }).list === "function");

      if (isDir) {
        const subFiles = await collectAudioFilesRecursively(item.uri);
        collected.push(...subFiles);
      } else if (item.uri.endsWith(".m4a") || item.uri.endsWith(".tmp")) {
        collected.push(item.uri);
      }
    }
  } catch {
    // Non-fatal directory traversal error
  }
  return collected;
}

export class AudioRecoveryService {
  /**
   * Scans all permanent sandbox audio directories (across all years and months)
   * plus the OS cache directory to recover stranded audio files.
   *
   * Reconciles:
   * 1. Stranded in-flight recordings (e.g. process was killed before saveRecordedEntry).
   * 2. Legacy cache recordings left from older app versions without a SQLite row.
   * 3. Existing SQLite rows (including legacy hollow-sidecar entries) missing local audio.
   */
  async scanAndRecoverOrphanedAudioFiles(): Promise<number> {
    let recoveredCount = 0;

    const baseDocumentDir = Paths.document?.uri
      ? `${Paths.document.uri.replace(/\/+$/, "")}/audio/`
      : "";
    const cacheDir = Paths.cache?.uri
      ? `${Paths.cache.uri.replace(/\/+$/, "")}/`
      : "";

    const candidateUris: string[] = [];
    if (baseDocumentDir) {
      const sandboxFiles = await collectAudioFilesRecursively(baseDocumentDir);
      candidateUris.push(...sandboxFiles);
    }
    if (cacheDir) {
      const cacheFiles = await collectAudioFilesRecursively(cacheDir);
      candidateUris.push(...cacheFiles);
    }

    const uniqueFiles = Array.from(new Set(candidateUris));

    for (const fileUri of uniqueFiles) {
      const filename = fileUri.substring(fileUri.lastIndexOf("/") + 1);
      // Match recording_<uuid>.m4a, <uuid>.m4a, or .tmp variations
      const match = filename.match(
        /^(?:recording_)?([a-zA-Z0-9_-]+?)(?:\.tmp)?\.m4a$/,
      );
      if (!match) continue;

      const entryId = match[1];
      const existing = await entriesDao.getEntryById(entryId);

      if (!existing) {
        // Stranded audio file with NO SQLite row (process died before saveRecordedEntry or legacy orphan)
        if (isAudioFileValid(fileUri)) {
          try {
            const now = Date.now();
            const canonical = getEntryAudioPath(entryId, now);
            const persistResult = await persistAudioFile(fileUri, canonical);
            if (isAudioFileValid(persistResult.uri)) {
              const recoveredEntry: JournalEntry = {
                id: entryId,
                title: "Recovered Voice Recording",
                summary: "Recovered recording waiting for transcription...",
                transcript: "",
                tags: ["voice", "recovered"],
                duration_sec: 0,
                source_type: "recorded",
                local_audio_path: persistResult.uri,
                drive_audio_file_id: null,
                drive_sidecar_file_id: null,
                is_audio_cached: 1,
                created_at: now,
                updated_at: now,
                last_accessed_at: now,
                transcription_status: "queued",
              };
              await entriesDao.insertEntry(recoveredEntry);
              uploadQueueService.enqueueUpload(entryId, "ANALYZE_AND_UPLOAD");
              transcriptionQueueService.processQueue().catch(() => {});
              recoveredCount++;
            }
          } catch (err) {
            console.warn("Failed to recover orphaned recording:", fileUri, err);
          }
        }
      } else {
        // Existing entry: heal if local audio is missing and not in Drive
        if (
          !existing.drive_audio_file_id &&
          !isAudioFileValid(existing.local_audio_path)
        ) {
          try {
            const recovered = await recoverAudioFromCache(
              existing.id,
              existing.created_at,
            );
            if (recovered) {
              await entriesDao.setAudioCached(existing.id, true, recovered);
              uploadQueueService.enqueueUpload(
                existing.id,
                "ANALYZE_AND_UPLOAD",
              );
              if (existing.transcription_status === "failed") {
                await entriesDao.resetTranscriptionRetry(existing.id);
                transcriptionQueueService.processQueue().catch(() => {});
              }
              recoveredCount++;
            }
          } catch {
            // Non-fatal
          }
        }
      }
    }

    // Also reconcile any remaining entries needing audio recovery in SQLite
    // that might not have been discovered by the filesystem directory sweep
    try {
      const needing = await entriesDao.getEntriesNeedingAudioRecovery();
      for (const entry of needing) {
        if (!isAudioFileValid(entry.local_audio_path)) {
          const recovered = await recoverAudioFromCache(
            entry.id,
            entry.created_at,
          );
          if (recovered) {
            await entriesDao.setAudioCached(entry.id, true, recovered);
            uploadQueueService.enqueueUpload(entry.id, "ANALYZE_AND_UPLOAD");
            if (entry.transcription_status === "failed") {
              await entriesDao.resetTranscriptionRetry(entry.id);
              transcriptionQueueService.processQueue().catch(() => {});
            }
            recoveredCount++;
          }
        }
      }
    } catch {
      // Non-fatal
    }

    return recoveredCount;
  }
}

export const audioRecoveryService = new AudioRecoveryService();
