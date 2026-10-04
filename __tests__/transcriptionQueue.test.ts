import {
  TranscriptionQueueService,
  TranscriptionEvent,
  getBackoffDelayMs,
  buildContextTail,
} from "../src/services/ai/TranscriptionQueueService";
import { entriesDao } from "../src/db/dao/entriesDao";
import { geminiService } from "../src/services/ai/GeminiService";
import { googleDriveService } from "../src/services/drive/GoogleDriveService";
import { JournalEntry, TranscriptionCheckpoint } from "../src/db/schema";
import { File } from "expo-file-system";
import { VoiceRecorder } from "voice-recorder";

jest.mock("../src/db/dao/entriesDao");
jest.mock("../src/db/dao/syncQueueDao");
jest.mock("../src/services/ai/GeminiService");
jest.mock("../src/services/drive/GoogleDriveService");

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (File as any).defaultExists = true;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (File as any).defaultExists = false;

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

  it("skips cloud-only entries (is_audio_cached = 0) without sending to Gemini or marking as failed", async () => {
    const cloudEntry: JournalEntry = {
      ...mockEntry,
      id: "entry-cloud-1",
      is_audio_cached: 0,
      local_audio_path: null,
      drive_audio_file_id: "drive-audio-cloud-1",
      drive_sidecar_file_id: "drive-sidecar-cloud-1",
    };
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([cloudEntry]);

    const listenerEvents: TranscriptionEvent[] = [];
    service.addListener((event) => listenerEvents.push(event));

    await service.processQueue();

    expect(geminiService.analyzeAudio).not.toHaveBeenCalled();
    expect(entriesDao.updateTranscriptionStatus).not.toHaveBeenCalled();
    expect(listenerEvents).toHaveLength(0);
  });

  it("skips cloud entries with missing local audio path without marking as failed", async () => {
    const cloudEntryWithoutPath: JournalEntry = {
      ...mockEntry,
      id: "entry-cloud-2",
      is_audio_cached: 1,
      local_audio_path: null,
      drive_audio_file_id: "drive-audio-cloud-2",
      drive_sidecar_file_id: "drive-sidecar-cloud-2",
    };
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
      cloudEntryWithoutPath,
    ]);

    await service.processQueue();

    expect(geminiService.analyzeAudio).not.toHaveBeenCalled();
    expect(entriesDao.updateTranscriptionStatus).not.toHaveBeenCalled();
    expect(entriesDao.setAudioCached).toHaveBeenCalledWith(
      "entry-cloud-2",
      false,
      null,
    );
  });

  it("skips cloud entries whose local audio file does not exist, updating is_audio_cached to 0 without failing", async () => {
    const cloudEntryWithMissingFile: JournalEntry = {
      ...mockEntry,
      id: "entry-cloud-3",
      is_audio_cached: 1,
      local_audio_path: "file:///mock/missing.m4a",
      drive_audio_file_id: "drive-audio-cloud-3",
      drive_sidecar_file_id: "drive-sidecar-cloud-3",
    };
    (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
      cloudEntryWithMissingFile,
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (File as any).defaultExists = false;

    await service.processQueue();

    expect(geminiService.analyzeAudio).not.toHaveBeenCalled();
    expect(entriesDao.updateTranscriptionStatus).not.toHaveBeenCalled();
    expect(entriesDao.setAudioCached).toHaveBeenCalledWith(
      "entry-cloud-3",
      false,
      null,
    );
  });

  describe("buildContextTail", () => {
    it("returns the full text when shorter than maxChars", () => {
      const text = "A short sentence.";
      expect(buildContextTail(text, 50)).toBe("A short sentence.");
    });

    it("slices text cleanly on word boundaries when exceeding maxChars", () => {
      const text =
        "The quick brown fox jumps over the lazy dog and then takes a very long afternoon nap in the warm autumn sun.";
      const tail = buildContextTail(text, 40);
      expect(tail.length).toBeLessThanOrEqual(40);
      // Ensures it doesn't start with a broken partial word
      expect(text).toContain(tail);
      expect(tail.startsWith(" ")).toBe(false);
    });
  });

  describe("Long Audio Segmented Transcription", () => {
    const mockLongEntry: JournalEntry = {
      ...mockEntry,
      id: "entry-long-1",
      duration_sec: 1200, // 20 minutes (> 10m threshold)
      local_audio_path: "file:///mock/long_recording.m4a",
    };

    it("extracts long audio chunk-by-chunk on demand and transcribes sequentially with context tail", async () => {
      (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
        mockLongEntry,
      ]);

      const extractSpy = jest
        .spyOn(VoiceRecorder, "extractAudioChunk")
        .mockResolvedValueOnce({
          chunkUri: "file:///cache/chunk_0.m4a",
          durationMs: 300_000,
          isLastChunk: false,
          totalDurationMs: 600_000,
        })
        .mockResolvedValueOnce({
          chunkUri: "file:///cache/chunk_1.m4a",
          durationMs: 300_000,
          isLastChunk: true,
          totalDurationMs: 600_000,
        });

      (geminiService.transcribeChunk as jest.Mock)
        .mockResolvedValueOnce("First part of our extensive lecture.")
        .mockResolvedValueOnce("Second part detailing the final conclusion.");

      (geminiService.analyzeTranscript as jest.Mock).mockResolvedValue({
        title: "Extensive Lecture",
        summary: "Lecture on project conclusions.",
        tags: ["lecture", "conclusion"],
      });

      await service.processQueue();

      expect(extractSpy).toHaveBeenCalledTimes(2);
      expect(extractSpy).toHaveBeenNthCalledWith(
        1,
        "file:///mock/long_recording.m4a",
        0,
        300_000,
        expect.stringContaining("chunks_entry-long-1"),
      );
      expect(extractSpy).toHaveBeenNthCalledWith(
        2,
        "file:///mock/long_recording.m4a",
        300_000,
        300_000,
        expect.stringContaining("chunks_entry-long-1"),
      );

      expect(geminiService.transcribeChunk).toHaveBeenCalledTimes(2);
      expect(geminiService.transcribeChunk).toHaveBeenNthCalledWith(
        1,
        "file:///cache/chunk_0.m4a",
        "",
      );
      expect(geminiService.transcribeChunk).toHaveBeenNthCalledWith(
        2,
        "file:///cache/chunk_1.m4a",
        "First part of our extensive lecture.",
      );

      expect(entriesDao.updateTranscriptionCheckpoint).toHaveBeenCalledTimes(2);
      expect(entriesDao.updateTranscriptionCheckpoint).toHaveBeenNthCalledWith(
        1,
        "entry-long-1",
        expect.objectContaining({
          completedChunks: 1,
          partialTranscript: "First part of our extensive lecture.",
        }),
      );
      expect(entriesDao.updateTranscriptionCheckpoint).toHaveBeenNthCalledWith(
        2,
        "entry-long-1",
        expect.objectContaining({
          completedChunks: 2,
          partialTranscript:
            "First part of our extensive lecture. Second part detailing the final conclusion.",
        }),
      );

      expect(geminiService.analyzeTranscript).toHaveBeenCalledWith(
        "First part of our extensive lecture. Second part detailing the final conclusion.",
      );

      expect(entriesDao.updateTranscription).toHaveBeenCalledWith(
        "entry-long-1",
        {
          title: "Extensive Lecture",
          summary: "Lecture on project conclusions.",
          transcript:
            "First part of our extensive lecture. Second part detailing the final conclusion.",
          tags: ["lecture", "conclusion"],
          transcription_status: "completed",
        },
      );
    });

    it("resumes from existing checkpoint and extracts starting from completedChunks", async () => {
      const existingCheckpoint: TranscriptionCheckpoint = {
        totalChunks: 2,
        completedChunks: 1,
        partialTranscript: "First part already done.",
        lastContextTail: "First part already done.",
      };

      const entryWithCheckpoint: JournalEntry = {
        ...mockLongEntry,
        id: "entry-long-resume",
        transcription_checkpoint: existingCheckpoint,
      };

      (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
        entryWithCheckpoint,
      ]);

      const extractSpy = jest
        .spyOn(VoiceRecorder, "extractAudioChunk")
        .mockResolvedValueOnce({
          chunkUri: "file:///cache/chunk_1.m4a",
          durationMs: 300_000,
          isLastChunk: true,
          totalDurationMs: 600_000,
        });

      (geminiService.transcribeChunk as jest.Mock).mockResolvedValueOnce(
        "Second part resumed successfully.",
      );

      (geminiService.analyzeTranscript as jest.Mock).mockResolvedValue({
        title: "Resumed Session",
        summary: "Summary of resumed audio.",
        tags: ["resumed"],
      });

      await service.processQueue();

      // Should extract starting from chunk 1 (startTimeMs: 300_000), skipping chunk 0
      expect(extractSpy).toHaveBeenCalledTimes(1);
      expect(extractSpy).toHaveBeenCalledWith(
        "file:///mock/long_recording.m4a",
        300_000,
        300_000,
        expect.stringContaining("chunks_entry-long-resume"),
      );

      // Only chunk 1 should be transcribed
      expect(geminiService.transcribeChunk).toHaveBeenCalledTimes(1);
      expect(geminiService.transcribeChunk).toHaveBeenCalledWith(
        "file:///cache/chunk_1.m4a",
        "First part already done.",
      );

      expect(entriesDao.updateTranscription).toHaveBeenCalledWith(
        "entry-long-resume",
        expect.objectContaining({
          transcript:
            "First part already done. Second part resumed successfully.",
          transcription_status: "completed",
        }),
      );
    });

    it("does NOT fall back to analyzeAudio on whole file if chunk extraction fails for long audio (throws retryable error)", async () => {
      (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
        mockLongEntry,
      ]);

      jest.spyOn(VoiceRecorder, "extractAudioChunk").mockResolvedValue(null);

      await service.processQueue();

      // Review Comment 3: analyzeAudio must NEVER be called with long audio on chunk failure
      expect(geminiService.analyzeAudio).not.toHaveBeenCalled();

      // Instead, it records retry backoff failure
      expect(entriesDao.recordTranscriptionFailure).toHaveBeenCalledWith(
        "entry-long-1",
        1,
        expect.any(Number),
        "queued",
      );
    });

    it("detects long audio when duration_sec <= 0 by probing native duration via VoiceRecorder.getAudioDuration", async () => {
      const entryZeroDuration: JournalEntry = {
        ...mockEntry,
        id: "entry-imported-zero-dur",
        duration_sec: 0,
        source_type: "imported",
        local_audio_path: "file:///mock/imported_audio.mp3",
      };

      (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
        entryZeroDuration,
      ]);

      // Native probe reports 15 minutes (900,000 ms)
      jest.spyOn(VoiceRecorder, "getAudioDuration").mockResolvedValue(900_000);

      const extractSpy = jest
        .spyOn(VoiceRecorder, "extractAudioChunk")
        .mockResolvedValueOnce({
          chunkUri: "file:///cache/chunk_0.wav",
          durationMs: 300_000,
          isLastChunk: true,
          totalDurationMs: 900_000,
        });

      (geminiService.transcribeChunk as jest.Mock).mockResolvedValueOnce(
        "Imported audio transcript.",
      );

      (geminiService.analyzeTranscript as jest.Mock).mockResolvedValue({
        title: "Imported MP3",
        summary: "Probed imported audio.",
        tags: ["imported"],
      });

      await service.processQueue();

      // Probed duration backfilled to 900s in entriesDao
      expect(entriesDao.updateDuration).toHaveBeenCalledWith(
        "entry-imported-zero-dur",
        900,
      );

      // Segmented extraction was used because probed duration > 600s
      expect(extractSpy).toHaveBeenCalled();
      expect(geminiService.analyzeAudio).not.toHaveBeenCalled();
    });

    it("detects long audio when duration_sec <= 0 by checking large file size (> 15MB)", async () => {
      const entryLargeFile: JournalEntry = {
        ...mockEntry,
        id: "entry-imported-large",
        duration_sec: 0,
        source_type: "imported",
        local_audio_path: "file:///mock/imported_large.wav",
      };

      (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
        entryLargeFile,
      ]);

      // Native probe returns 0 (e.g. unsupported container header)
      jest.spyOn(VoiceRecorder, "getAudioDuration").mockResolvedValue(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 25 * 1024 * 1024; // 25 MB

      const extractSpy = jest
        .spyOn(VoiceRecorder, "extractAudioChunk")
        .mockResolvedValueOnce({
          chunkUri: "file:///cache/chunk_0.wav",
          durationMs: 300_000,
          isLastChunk: true,
          totalDurationMs: 0,
        });

      (geminiService.transcribeChunk as jest.Mock).mockResolvedValueOnce(
        "Large file transcript.",
      );

      (geminiService.analyzeTranscript as jest.Mock).mockResolvedValue({
        title: "Large File",
        summary: "Summary of large file.",
        tags: ["large"],
      });

      await service.processQueue();

      // Segmented extraction was used due to file size > 15MB
      expect(extractSpy).toHaveBeenCalled();
      expect(geminiService.analyzeAudio).not.toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).defaultSize = 1000;
    });

    it("deletes temporary extracted chunk file if transcription fails so retries do not leak disk space", async () => {
      (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
        mockLongEntry,
      ]);

      jest.spyOn(VoiceRecorder, "extractAudioChunk").mockResolvedValueOnce({
        chunkUri: "file:///cache/chunk_transcribe_fail.m4a",
        durationMs: 300_000,
        isLastChunk: false,
        totalDurationMs: 600_000,
      });

      (geminiService.transcribeChunk as jest.Mock).mockRejectedValueOnce(
        new Error("Gemini 503 Service Unavailable"),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (File as any).mockDelete.mockClear();

      await service.processQueue();

      // Ensure the temporary chunk was deleted from disk despite the failure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((File as any).mockDelete).toHaveBeenCalledWith(
        expect.stringContaining("chunk_transcribe_fail.m4a"),
      );

      // Error was handled by backoff retry scheduling
      expect(entriesDao.recordTranscriptionFailure).toHaveBeenCalledWith(
        "entry-long-1",
        1,
        expect.any(Number),
        "queued",
      );
    });

    it("persists empty transcript for all-silence recording while passing placeholder to analyzeTranscript", async () => {
      (entriesDao.getQueuedEntries as jest.Mock).mockResolvedValue([
        mockLongEntry,
      ]);

      jest.spyOn(VoiceRecorder, "extractAudioChunk").mockResolvedValueOnce({
        chunkUri: "file:///cache/chunk_silent.m4a",
        durationMs: 300_000,
        isLastChunk: true,
        totalDurationMs: 300_000,
      });

      // Gemini returns empty text for silence on chunk transcription
      (geminiService.transcribeChunk as jest.Mock).mockResolvedValueOnce("");

      (geminiService.analyzeTranscript as jest.Mock).mockResolvedValue({
        title: "Silent Journal",
        summary: "No speech was detected in this recording.",
        tags: ["silent"],
      });

      await service.processQueue();

      // Placeholder is passed to analyzeTranscript for metadata synthesis
      expect(geminiService.analyzeTranscript).toHaveBeenCalledWith(
        "No speech detected in recording.",
      );

      // Persisted transcript remains empty string ("")
      expect(entriesDao.updateTranscription).toHaveBeenCalledWith(
        "entry-long-1",
        expect.objectContaining({
          title: "Silent Journal",
          summary: "No speech was detected in this recording.",
          transcript: "",
          tags: ["silent"],
          transcription_status: "completed",
        }),
      );
    });
  });
});
