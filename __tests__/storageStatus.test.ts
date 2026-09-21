import {
  computeStorageStatus,
  getStorageBadgeConfig,
  isEntryActivelyTransferring,
} from "../src/utils/storageStatus";
import { JournalEntry } from "../src/db/schema";
import { lightColors } from "../src/theme/colors";

describe("Storage Status Computation (Issue #11)", () => {
  const baseEntry: JournalEntry = {
    id: "test-entry-1",
    title: "Test Voice Note",
    summary: "A test entry",
    transcript: "Test speech",
    tags: ["test"],
    duration_sec: 10,
    source_type: "recorded",
    local_audio_path: "file:///mock/test.m4a",
    drive_audio_file_id: null,
    drive_sidecar_file_id: null,
    is_audio_cached: 1,
    created_at: 1000,
    updated_at: 1000,
    drive_synced_at: null,
    last_accessed_at: 1000,
  };

  it("returns 'local-only' when entry has not been backed up to Drive", () => {
    const status = computeStorageStatus(baseEntry);
    expect(status).toBe("local-only");

    const badge = getStorageBadgeConfig(status, lightColors);
    expect(badge.iconName).toBe("cloud-off");
    expect(badge.label).toBe("Local");
    expect(badge.description).toBe("Pending backup");
  });

  it("returns 'syncing' when options.isItemSyncing is true", () => {
    const status = computeStorageStatus(baseEntry, { isItemSyncing: true });
    expect(status).toBe("syncing");

    const badge = getStorageBadgeConfig(status, lightColors);
    expect(badge.iconName).toBe("cloud-upload");
    expect(badge.label).toBe("Syncing");
    expect(badge.description).toBe("Uploading");
  });

  it("uses download-specific syncing badge details during active download", () => {
    const status = computeStorageStatus(baseEntry, { isItemSyncing: true });
    expect(status).toBe("syncing");

    const badge = getStorageBadgeConfig(status, lightColors, "download");
    expect(badge.iconName).toBe("cloud-download");
    expect(badge.label).toBe("Syncing");
    expect(badge.description).toBe("Downloading");
  });

  it("does not treat a global SmartSync scan as per-entry syncing (issue #28)", () => {
    // Startup/reconciliation only checks Drive — no entry-level transfer.
    // isItemSyncing must stay false unless this entry is actively transferring.
    const syncedEntry: JournalEntry = {
      ...baseEntry,
      drive_audio_file_id: "audio-file-123",
      drive_sidecar_file_id: "sidecar-file-456",
      drive_synced_at: 2000,
      updated_at: 1500,
      is_audio_cached: 1,
    };

    const isActivelyTransferring = isEntryActivelyTransferring(syncedEntry.id, {
      uploadingEntryIds: new Set(), // nothing uploading
      downloadingEntryIds: new Set(),
    });
    expect(isActivelyTransferring).toBe(false);

    const status = computeStorageStatus(syncedEntry, {
      isItemSyncing: isActivelyTransferring,
    });
    expect(status).toBe("synced");
  });

  it("marks an entry as actively transferring only when it is uploading or downloading", () => {
    expect(
      isEntryActivelyTransferring("entry-a", {
        uploadingEntryIds: new Set(["entry-a"]),
        downloadingEntryIds: new Set(),
      }),
    ).toBe(true);

    expect(
      isEntryActivelyTransferring("entry-b", {
        uploadingEntryIds: new Set(["entry-a"]),
        downloadingEntryIds: new Set(["entry-b"]),
      }),
    ).toBe(true);

    expect(
      isEntryActivelyTransferring("entry-c", {
        uploadingEntryIds: new Set(["entry-a"]),
        downloadingEntryIds: new Set(["entry-b"]),
      }),
    ).toBe(false);
  });

  it("returns 'synced' when audio and sidecar are in Drive and synced_at >= updated_at", () => {
    const syncedEntry: JournalEntry = {
      ...baseEntry,
      drive_audio_file_id: "audio-file-123",
      drive_sidecar_file_id: "sidecar-file-456",
      drive_synced_at: 2000,
      updated_at: 1500,
      is_audio_cached: 1,
    };

    const status = computeStorageStatus(syncedEntry);
    expect(status).toBe("synced");

    const badge = getStorageBadgeConfig(status, lightColors);
    expect(badge.iconName).toBe("cloud-done");
    expect(badge.label).toBe("Synced");
    expect(badge.color).toBe(lightColors.success);
    expect(badge.description).toBe("Backed up");
  });

  it("returns 'local-only' if local entry was edited after Drive sync (pending re-upload)", () => {
    const pendingUploadEntry: JournalEntry = {
      ...baseEntry,
      drive_audio_file_id: "audio-file-123",
      drive_sidecar_file_id: "sidecar-file-456",
      drive_synced_at: 2000,
      updated_at: 2500, // Modified after sync!
      is_audio_cached: 1,
    };

    const status = computeStorageStatus(pendingUploadEntry);
    expect(status).toBe("local-only");
  });

  it("returns 'cloud-only' when audio is evicted locally (is_audio_cached = 0) but exists in Drive", () => {
    const cloudOnlyEntry: JournalEntry = {
      ...baseEntry,
      drive_audio_file_id: "audio-file-123",
      drive_sidecar_file_id: "sidecar-file-456",
      drive_synced_at: 2000,
      is_audio_cached: 0,
      local_audio_path: null,
    };

    const status = computeStorageStatus(cloudOnlyEntry);
    expect(status).toBe("cloud-only");

    const badge = getStorageBadgeConfig(status, lightColors);
    expect(badge.iconName).toBe("cloud-download");
    expect(badge.label).toBe("Cloud");
    expect(badge.description).toBe("Tap play to download");
  });
});
