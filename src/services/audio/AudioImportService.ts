import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { entriesDao } from "../../db/dao/entriesDao";
import { syncQueueDao } from "../../db/dao/syncQueueDao";
import { JournalEntry } from "../../db/schema";
import { getEntryAudioPath } from "../../utils/paths";
import { generateUUID } from "../../utils/uuid";

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

      // Ensure directory exists
      const dir = destinationPath.substring(
        0,
        destinationPath.lastIndexOf("/") + 1,
      );
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }

      // Copy from temporary cache to sandbox
      await FileSystem.copyAsync({
        from: asset.uri,
        to: destinationPath,
      });

      const title =
        asset.name.replace(/\.[^/.]+$/, "").trim() || "Imported Audio";

      const entry: JournalEntry = {
        id: entryId,
        title,
        summary: "Imported audio waiting for transcription and summary...",
        transcript: "Imported audio recording.",
        tags: ["imported"],
        duration_sec: 60, // Estimate if unknown
        source_type: "imported",
        local_audio_path: destinationPath,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        updated_at: now,
        last_accessed_at: now,
      };

      await entriesDao.insertEntry(entry);
      await syncQueueDao.enqueue({
        entry_id: entryId,
        action: "ANALYZE_AND_UPLOAD",
      });

      importedResults.push({
        entryId,
        name: asset.name,
        localPath: destinationPath,
        size: asset.size,
      });
    }

    return importedResults;
  }
}

export const audioImportService = new AudioImportService();
