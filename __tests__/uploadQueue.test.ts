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

  it("calculates graduated upload backoff delays correctly", () => {
    expect(getUploadBackoffDelayMs(0)).toBe(5000);
    expect(getUploadBackoffDelayMs(1)).toBe(15000);
    expect(getUploadBackoffDelayMs(2)).toBe(45000);
    expect(getUploadBackoffDelayMs(3)).toBe(120000);
    expect(getUploadBackoffDelayMs(4)).toBe(300000);
    expect(getUploadBackoffDelayMs(10)).toBe(300000);
  });
});
