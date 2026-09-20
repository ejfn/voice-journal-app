import { AppState } from "react-native";
import { SmartSyncService } from "../src/services/drive/SmartSyncService";
import { googleDriveService } from "../src/services/drive/GoogleDriveService";
import { uploadQueueService } from "../src/services/drive/UploadQueueService";
import { settingsDao } from "../src/db/dao/settingsDao";

jest.mock("../src/services/drive/GoogleDriveService");
jest.mock("../src/services/drive/UploadQueueService");
jest.mock("../src/db/dao/settingsDao");

describe("SmartSyncService", () => {
  let service: SmartSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new SmartSyncService();

    (googleDriveService.getCurrentUser as jest.Mock).mockReturnValue({
      email: "test@gmail.com",
      name: "Test User",
    });
    (googleDriveService.syncTwoWay as jest.Mock).mockResolvedValue({
      uploadedCount: 2,
      downloadedCount: 1,
    });
    (googleDriveService.runLruEviction as jest.Mock).mockResolvedValue(0);
    (uploadQueueService.processQueue as jest.Mock).mockResolvedValue(undefined);
    (settingsDao.setSetting as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    service.stopAutoSync();
    jest.useRealTimers();
  });

  it("does not sync if user is not signed into Google Drive", async () => {
    (googleDriveService.getCurrentUser as jest.Mock).mockReturnValue(null);

    const result = await service.sync();

    expect(result).toEqual({ uploadedCount: 0, downloadedCount: 0 });
    expect(googleDriveService.syncTwoWay).not.toHaveBeenCalled();
    expect(uploadQueueService.processQueue).not.toHaveBeenCalled();
  });

  it("performs full two-way smart sync and notifies listeners", async () => {
    const events: string[] = [];
    service.addListener((e) => events.push(e.status));

    const result = await service.sync({ force: true });

    expect(result).toEqual({ uploadedCount: 2, downloadedCount: 1 });
    expect(googleDriveService.syncTwoWay).toHaveBeenCalled();
    expect(googleDriveService.runLruEviction).toHaveBeenCalled();
    expect(uploadQueueService.processQueue).toHaveBeenCalled();
    expect(settingsDao.setSetting).toHaveBeenCalledWith(
      "last_synced_at",
      expect.any(String),
    );
    expect(events).toEqual(["syncing", "synced"]);
  });

  it("respects cooldown: skips duplicate auto-sync calls within cooldown period", async () => {
    // First sync (forced)
    await service.sync({ force: true });
    expect(googleDriveService.syncTwoWay).toHaveBeenCalledTimes(1);

    // Immediate second auto-sync (not forced, within 20s cooldown)
    const result = await service.sync({ force: false });
    expect(result).toEqual({ uploadedCount: 0, downloadedCount: 0 });
    expect(googleDriveService.syncTwoWay).toHaveBeenCalledTimes(1);

    // Fast-forward past 20s cooldown
    jest.advanceTimersByTime(25_000);

    // Third auto-sync (now past cooldown)
    await service.sync({ force: false });
    expect(googleDriveService.syncTwoWay).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent sync requests into a follow-up sync", async () => {
    let resolveFirstSync: (val: {
      uploadedCount: number;
      downloadedCount: number;
    }) => void;
    const firstSyncPromise = new Promise<{
      uploadedCount: number;
      downloadedCount: number;
    }>((resolve) => {
      resolveFirstSync = resolve;
    });

    (googleDriveService.syncTwoWay as jest.Mock).mockImplementationOnce(
      () => firstSyncPromise,
    );

    // Trigger first sync
    const sync1 = service.sync({ force: true });
    expect(service.getIsSyncing()).toBe(true);

    // Trigger second sync while first is still running
    const sync2 = service.sync({ force: true });
    expect(await sync2).toEqual({ uploadedCount: 0, downloadedCount: 0 });

    // Complete first sync
    resolveFirstSync!({ uploadedCount: 1, downloadedCount: 0 });
    await sync1;

    // Fast forward timer to trigger coalesced followup
    jest.advanceTimersByTime(1100);
    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    // Total calls should be 2 (initial sync + coalesced followup)
    expect(googleDriveService.syncTwoWay).toHaveBeenCalledTimes(2);
  });

  it("handles errors silently in background mode without throwing", async () => {
    (googleDriveService.syncTwoWay as jest.Mock).mockRejectedValue(
      new Error("Network unavailable"),
    );

    const events: string[] = [];
    service.addListener((e) => events.push(e.status));

    // Background sync (force: false) should NOT throw
    const result = await service.sync({ force: false });
    expect(result).toEqual({ uploadedCount: 0, downloadedCount: 0 });
    expect(events).toContain("error");
  });

  it("throws errors in forced mode so caller can handle UI feedback", async () => {
    (googleDriveService.syncTwoWay as jest.Mock).mockRejectedValue(
      new Error("Authentication failed"),
    );

    await expect(service.sync({ force: true })).rejects.toThrow(
      "Authentication failed",
    );
  });

  it("registers AppState listener and periodic interval on startAutoSync", () => {
    const addEventListenerSpy = jest.spyOn(AppState, "addEventListener");

    service.startAutoSync();

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    // Fast forward periodic interval (120s)
    jest.advanceTimersByTime(125_000);
    expect(googleDriveService.syncTwoWay).toHaveBeenCalled();

    service.stopAutoSync();
  });
});
