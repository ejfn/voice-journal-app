import {
  UploadQueueService,
  UploadEvent,
  getUploadBackoffDelayMs,
} from "../src/services/drive/UploadQueueService";
import { entriesDao } from "../src/db/dao/entriesDao";
import { syncQueueDao } from "../src/db/dao/syncQueueDao";
import { googleDriveService } from "../src/services/drive/GoogleDriveService";
import { JournalEntry, SyncQueueItem } from "../src/db/schema";

jest.mock("../src/db/dao/entriesDao");
jest.mock("../src/db/dao/syncQueueDao");
jest.mock("../src/services/drive/GoogleDriveService");

describe("UploadQueueService", () => {
  let service: UploadQueueService;

  const mockEntry: JournalEntry = {
    id: "entry-u1",
    title: "Voice Recording",
    summary: "A recording about work.",
    transcript: "Work progress today.",
    tags: ["work"],
    duration_sec: 20,
    source_type: "recorded",
    local_audio_path: "file:///mock/audio.m4a",
    drive_audio_file_id: null,
    drive_sidecar_file_id: null,
    is_audio_cached: 1,
    created_at: 1000,
    last_accessed_at: 1000,
    transcription_status: "completed",
  };

  const mockQueueItem: SyncQueueItem = {
    id: "queue-1",
    entry_id: "entry-u1",
    action: "ANALYZE_AND_UPLOAD",
    status: "PENDING",
    retry_count: 0,
    created_at: 1000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadQueueService();
    (googleDriveService.getCurrentUser as jest.Mock).mockReturnValue({
      email: "test@gmail.com",
      name: "Test User",
    });
    (entriesDao.getUnsyncedEntries as jest.Mock).mockResolvedValue([]);
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([]);
  });

  it("does not process uploads if Google Drive is not connected", async () => {
    (googleDriveService.getCurrentUser as jest.Mock).mockReturnValue(null);

    await service.processQueue();

    expect(syncQueueDao.getPendingItems).not.toHaveBeenCalled();
    expect(googleDriveService.uploadEntry).not.toHaveBeenCalled();
  });

  it("processes pending upload queue item and notifies listeners", async () => {
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([
      mockQueueItem,
    ]);
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue(mockEntry);
    (googleDriveService.uploadEntry as jest.Mock).mockResolvedValue({
      audioFileId: "drive-audio-1",
      sidecarFileId: "drive-sidecar-1",
    });

    const listenerEvents: UploadEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(syncQueueDao.updateStatus).toHaveBeenCalledWith(
      "queue-1",
      "PROCESSING",
    );
    expect(googleDriveService.uploadEntry).toHaveBeenCalledWith(mockEntry);
    expect(syncQueueDao.deleteItem).toHaveBeenCalledWith("queue-1");
    expect(listenerEvents).toEqual([
      { entryId: "entry-u1", status: "uploading" },
      { entryId: "entry-u1", status: "synced" },
    ]);
  });

  it("ensures no missed uploads: enqueueAllUnsynced finds and enqueues unsynced entries", async () => {
    (entriesDao.getUnsyncedEntries as jest.Mock).mockResolvedValue([mockEntry]);
    (syncQueueDao.getItemByEntryId as jest.Mock).mockResolvedValue(null);

    await service.enqueueAllUnsynced();

    expect(entriesDao.getUnsyncedEntries).toHaveBeenCalled();
    expect(syncQueueDao.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_id: "entry-u1",
        action: "ANALYZE_AND_UPLOAD",
        status: "PENDING",
      }),
    );
  });

  it("schedules retry with exponential backoff on upload error", async () => {
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([
      { ...mockQueueItem, retry_count: 0 },
    ]);
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue(mockEntry);
    (googleDriveService.uploadEntry as jest.Mock).mockRejectedValue(
      new Error("Network request failed"),
    );

    const listenerEvents: UploadEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(syncQueueDao.updateStatus).toHaveBeenCalledWith(
      "queue-1",
      "PENDING",
      1,
    );
    expect(listenerEvents).toContainEqual({
      entryId: "entry-u1",
      status: "uploading",
    });

    service.cancelScheduledRetry();
  });

  it("marks as failed after exceeding max upload retries", async () => {
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([
      { ...mockQueueItem, retry_count: 5 },
    ]);
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue(mockEntry);
    (googleDriveService.uploadEntry as jest.Mock).mockRejectedValue(
      new Error("Permanent API error"),
    );

    const listenerEvents: UploadEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(syncQueueDao.updateStatus).toHaveBeenCalledWith(
      "queue-1",
      "FAILED",
      5,
    );
    expect(listenerEvents).toContainEqual({
      entryId: "entry-u1",
      status: "failed",
    });
  });

  it("handles race condition when local metadata changes while upload is in flight", async () => {
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([
      mockQueueItem,
    ]);
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue(mockEntry);
    (syncQueueDao.getItemById as jest.Mock).mockResolvedValue(mockQueueItem);
    // Simulate uploadEntry reporting raceDetected: true (e.g. transcript finished during upload)
    (googleDriveService.uploadEntry as jest.Mock).mockResolvedValue({
      audioFileId: "drive-audio-1",
      sidecarFileId: "drive-sidecar-1",
      raceDetected: true,
    });

    const listenerEvents: UploadEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    // Must NOT delete the item from the queue!
    expect(syncQueueDao.deleteItem).not.toHaveBeenCalled();
    // Must update action to METADATA_ONLY and reset status to PENDING
    expect(syncQueueDao.updateAction).toHaveBeenCalledWith(
      "queue-1",
      "METADATA_ONLY",
    );
    expect(syncQueueDao.updateStatus).toHaveBeenCalledWith(
      "queue-1",
      "PENDING",
      0,
    );
    // Must NOT emit 'synced' event because metadata is still unsynced
    expect(listenerEvents).not.toContainEqual(
      expect.objectContaining({ status: "synced" }),
    );
  });

  it("handles race condition when queue item is re-enqueued as PENDING while upload is in flight", async () => {
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([
      mockQueueItem,
    ]);
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue(mockEntry);
    // While upload was in flight, another caller called enqueueUpload, resetting status to PENDING
    (syncQueueDao.getItemById as jest.Mock).mockResolvedValue({
      ...mockQueueItem,
      status: "PENDING",
    });
    (googleDriveService.uploadEntry as jest.Mock).mockResolvedValue({
      audioFileId: "drive-audio-1",
      sidecarFileId: "drive-sidecar-1",
      raceDetected: false,
    });

    await service.processQueue();

    // Must NOT delete the item from queue
    expect(syncQueueDao.deleteItem).not.toHaveBeenCalled();
    expect(syncQueueDao.updateAction).toHaveBeenCalledWith(
      "queue-1",
      "METADATA_ONLY",
    );
    expect(syncQueueDao.updateStatus).toHaveBeenCalledWith(
      "queue-1",
      "PENDING",
      0,
    );
  });

  it("skips and drops queue item if entry is soft-deleted (deleted_at is set)", async () => {
    const softDeletedEntry: JournalEntry = {
      ...mockEntry,
      deleted_at: Date.now(),
    };
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([
      mockQueueItem,
    ]);
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue(softDeletedEntry);

    await service.processQueue();

    // Must delete from sync queue and NOT upload to Drive
    expect(syncQueueDao.deleteItem).toHaveBeenCalledWith("queue-1");
    expect(googleDriveService.uploadEntry).not.toHaveBeenCalled();
  });

  it("processes queue item if soft-deleted entry has existing drive_sidecar_file_id", async () => {
    const syncedSoftDeletedEntry: JournalEntry = {
      ...mockEntry,
      drive_sidecar_file_id: "sidecar-existing-1",
      deleted_at: Date.now(),
    };
    (syncQueueDao.getPendingItems as jest.Mock).mockResolvedValue([
      mockQueueItem,
    ]);
    (syncQueueDao.getItemById as jest.Mock).mockResolvedValue({
      ...mockQueueItem,
      status: "PROCESSING",
    });
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue(
      syncedSoftDeletedEntry,
    );
    (googleDriveService.uploadEntry as jest.Mock).mockResolvedValue({
      audioFileId: "audio-1",
      sidecarFileId: "sidecar-existing-1",
    });

    await service.processQueue();

    expect(googleDriveService.uploadEntry).toHaveBeenCalledWith(
      syncedSoftDeletedEntry,
    );
    expect(syncQueueDao.deleteItem).toHaveBeenCalledWith("queue-1");
  });

  it("calculates graduated upload backoff delays correctly", () => {
    expect(getUploadBackoffDelayMs(0)).toBe(5000);
    expect(getUploadBackoffDelayMs(1)).toBe(15000);
    expect(getUploadBackoffDelayMs(2)).toBe(45000);
    expect(getUploadBackoffDelayMs(3)).toBe(120000);
    expect(getUploadBackoffDelayMs(4)).toBe(300000);
    expect(getUploadBackoffDelayMs(10)).toBe(300000);
  });

  it("enqueues METADATA_ONLY upload when transcription completes", () => {
    let capturedListener:
      ((event: { entryId: string; status: string }) => void) | null = null;
    const mockTranscriptionService = {
      addListener: jest.fn((cb) => {
        capturedListener = cb;
        return () => {};
      }),
    };

    const enqueueSpy = jest.spyOn(service, "enqueueUpload").mockResolvedValue();
    service.attachTranscriptionListener(
      mockTranscriptionService as unknown as Parameters<
        typeof service.attachTranscriptionListener
      >[0],
    );

    expect(mockTranscriptionService.addListener).toHaveBeenCalled();
    if (capturedListener) {
      (
        capturedListener as (event: { entryId: string; status: string }) => void
      )({
        entryId: "entry-u1",
        status: "completed",
      });
    }

    expect(enqueueSpy).toHaveBeenCalledWith("entry-u1", "METADATA_ONLY");
    enqueueSpy.mockRestore();
  });
});
