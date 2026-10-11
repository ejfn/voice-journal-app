import { Directory, File, Paths } from "expo-file-system";
import { getEntryAudioPath, getEntryAudioTempPath } from "./paths";

/**
 * Ensures that the parent directory for a target audio file exists.
 */
export async function ensureAudioDirectoryExists(
  targetFilePath: string,
): Promise<void> {
  const dirPath = targetFilePath.substring(
    0,
    targetFilePath.lastIndexOf("/") + 1,
  );
  if (!dirPath) return;

  try {
    const directory = new Directory(dirPath);
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
  } catch (err) {
    // Directory might already exist or was created concurrently
    console.warn("Could not create audio directory:", dirPath, err);
  }
}

/**
 * Checks whether an audio file exists on the local filesystem and is non-empty.
 */
export function isAudioFileValid(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== "string" || uri.trim().length === 0) {
    return false;
  }

  try {
    const file = new File(uri);
    if (!file.exists) {
      return false;
    }
    if (typeof file.size === "number" && file.size <= 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface PersistResult {
  uri: string;
  method: "in-place" | "copied" | "moved" | "fallback-temp";
}

/**
 * Robustly persists a recorded audio file into its destination sandbox path.
 *
 * Resilience steps:
 * 1. If source and destination are identical, validates file existence and non-zero size.
 * 2. Attempts copy with overwrite to destination path.
 * 3. If copy fails (e.g. low free disk space preventing double allocation), attempts atomic move.
 * 4. If copy and move to destination both fail, but the source file has valid bytes,
 *    retains the source URI as a last-ditch fallback so audio is not lost.
 * 5. If no valid file can be saved or verified, throws a loud error alerting about full storage.
 */
export async function persistAudioFile(
  sourceUri: string,
  destinationUri: string,
): Promise<PersistResult> {
  if (!sourceUri) {
    throw new Error(
      "Audio recording failed: temporary recording path is missing.",
    );
  }

  // 1. In-place recording directly at destination
  if (sourceUri === destinationUri) {
    if (!isAudioFileValid(destinationUri)) {
      throw new Error(
        "Audio recording could not be saved or file is empty. Your device storage may be full.",
      );
    }
    return { uri: destinationUri, method: "in-place" };
  }

  const sourceFile = new File(sourceUri);
  if (!isAudioFileValid(sourceUri)) {
    throw new Error(
      "Recorded audio file is missing or empty. Please check available device storage.",
    );
  }

  await ensureAudioDirectoryExists(destinationUri);
  const targetFile = new File(destinationUri);
  let persisted = false;
  let method: PersistResult["method"] = "copied";

  // 2. Try atomic move first (instantaneous rename in the same directory, 0 extra disk bytes)
  try {
    if (targetFile.exists) {
      try {
        targetFile.delete();
      } catch {
        // Non-fatal
      }
    }
    await sourceFile.move(targetFile);
    if (isAudioFileValid(destinationUri)) {
      persisted = true;
      method = "moved";
    }
  } catch (moveErr) {
    console.warn(
      "Direct audio move failed, attempting copy fallback:",
      moveErr,
    );
  }

  // 3. Fallback to copy with overwrite (e.g. cross-partition EXDEV)
  if (!persisted) {
    try {
      if (targetFile.exists) {
        try {
          targetFile.delete();
        } catch {
          // Non-fatal
        }
      }
      await sourceFile.copy(targetFile);
      if (isAudioFileValid(destinationUri)) {
        persisted = true;
        method = "copied";
        // Clean up source file
        try {
          if (sourceFile.exists) {
            sourceFile.delete();
          }
        } catch {
          // Non-fatal
        }
      }
    } catch (copyErr) {
      console.warn("Audio copy fallback failed:", copyErr);
    }
  }

  // 4. Critical resilience: if target cannot be written, but source has valid data,
  // ONLY preserve source if it is already located in the permanent document sandbox.
  // Never report fallback-temp for volatile cache URIs (e.g. from DocumentPicker or cache recovery),
  // which would cause callers to store volatile paths in SQLite that the OS later purges.
  const isSourceInPermanentSandbox =
    Boolean(Paths.document?.uri) && sourceUri.startsWith(Paths.document.uri);

  if (!persisted && isSourceInPermanentSandbox && isAudioFileValid(sourceUri)) {
    console.warn(
      "Could not write to sandbox destination; preserving permanent sandbox temporary audio file to avoid data loss:",
      sourceUri,
    );
    return { uri: sourceUri, method: "fallback-temp" };
  }

  if (!persisted) {
    throw new Error(
      "Audio recording could not be saved to storage. Your device may be out of disk space.",
    );
  }

  return { uri: destinationUri, method };
}

/**
 * Searches the temporary cache directory for an un-copied recording file
 * for this entry and recovers it into the canonical sandbox destination.
 *
 * This restores lost recordings on devices where a copy failed during recording stop.
 */
export async function recoverAudioFromCache(
  entryId: string,
  createdAt: number,
): Promise<string | null> {
  const canonicalPath = getEntryAudioPath(entryId, createdAt);
  if (isAudioFileValid(canonicalPath)) {
    return canonicalPath;
  }

  const sandboxTempPath = getEntryAudioTempPath(entryId, createdAt);
  const cacheDir = Paths.cache?.uri ? Paths.cache.uri.replace(/\/+$/, "") : "";

  const candidateUris: string[] = [
    sandboxTempPath,
    sandboxTempPath.replace(`.m4a`, `.tmp.m4a`),
    sandboxTempPath.replace(`recording_${entryId}.m4a`, `${entryId}.tmp.m4a`),
    sandboxTempPath.replace(
      `recording_${entryId}.m4a`,
      `recording_${entryId}.tmp.m4a`,
    ),
  ];

  if (cacheDir) {
    candidateUris.push(
      `${cacheDir}/recording_${entryId}.m4a`,
      `${cacheDir}/${entryId}.m4a`,
      `${cacheDir}/recording_${entryId}.tmp.m4a`,
      `${cacheDir}/${entryId}.tmp.m4a`,
    );
  }

  for (const candidateUri of candidateUris) {
    // If another concurrent recovery task already finalized canonicalPath, return it immediately
    if (isAudioFileValid(canonicalPath)) {
      return canonicalPath;
    }

    if (isAudioFileValid(candidateUri)) {
      try {
        const result = await persistAudioFile(candidateUri, canonicalPath);
        if (isAudioFileValid(result.uri)) {
          return result.uri;
        }
      } catch (err) {
        console.warn(
          "Failed to recover audio from candidate:",
          candidateUri,
          err,
        );
      }
    }
  }

  // Final check: if a concurrent recovery won the race while iterating candidates, return canonicalPath
  if (isAudioFileValid(canonicalPath)) {
    return canonicalPath;
  }

  return null;
}
