import { Directory, File, Paths } from "expo-file-system";
import { entriesDao } from "../../db/dao/entriesDao";
import { deletedEntriesDao } from "../../db/dao/deletedEntriesDao";
import { JournalEntry } from "../../db/schema";
import { uploadQueueService } from "../drive/UploadQueueService";
import { transcriptionQueueService } from "../ai/TranscriptionQueueService";
import { getEntryAudioPath } from "../../utils/paths";
import {
  isAudioFileValid,
  persistAudioFile,
  recoverAudioFromCache,
} from "../../utils/audioPersistence";
import { isValidUUID } from "../../utils/uuid";

/**
 * Recursively collects all audio files (.m4a, .tmp) within a given directory URI.
 * Skips transcription chunk directories (e.g. cache/chunks_<id>/).
 */
async function collectAudioFilesRecursively(dirUri: string): Promise<string[]> {
  const collected: string[] = [];
  try {
    const dir = new Directory(dirUri);
    if (!dir.exists || typeof dir.list !== "function") return collected;
    const items = dir.list();
    for (const item of items) {
      if (!item) continue;
      const itemUri = typeof item === "string" ? item : (item.uri ?? "");
      if (!itemUri) continue;
      // Exclude transcription chunk scratch directories and chunk files
      if (itemUri.includes("/chunks_") || itemUri.includes("/chunk_")) {
        continue;
      }
      const isDir =
        item instanceof Directory ||
        itemUri.endsWith("/") ||
        ("list" in (item as object) &&
          typeof (item as unknown as { list: unknown }).list === "function");

      if (isDir) {
        const subFiles = await collectAudioFilesRecursively(itemUri);
        collected.push(...subFiles);
      } else if (
        itemUri.endsWith(".m4a") ||
        itemUri.endsWith(".tmp") ||
        itemUri.endsWith(".tmp.m4a") ||
        itemUri.endsWith(".m4a.tmp")
      ) {
        const filename = itemUri.substring(itemUri.lastIndexOf("/") + 1);
        if (!filename.startsWith("chunk_") && !filename.includes("_chunk_")) {
          collected.push(itemUri);
        }
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
   *
   * Excludes:
   * - Transcription chunk scratch files (e.g. chunk_<start>_<timestamp>.m4a).
   * - Tombstoned recordings previously deleted by the user.
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
      // Exclude chunk paths and chunk filenames
      if (fileUri.includes("/chunks_") || fileUri.includes("/chunk_")) {
        continue;
      }
      const filename = fileUri.substring(fileUri.lastIndexOf("/") + 1);
      if (filename.startsWith("chunk_") || filename.includes("_chunk_")) {
        continue;
      }

      // Filename must match recording_<uuid>.m4a or <uuid>.m4a (and optional .tmp variations)
      let entryId: string | null = null;
      const recMatch = filename.match(
        /^recording_([a-zA-Z0-9_-]+?)(?:\.tmp\.m4a|\.m4a\.tmp|\.m4a|\.tmp)$/,
      );
      if (recMatch) {
        entryId = recMatch[1];
      } else {
        const directMatch = filename.match(
          /^([a-zA-Z0-9_-]+?)(?:\.tmp\.m4a|\.m4a\.tmp|\.m4a|\.tmp)$/,
        );
        if (directMatch) {
          entryId = directMatch[1];
        }
      }

      // Restrict recovery strictly to valid journal entry UUIDs.
      // This prevents unrelated cache files (e.g. from AudioImportService or third-party pickers)
      // from being imported as phantom JournalEntry records.
      if (!entryId || !isValidUUID(entryId)) {
        continue;
      }

      // Check if entry was tombstoned by user deletion
      const isTombstoned = await deletedEntriesDao.isDeleted(entryId);
      if (isTombstoned) {
        // Skip tombstoned recording and clean up stranded file so it doesn't resurrect
        try {
          const orphanedFile = new File(fileUri);
          if (orphanedFile.exists) {
            orphanedFile.delete();
          }
        } catch {
          // Non-fatal cleanup
        }
        continue;
      }

      const existing = await entriesDao.getEntryById(entryId);

      if (!existing) {
        // Stranded audio file with NO SQLite row (process died before saveRecordedEntry or legacy orphan)
        if (isAudioFileValid(fileUri)) {
          try {
            // Infer recording timestamp from historical directory structure if present (/audio/YYYY/MM/),
            // preventing recordings from past months from being relocated to the current month.
            let createdAt = Date.now();
            const dirMatch = fileUri.match(/\/audio\/(\d{4})\/(\d{2})\//);
            if (dirMatch) {
              const y = parseInt(dirMatch[1], 10);
              const m = parseInt(dirMatch[2], 10);
              if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
                createdAt = new Date(y, m - 1, 1, 12, 0, 0).getTime();
              }
            }

            const canonical = getEntryAudioPath(entryId, createdAt);
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
                created_at: createdAt,
                updated_at: createdAt,
                last_accessed_at: createdAt,
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
        } else {
          // Clean up corrupted or 0-byte abandoned temp file with no DB record
          try {
            const badFile = new File(fileUri);
            if (badFile.exists) {
              badFile.delete();
            }
          } catch {
            // Non-fatal
          }
        }
      } else {
        // Existing entry: heal if local audio is missing
        if (!isAudioFileValid(existing.local_audio_path)) {
          try {
            const recovered = await recoverAudioFromCache(
              existing.id,
              existing.created_at,
            );
            if (recovered) {
              await entriesDao.setAudioCached(existing.id, true, recovered);
              if (!existing.drive_audio_file_id) {
                uploadQueueService.enqueueUpload(
                  existing.id,
                  "ANALYZE_AND_UPLOAD",
                );
              }
              if (existing.transcription_status === "failed") {
                await entriesDao.resetTranscriptionRetry(existing.id);
                transcriptionQueueService.processQueue().catch(() => {});
              }
              recoveredCount++;
            }
          } catch {
            // Non-fatal
          }
        } else if (
          existing.local_audio_path &&
          existing.local_audio_path.includes("recording_")
        ) {
          // If existing entry was using a fallback temp path, try promoting it to canonical
          try {
            const canonical = getEntryAudioPath(
              existing.id,
              existing.created_at,
            );
            if (canonical !== existing.local_audio_path) {
              const res = await persistAudioFile(
                existing.local_audio_path,
                canonical,
              );
              if (isAudioFileValid(res.uri) && res.uri === canonical) {
                await entriesDao.setAudioCached(existing.id, true, canonical);
              }
            }
          } catch {
            // Non-fatal promotion attempt
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
