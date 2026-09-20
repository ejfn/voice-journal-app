import { JournalEntry } from "../db/schema";
import { ThemeColors } from "../theme/colors";

export type StorageSyncStatus =
  "local-only" | "syncing" | "synced" | "cloud-only";

export interface StorageStatusOptions {
  isItemSyncing?: boolean;
  isDriveConnected?: boolean;
}

/**
 * Computes the Google Photos-style storage / sync status for a voice entry.
 *
 * 1. Cloud-only: Audio was evicted locally from cache to save space, master copy in Drive.
 * 2. Syncing: Currently uploading audio/metadata to Drive.
 * 3. Synced: Safely stored in Google Drive, up-to-date with local changes, and cached locally.
 * 4. Local-only: Recorded on device, not backed up to Drive (or pending upload).
 */
export function computeStorageStatus(
  entry: JournalEntry,
  options?: StorageStatusOptions,
): StorageSyncStatus {
  // If actively uploading or syncing this specific entry
  if (options?.isItemSyncing) {
    return "syncing";
  }

  // Cloud-only: audio was evicted locally, but exists in Google Drive
  if (
    entry.is_audio_cached === 0 &&
    (entry.drive_audio_file_id || entry.drive_sidecar_file_id)
  ) {
    return "cloud-only";
  }

  // Synced: Sidecar present in Drive, audio backed up (if recorded), and local changes synced
  const hasCloudSidecar = Boolean(entry.drive_sidecar_file_id);
  const isAudioConfirmed =
    entry.source_type === "recorded"
      ? Boolean(entry.drive_audio_file_id)
      : true;
  const isUpToDate =
    entry.drive_synced_at != null &&
    (entry.updated_at == null || entry.drive_synced_at >= entry.updated_at);

  if (
    hasCloudSidecar &&
    isAudioConfirmed &&
    isUpToDate &&
    entry.is_audio_cached === 1
  ) {
    return "synced";
  }

  // Default: on device only / pending backup to Google Drive
  return "local-only";
}

export type StorageBadgeIconName =
  "cloud-done" | "cloud-upload" | "cloud-download" | "cloud-off";

export interface StorageBadgeConfig {
  status: StorageSyncStatus;
  iconName: StorageBadgeIconName;
  label: string;
  color: string;
  description: string;
}

export function getStorageBadgeConfig(
  status: StorageSyncStatus,
  colors: ThemeColors,
): StorageBadgeConfig {
  switch (status) {
    case "synced":
      return {
        status,
        iconName: "cloud-done",
        label: "Synced",
        color: colors.success,
        description: "Safely backed up in Google Drive & cached locally",
      };
    case "syncing":
      return {
        status,
        iconName: "cloud-upload",
        label: "Syncing",
        color: colors.primary,
        description: "Uploading to Google Drive",
      };
    case "cloud-only":
      return {
        status,
        iconName: "cloud-download",
        label: "Cloud only",
        color: colors.accent,
        description: "Stored in Google Drive • Tap to stream or download",
      };
    case "local-only":
    default:
      return {
        status,
        iconName: "cloud-off",
        label: "On device",
        color: colors.textMuted,
        description: "Stored on device only • Pending cloud backup",
      };
  }
}
