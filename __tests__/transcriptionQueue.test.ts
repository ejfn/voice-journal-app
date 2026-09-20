import {
  TranscriptionQueueService,
  TranscriptionEvent,
  getBackoffDelayMs,
} from "../src/services/ai/TranscriptionQueueService";
import { entriesDao } from "../src/db/dao/entriesDao";
import { geminiService } from "../src/services/ai/GeminiService";
import { googleDriveService } from "../src/services/drive/GoogleDriveService";
import { JournalEntry } from "../src/db/schema";
import * as FileSystem from "expo-file-system/legacy";

jest.mock("../src/db/dao/entriesDao");
jest.mock("../src/db/dao/syncQueueDao");
jest.mock("../src/services/ai/GeminiService");
jest.mock("../src/services/drive/GoogleDriveService");
jest.mock("expo-file-system/legacy");

describe("TranscriptionQueueService", () => {
  let service: TranscriptionQueueService;

  const mockEntry: JournalEntry = {
    id: "entry-q1",
    title: "Voice Recording",
    summary: "Queued...",
    transcript: "",
    tags: ["voice"],
    duration_sec: 15,
    source_type: "recorded",
    local_audio_path: "file:///mock/audio.m4a",
    drive_audio_file_id: null,
    drive_sidecar_file_id: null,
    is_audio_cached: 1,
    created_at: 1000,
    last_accessed_at: 1000,
    transcription_status: "queued",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TranscriptionQueueService();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    (geminiService.hasKeyConfigured as jest.Mock).mockResolvedValue(true);
  });

  it("processes queued entries successfully and notifies listeners", async () => {
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([mockEntry]);
    (geminiService.analyzeAudio as jest.Mock).mockResolvedValue({
      title: "Grocery Shopping",
      summary: "Bought milk and apples.",
      transcript: "I went grocery shopping and got milk and apples.",
      tags: ["groceries", "shopping"],
    });
    (googleDriveService.getCurrentUser as jest.Mock).mockReturnValue(null);

    const listenerEvents: TranscriptionEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(entriesDao.updateTranscriptionStatus).toHaveBeenCalledWith(
      "entry-q1",
      "processing",
    );
    expect(entriesDao.updateTranscription).toHaveBeenCalledWith("entry-q1", {
      title: "Grocery Shopping",
      summary: "Bought milk and apples.",
      transcript: "I went grocery shopping and got milk and apples.",
      tags: ["groceries", "shopping"],
      transcription_status: "completed",
    });

    expect(listenerEvents).toEqual([
      { entryId: "entry-q1", status: "processing" },
      { entryId: "entry-q1", status: "completed" },
    ]);
  });

  it("calculates graduated backoff intervals correctly", () => {
    expect(getBackoffDelayMs(0)).toBe(5000); // Attempt 1: 5s
    expect(getBackoffDelayMs(1)).toBe(15000); // Attempt 2: 15s
    expect(getBackoffDelayMs(2)).toBe(45000); // Attempt 3: 45s
    expect(getBackoffDelayMs(3)).toBe(120000); // Attempt 4: 2m
    expect(getBackoffDelayMs(4)).toBe(300000); // Attempt 5: 5m
    expect(getBackoffDelayMs(10)).toBe(300000); // Max delay capped at 5m
  });

  it("schedules next retry with backoff interval when an error occurs", async () => {
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
      { ...mockEntry, transcription_retry_count: 0 },
    ]);
    (geminiService.analyzeAudio as jest.Mock).mockRejectedValue(
      new Error("Network request failed"),
    );

    const listenerEvents: TranscriptionEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    const beforeTime = Date.now();
    await service.processQueue();

    expect(entriesDao.recordTranscriptionFailure).toHaveBeenCalledWith(
      "entry-q1",
      1,
      expect.any(Number),
      "queued",
    );

    const callArgs = (entriesDao.recordTranscriptionFailure as jest.Mock).mock
      .calls[0];
    const scheduledRetryAt = callArgs[2];
    expect(scheduledRetryAt).toBeGreaterThanOrEqual(beforeTime + 5000);

    expect(listenerEvents).toContainEqual({
      entryId: "entry-q1",
      status: "queued",
    });

    service.cancelScheduledRetry();
  });

  it("marks as failed after exceeding max transcription retries", async () => {
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
      { ...mockEntry, transcription_retry_count: 5 },
    ]);
    (geminiService.analyzeAudio as jest.Mock).mockRejectedValue(
      new Error("Gemini internal error"),
    );

    const listenerEvents: TranscriptionEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(entriesDao.recordTranscriptionFailure).toHaveBeenCalledWith(
      "entry-q1",
      5,
      null,
      "failed",
    );
    expect(listenerEvents).toContainEqual({
      entryId: "entry-q1",
      status: "failed",
    });
  });

  it("resets retry count when manual retry is triggered", async () => {
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([]);
    await service.retryEntry("entry-q1");

    expect(entriesDao.resetTranscriptionRetry).toHaveBeenCalledWith("entry-q1");
  });

  it("marks as failed when file does not exist", async () => {
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([mockEntry]);
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

    await service.processQueue();

    expect(entriesDao.updateTranscriptionStatus).toHaveBeenCalledWith(
      "entry-q1",
      "failed",
    );
  });

  it("does not process queue and returns early when API key is not configured", async () => {
    (geminiService.hasKeyConfigured as jest.Mock).mockResolvedValue(false);
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([mockEntry]);

    await service.processQueue();

    expect(entriesDao.getQueuedEntries).not.toHaveBeenCalled();
    expect(entriesDao.updateTranscriptionStatus).not.toHaveBeenCalled();
  });

  it("immediately marks entry as failed without retry backoff when API key is invalid", async () => {
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
      { ...mockEntry, transcription_retry_count: 0 },
    ]);
    (geminiService.analyzeAudio as jest.Mock).mockRejectedValue(
      new Error("API key not valid. Please pass a valid API key."),
    );

    const listenerEvents: TranscriptionEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(entriesDao.recordTranscriptionFailure).toHaveBeenCalledWith(
      "entry-q1",
      0,
      null,
      "failed",
    );
    expect(listenerEvents).toContainEqual({
      entryId: "entry-q1",
      status: "failed",
    });
  });
});
