import {
  TranscriptionQueueService,
  TranscriptionEvent,
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

  it("retains queued status when encountering a network error (offline)", async () => {
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([mockEntry]);
    (geminiService.analyzeAudio as jest.Mock).mockRejectedValue(
      new Error("Network request failed"),
    );

    const listenerEvents: TranscriptionEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(entriesDao.updateTranscriptionStatus).toHaveBeenCalledWith(
      "entry-q1",
      "queued",
    );
    expect(listenerEvents).toContainEqual({
      entryId: "entry-q1",
      status: "queued",
    });
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
});
