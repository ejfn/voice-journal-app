import * as DocumentPicker from "expo-document-picker";
import { createAudioPlayer } from "expo-audio";
import { entriesDao } from "../../db/dao/entriesDao";
import { uploadQueueService } from "../drive/UploadQueueService";
import { JournalEntry } from "../../db/schema";
import { getEntryAudioPath } from "../../utils/paths";
import { persistAudioFile } from "../../utils/audioPersistence";
import { generateUUID } from "../../utils/uuid";

/**
 * Probes an audio file's actual duration in seconds by temporarily creating
 * an AudioPlayer and polling until the duration is populated (up to 3s).
 * Returns 0 if duration cannot be determined within the timeout.
 */
async function probeAudioDuration(uri: string): Promise<number> {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  try {
    player = createAudioPlayer({ uri });
    // Poll up to 3 seconds (30 × 100ms) for the player to report a valid duration
    for (let i = 0; i < 30; i++) {
      const dur = (player as { duration?: number }).duration;
      if (typeof dur === "number" && dur > 0) {
        return Math.round(dur);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return 0;
  } catch {
    return 0;
  } finally {
    try {
      (player as { remove?: () => void } | null)?.remove?.();
    } catch {
      // Ignore cleanup errors
    }
  }
}

export interface ImportedAudioResult {
  entryId: string;
  name?: string;
  localPath: string;
  size?: number;
  durationSec?: number;
}

export class AudioImportService {
  async importAudioFiles(): Promise<ImportedAudioResult[]> {
    const pickerResult = await DocumentPicker.getDocumentAsync({
      type: ["audio/*"],
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (
      pickerResult.canceled ||
      !pickerResult.assets ||
      pickerResult.assets.length === 0
    ) {
      return [];
    }

    const importedResults: ImportedAudioResult[] = [];

    for (const asset of pickerResult.assets) {
      const entryId = generateUUID();
      const now = Date.now();
      const destinationPath = getEntryAudioPath(entryId, now);

      const persistResult = await persistAudioFile(asset.uri, destinationPath);
      const finalAudioPath = persistResult.uri;

      // Probe actual duration from the copied file; falls back to 0 if unavailable
      const durationSec = await probeAudioDuration(finalAudioPath);

      const title =
        asset.name.replace(/\.[^/.]+$/, "").trim() || "Imported Audio";

      const entry: JournalEntry = {
        id: entryId,
        title,
        summary: "Imported audio waiting for transcription and summary...",
        transcript: "Imported audio recording.",
        tags: ["imported"],
        duration_sec: durationSec,
        source_type: "imported",
        local_audio_path: finalAudioPath,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        updated_at: now,
        last_accessed_at: now,
        transcription_status: "queued",
      };

      await entriesDao.insertEntry(entry);
      uploadQueueService.enqueueUpload(entryId, "ANALYZE_AND_UPLOAD");

      importedResults.push({
        entryId,
        name: asset.name,
        localPath: finalAudioPath,
        size: asset.size,
        durationSec,
      });
    }

    return importedResults;
  }
}

export const audioImportService = new AudioImportService();
