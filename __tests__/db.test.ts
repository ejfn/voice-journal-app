import {
  entriesDao,
  groupEntriesIntoMonthSections,
} from "../src/db/dao/entriesDao";
import { deletedEntriesDao } from "../src/db/dao/deletedEntriesDao";
import { syncQueueDao } from "../src/db/dao/syncQueueDao";
import {
  DatabaseConnection,
  initDatabase,
  setDatabaseConnection,
} from "../src/db/database";
import { JournalEntry } from "../src/db/schema";
import { createTestDb } from "./helpers/testDb";

describe("Database & FTS5 DAO", () => {
  beforeEach(async () => {
    const testDb = createTestDb();
    setDatabaseConnection(testDb);
    await initDatabase();
  });

  afterEach(async () => {
    setDatabaseConnection(null);
  });

  it("inserts and retrieves an entry by ID", async () => {
    const entry: JournalEntry = {
      id: "entry-1",
      title: "Science Project Planning",
      summary: "Planned biology experiment with team.",
      transcript:
        "Today we organized the laboratory experiment for science class.",
      tags: ["school", "science", "experiment"],
      duration_sec: 105,
      source_type: "recorded",
      local_audio_path: "file:///audio/2026/09/entry-1.m4a",
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789700000000,
      last_accessed_at: 1789700000000,
    };

    await entriesDao.insertEntry(entry);
    const retrieved = await entriesDao.getEntryById("entry-1");

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("entry-1");
    expect(retrieved?.title).toBe("Science Project Planning");
    expect(retrieved?.tags).toEqual(["school", "science", "experiment"]);
    expect(retrieved?.duration_sec).toBe(105);
  });

  it("persists and retrieves recorded waveform_data", async () => {
    const waveform = [0.1, 0.45, 0.8, 0.35, 0.9];
    const entry: JournalEntry = {
      id: "entry-wave",
      title: "Audio with Waveform",
      summary: "Voice memo with real metering",
      transcript: "Testing waveform persistence",
      tags: ["test"],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789700000000,
      last_accessed_at: 1789700000000,
      waveform_data: waveform,
    };

    await entriesDao.insertEntry(entry);
    const retrieved = await entriesDao.getEntryById("entry-wave");

    expect(retrieved).not.toBeNull();
    expect(retrieved?.waveform_data).toEqual(waveform);
  });

  it("sanitizes waveform data by clamping out-of-bounds values and rejecting non-finite items", async () => {
    // Clamping values outside [0, 1]
    const outOfBoundsWaveform = [-0.5, 0.2, 1.5, 0.8];
    const clampedEntry: JournalEntry = {
      id: "entry-clamped",
      title: "Clamped Waveform",
      summary: "",
      transcript: "Testing waveform clamping",
      tags: [],
      duration_sec: 5,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789700000000,
      last_accessed_at: 1789700000000,
      waveform_data: outOfBoundsWaveform,
    };

    await entriesDao.insertEntry(clampedEntry);
    const retrievedClamped = await entriesDao.getEntryById("entry-clamped");
    expect(retrievedClamped?.waveform_data).toEqual([0, 0.2, 1, 0.8]);

    // Rejecting invalid waveform with NaN or Infinity
    const invalidWaveform = [0.1, NaN, Infinity, 0.5];
    const invalidEntry: JournalEntry = {
      id: "entry-invalid",
      title: "Invalid Waveform",
      summary: "",
      transcript: "Testing invalid waveform rejection",
      tags: [],
      duration_sec: 5,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789700000000,
      last_accessed_at: 1789700000000,
      waveform_data: invalidWaveform,
    };

    await entriesDao.insertEntry(invalidEntry);
    const retrievedInvalid = await entriesDao.getEntryById("entry-invalid");
    // Should gracefully reject and be undefined
    expect(retrievedInvalid?.waveform_data).toBeUndefined();
  });

  it("rethrows migration error if column is still missing after migration attempt", async () => {
    const brokenDb = {
      execAsync: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes("ALTER TABLE entries ADD COLUMN waveform_data")) {
          throw new Error("Disk I/O failure during ALTER TABLE");
        }
        return Promise.resolve();
      }),
      getAllAsync: jest
        .fn()
        .mockResolvedValue([{ name: "id" }, { name: "title" }]),
      runAsync: jest.fn(),
      getFirstAsync: jest.fn(),
    };

    await expect(
      initDatabase(brokenDb as unknown as DatabaseConnection),
    ).rejects.toThrow("Disk I/O failure during ALTER TABLE");
  });

  it("executes full-text search with FTS5 triggers", async () => {
    const entry1: JournalEntry = {
      id: "entry-1",
      title: "Morning workout and running",
      summary: "Ran 5k around the neighborhood.",
      transcript: "Went for a fast morning run around the lake. Felt great.",
      tags: ["sports", "health"],
      duration_sec: 45,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789700000000,
      last_accessed_at: 1789700000000,
    };

    const entry2: JournalEntry = {
      id: "entry-2",
      title: "Biology Poster Preparation",
      summary: "Finished poster board for science fair.",
      transcript: "Spent the evening drawing diagrams of cell membranes.",
      tags: ["school", "science"],
      duration_sec: 90,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789705000000,
      last_accessed_at: 1789705000000,
    };

    await entriesDao.insertEntry(entry1);
    await entriesDao.insertEntry(entry2);

    // Search for "membranes" in transcript
    const searchResults = await entriesDao.getEntries({ query: "membranes" });
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].id).toBe("entry-2");

    // Search for "running" (stemmed by porter)
    const runResults = await entriesDao.getEntries({ query: "running" });
    expect(runResults.length).toBe(1);
    expect(runResults[0].id).toBe("entry-1");
  });

  it("filters entries exactly by tag using json_each without substring false positives", async () => {
    const entry1: JournalEntry = {
      id: "entry-1",
      title: "Car race discussion",
      summary: "Watched racing cars.",
      transcript: "The formula 1 race was intense.",
      tags: ["race", "cars"],
      duration_sec: 60,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789700000000,
      last_accessed_at: 1789700000000,
    };

    const entry2: JournalEntry = {
      id: "entry-2",
      title: "Graceful dance rehearsal",
      summary: "Practiced graceful routine.",
      transcript: "Rehearsed the graceful dance steps.",
      tags: ["graceful", "dance"],
      duration_sec: 120,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789701000000,
      last_accessed_at: 1789701000000,
    };

    await entriesDao.insertEntry(entry1);
    await entriesDao.insertEntry(entry2);

    // Query for exact tag "race"
    // Substring search like '%race%' would falsely match "graceful", but json_each does not!
    const results = await entriesDao.getEntries({ tag: "race" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("entry-1");

    const gracefulResults = await entriesDao.getEntries({ tag: "graceful" });
    expect(gracefulResults.length).toBe(1);
    expect(gracefulResults[0].id).toBe("entry-2");
  });

  it("groups multiple clips recorded on the same day under one day header", async () => {
    // 2 clips on Sep 19, 2026: 09:15 and 19:42 local time
    const clip1Date = new Date(2026, 8, 19, 9, 15).getTime();
    const clip2Date = new Date(2026, 8, 19, 19, 42).getTime();
    // 1 clip on Sep 18, 2026
    const clip3Date = new Date(2026, 8, 18, 21, 0).getTime();

    const clip1: JournalEntry = {
      id: "clip-1",
      title: "Morning coffee & run",
      summary: "Went for a 5k run before breakfast.",
      transcript: "Morning run in the park.",
      tags: ["sports", "health"],
      duration_sec: 45,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: clip1Date,
      last_accessed_at: clip1Date,
    };

    const clip2: JournalEntry = {
      id: "clip-2",
      title: "Science poster prep",
      summary: "Finished presentation poster.",
      transcript: "Worked on science poster with classmates.",
      tags: ["school", "science"],
      duration_sec: 105,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: clip2Date,
      last_accessed_at: clip2Date,
    };

    const clip3: JournalEntry = {
      id: "clip-3",
      title: "Evening reflection",
      summary: "Reflected on week goals.",
      transcript: "Reviewing the progress made this week.",
      tags: ["reflection"],
      duration_sec: 130,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: clip3Date,
      last_accessed_at: clip3Date,
    };

    await entriesDao.insertEntry(clip1);
    await entriesDao.insertEntry(clip2);
    await entriesDao.insertEntry(clip3);

    const grouped = await entriesDao.getGroupedTimelineEntries();

    expect(grouped.length).toBe(1); // 1 Month section (September 2026)
    expect(grouped[0].monthKey).toBe("2026-09");

    // Should have 2 day groups: Sep 19 (2 clips) and Sep 18 (1 clip)
    const dayGroups = grouped[0].dayGroups;
    expect(dayGroups.length).toBe(2);

    const sep19Group = dayGroups.find((g) => g.dayKey === "2026-09-19");
    expect(sep19Group).toBeDefined();
    expect(sep19Group?.clips.length).toBe(2);

    const sep18Group = dayGroups.find((g) => g.dayKey === "2026-09-18");
    expect(sep18Group).toBeDefined();
    expect(sep18Group?.clips.length).toBe(1);
  });

  it("correctly tracks and updates sync queue items", async () => {
    // Insert parent entry first to satisfy foreign key constraint
    await entriesDao.insertEntry({
      id: "entry-123",
      title: "Queue Test Entry",
      summary: "Test summary",
      transcript: "Test transcript",
      tags: ["test"],
      duration_sec: 30,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: Date.now(),
      last_accessed_at: Date.now(),
    });

    const queueId = await syncQueueDao.enqueue({
      entry_id: "entry-123",
      action: "ANALYZE_AND_UPLOAD",
    });

    let pending = await syncQueueDao.getPendingItems();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(queueId);
    expect(pending[0].status).toBe("PENDING");

    await syncQueueDao.updateStatus(queueId, "PROCESSING");
    pending = await syncQueueDao.getPendingItems();
    expect(pending.length).toBe(0); // Only PENDING or FAILED are returned

    await syncQueueDao.updateStatus(queueId, "FAILED", 1);
    pending = await syncQueueDao.getPendingItems();
    expect(pending.length).toBe(1);
    expect(pending[0].retry_count).toBe(1);

    await syncQueueDao.deleteItem(queueId);
    pending = await syncQueueDao.getPendingItems();
    expect(pending.length).toBe(0);
  });

  it("identifies unsynced entries when sidecar is missing or when local is updated", async () => {
    const t0 = 100000;
    // Entry 1: Never synced to Drive (drive_sidecar_file_id is null)
    await entriesDao.insertEntry({
      id: "entry-unsynced-1",
      title: "New Unsynced Entry",
      summary: "Never uploaded",
      transcript: "Transcript",
      tags: ["new"],
      duration_sec: 20,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0,
      drive_synced_at: null,
      last_accessed_at: t0,
    });

    // Entry 2: Synced to Drive, not modified since
    await entriesDao.insertEntry({
      id: "entry-synced-2",
      title: "Already Synced",
      summary: "Up to date",
      transcript: "Transcript",
      tags: ["synced"],
      duration_sec: 25,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: "audio-file-2",
      drive_sidecar_file_id: "sidecar-file-2",
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0,
      drive_synced_at: t0 + 100, // synced after update
      last_accessed_at: t0,
    });

    // Entry 3: Synced to Drive previously, but updated locally since
    await entriesDao.insertEntry({
      id: "entry-updated-3",
      title: "Previously Synced But Edited",
      summary: "Edited locally",
      transcript: "Transcript",
      tags: ["edited"],
      duration_sec: 30,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: "audio-file-3",
      drive_sidecar_file_id: "sidecar-file-3",
      is_audio_cached: 1,
      created_at: t0,
      updated_at: t0 + 500, // updated after sync
      drive_synced_at: t0 + 200,
      last_accessed_at: t0,
    });

    const unsynced = await entriesDao.getUnsyncedEntries();
    const unsyncedIds = unsynced.map((e) => e.id);

    expect(unsyncedIds).toContain("entry-unsynced-1");
    expect(unsyncedIds).not.toContain("entry-synced-2");
    expect(unsyncedIds).toContain("entry-updated-3");

    // Test updateSyncStatus on entry-unsynced-1
    await entriesDao.updateSyncStatus(
      "entry-unsynced-1",
      "sidecar-1",
      "audio-1",
      t0 + 1000,
    );
    const updated1 = await entriesDao.getEntryById("entry-unsynced-1");
    expect(updated1?.drive_sidecar_file_id).toBe("sidecar-1");
    expect(updated1?.drive_audio_file_id).toBe("audio-1");
    expect(updated1?.drive_synced_at).toBe(t0 + 1000);

    // After sync status update, entry-unsynced-1 should no longer be in getUnsyncedEntries
    const unsyncedAfter = await entriesDao.getUnsyncedEntries();
    expect(unsyncedAfter.map((e) => e.id)).not.toContain("entry-unsynced-1");
  });

  it("getPrunableCachedEntries only returns entries that are fully backed up to Google Drive", async () => {
    const t0 = 1789700000000;

    // Entry A: Unsynced local recording (should NEVER be prunable)
    await entriesDao.insertEntry({
      id: "entry-unbacked-up",
      title: "Local Only",
      summary: "Not synced",
      transcript: "Transcript",
      tags: ["local"],
      duration_sec: 20,
      source_type: "recorded",
      local_audio_path: "file:///mock/audio/unbacked.m4a",
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: t0,
      drive_synced_at: null,
      last_accessed_at: t0 - 10000, // Very old access time
    });

    // Entry B: Audio uploaded, but sidecar not synced / drive_synced_at null (NOT prunable)
    await entriesDao.insertEntry({
      id: "entry-partial-sync",
      title: "Partial Sync",
      summary: "Audio uploaded but not sidecar",
      transcript: "Transcript",
      tags: ["partial"],
      duration_sec: 20,
      source_type: "recorded",
      local_audio_path: "file:///mock/audio/partial.m4a",
      drive_audio_file_id: "audio-partial-id",
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: t0,
      drive_synced_at: null,
      last_accessed_at: t0 - 9000,
    });

    // Entry C: Audio and sidecar both confirmed in Drive with valid drive_synced_at (PRUNABLE!)
    await entriesDao.insertEntry({
      id: "entry-fully-backed-up",
      title: "Backed Up",
      summary: "Safe in cloud",
      transcript: "Transcript",
      tags: ["backedup"],
      duration_sec: 20,
      source_type: "recorded",
      local_audio_path: "file:///mock/audio/safe.m4a",
      drive_audio_file_id: "audio-safe-id",
      drive_sidecar_file_id: "sidecar-safe-id",
      is_audio_cached: 1,
      created_at: t0,
      drive_synced_at: t0 + 100,
      last_accessed_at: t0,
    });

    const prunable = await entriesDao.getPrunableCachedEntries();
    const prunableIds = prunable.map((e) => e.id);

    expect(prunableIds).not.toContain("entry-unbacked-up");
    expect(prunableIds).not.toContain("entry-partial-sync");
    expect(prunableIds).toContain("entry-fully-backed-up");
  });

  it("retrieves all entry IDs as a Set with getAllEntryIds", async () => {
    const initialIds = await entriesDao.getAllEntryIds();
    expect(initialIds).toBeInstanceOf(Set);
    const initialCount = initialIds.size;

    await entriesDao.insertEntry({
      id: "bulk-id-1",
      title: "Bulk Test 1",
      summary: "",
      transcript: "",
      tags: [],
      duration_sec: 5,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1000,
      last_accessed_at: 1000,
    });

    await entriesDao.insertEntry({
      id: "bulk-id-2",
      title: "Bulk Test 2",
      summary: "",
      transcript: "",
      tags: [],
      duration_sec: 8,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 2000,
      last_accessed_at: 2000,
    });

    const updatedIds = await entriesDao.getAllEntryIds();
    expect(updatedIds.size).toBe(initialCount + 2);
    expect(updatedIds.has("bulk-id-1")).toBe(true);
    expect(updatedIds.has("bulk-id-2")).toBe(true);
    expect(updatedIds.has("non-existent-id")).toBe(false);
  });

  it("handles transcription queue status transitions", async () => {
    const entryId = "entry-queued-test";
    await entriesDao.insertEntry({
      id: entryId,
      title: "Voice Recording",
      summary: "Queued...",
      transcript: "",
      tags: ["voice"],
      duration_sec: 12,
      source_type: "recorded",
      local_audio_path: "file:///mock/queued.m4a",
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: Date.now(),
      last_accessed_at: Date.now(),
      transcription_status: "queued",
    });

    let queued = await entriesDao.getQueuedEntries();
    expect(queued.some((e) => e.id === entryId)).toBe(true);

    await entriesDao.updateTranscriptionStatus(entryId, "processing");
    let entry = await entriesDao.getEntryById(entryId);
    expect(entry?.transcription_status).toBe("processing");

    await entriesDao.updateTranscription(entryId, {
      title: "Morning reflections",
      summary: "Reflected on the project goals.",
      transcript: "This morning I thought about project goals.",
      tags: ["morning", "goals"],
      transcription_status: "completed",
    });

    entry = await entriesDao.getEntryById(entryId);
    expect(entry?.transcription_status).toBe("completed");
    expect(entry?.title).toBe("Morning reflections");
    expect(entry?.tags).toEqual(["morning", "goals"]);

    queued = await entriesDao.getQueuedEntries();
    expect(queued.some((e) => e.id === entryId)).toBe(false);
  });

  it("records retry failure with backoff timestamp and resets on manual retry", async () => {
    const entryId = "entry-backoff-db-test";
    const now = 1000000;
    await entriesDao.insertEntry({
      id: entryId,
      title: "Retry Entry",
      summary: "Queued...",
      transcript: "",
      tags: ["retry"],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///mock/retry.m4a",
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: now,
      last_accessed_at: now,
      transcription_status: "queued",
    });

    const nextRetryAt = now + 15000;
    await entriesDao.recordTranscriptionFailure(
      entryId,
      1,
      nextRetryAt,
      "queued",
    );

    // When querying queued at 'now', it should NOT be returned yet (waiting for backoff)
    let ready = await entriesDao.getQueuedEntries(now);
    expect(ready.some((e) => e.id === entryId)).toBe(false);

    // When querying queued at 'nextRetryAt', it SHOULD be returned
    ready = await entriesDao.getQueuedEntries(nextRetryAt);
    expect(ready.some((e) => e.id === entryId)).toBe(true);

    const nextScheduled = await entriesDao.getNextScheduledRetryTime(now);
    expect(nextScheduled).toBe(nextRetryAt);

    // Reset retry on manual trigger
    await entriesDao.resetTranscriptionRetry(entryId);
    const resetEntry = await entriesDao.getEntryById(entryId);
    expect(resetEntry?.transcription_retry_count).toBe(0);
    expect(resetEntry?.transcription_next_retry_at).toBeNull();
  });

  it("does not modify updated_at when transcription status changes or fails, preserving synced state", async () => {
    const entryId = "entry-preserve-updated-at-test";
    const initialUpdatedAt = 1000000;
    await entriesDao.insertEntry({
      id: entryId,
      title: "Synced Note",
      summary: "Summary",
      transcript: "Transcript",
      tags: ["test"],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///test.m4a",
      drive_audio_file_id: "audio-123",
      drive_sidecar_file_id: "sidecar-456",
      drive_synced_at: initialUpdatedAt,
      is_audio_cached: 1,
      created_at: initialUpdatedAt,
      updated_at: initialUpdatedAt,
      last_accessed_at: initialUpdatedAt,
      transcription_status: "queued",
    });

    // 1. Transition to processing
    await entriesDao.updateTranscriptionStatus(entryId, "processing");
    let entry = await entriesDao.getEntryById(entryId);
    expect(entry?.updated_at).toBe(initialUpdatedAt);

    // 2. Record failure
    await entriesDao.recordTranscriptionFailure(
      entryId,
      1,
      initialUpdatedAt + 10000,
      "failed",
    );
    entry = await entriesDao.getEntryById(entryId);
    expect(entry?.updated_at).toBe(initialUpdatedAt);
    expect(entry?.transcription_status).toBe("failed");

    // 3. Reset retry
    await entriesDao.resetTranscriptionRetry(entryId);
    entry = await entriesDao.getEntryById(entryId);
    expect(entry?.updated_at).toBe(initialUpdatedAt);
    expect(entry?.transcription_status).toBe("queued");
  });

  it("excludes cloud-only entries (is_audio_cached = 0) from getQueuedEntries and getNextScheduledRetryTime", async () => {
    const cloudEntryId = "entry-cloud-only-transcription-test";
    const now = 2000000;
    await entriesDao.insertEntry({
      id: cloudEntryId,
      title: "Cloud Only Entry",
      summary: "Waiting...",
      transcript: "",
      tags: ["cloud"],
      duration_sec: 25,
      source_type: "recorded",
      local_audio_path: null,
      drive_audio_file_id: "drive-audio-123",
      drive_sidecar_file_id: "drive-sidecar-123",
      is_audio_cached: 0,
      created_at: now,
      last_accessed_at: now,
      transcription_status: "queued",
      transcription_next_retry_at: now + 5000,
    });

    const queued = await entriesDao.getQueuedEntries(now + 10000);
    expect(queued.some((e) => e.id === cloudEntryId)).toBe(false);

    const nextScheduled = await entriesDao.getNextScheduledRetryTime(now);
    expect(nextScheduled).toBeNull();

    // When downloaded locally, is_audio_cached becomes 1
    await entriesDao.setAudioCached(
      cloudEntryId,
      true,
      "file:///mock/downloaded.m4a",
    );
    const queuedAfterDownload = await entriesDao.getQueuedEntries(now + 10000);
    expect(queuedAfterDownload.some((e) => e.id === cloudEntryId)).toBe(true);

    const nextScheduledAfterDownload =
      await entriesDao.getNextScheduledRetryTime(now);
    expect(nextScheduledAfterDownload).toBe(now + 5000);
  });

  describe("Soft-delete, Bin, and Auto-purge", () => {
    it("softDeleteEntry sets deleted_at and hides entry from active queries", async () => {
      const now = 1789700000000;
      const entry: JournalEntry = {
        id: "soft-del-1",
        title: "Active Entry",
        summary: "Summary",
        transcript: "Transcript content",
        tags: ["secret", "journal"],
        duration_sec: 30,
        source_type: "recorded",
        local_audio_path: "file:///mock/audio.m4a",
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        last_accessed_at: now,
        transcription_status: "queued",
      };
      await entriesDao.insertEntry(entry);

      // Verify visible before soft-delete
      let entries = await entriesDao.getEntries();
      expect(entries.some((e) => e.id === "soft-del-1")).toBe(true);

      let tags = await entriesDao.getAllTags();
      expect(tags).toContain("secret");

      let unsynced = await entriesDao.getUnsyncedEntries();
      expect(unsynced.some((e) => e.id === "soft-del-1")).toBe(true);

      let queued = await entriesDao.getQueuedEntries(now + 1000);
      expect(queued.some((e) => e.id === "soft-del-1")).toBe(true);

      // Soft delete
      const softDeleted = await entriesDao.softDeleteEntry("soft-del-1");
      expect(softDeleted?.deleted_at).toBeGreaterThan(0);

      // Verify row is still retrieved by ID
      const byId = await entriesDao.getEntryById("soft-del-1");
      expect(byId).not.toBeNull();
      expect(byId?.deleted_at).toBe(softDeleted?.deleted_at);

      // Verify excluded from active queries
      entries = await entriesDao.getEntries();
      expect(entries.some((e) => e.id === "soft-del-1")).toBe(false);

      tags = await entriesDao.getAllTags();
      expect(tags).not.toContain("secret");

      unsynced = await entriesDao.getUnsyncedEntries();
      expect(unsynced.some((e) => e.id === "soft-del-1")).toBe(false);

      queued = await entriesDao.getQueuedEntries(now + 1000);
      expect(queued.some((e) => e.id === "soft-del-1")).toBe(false);
    });

    it("restoreEntry clears deleted_at and restores entry to active queries", async () => {
      const now = 1789700000000;
      await entriesDao.insertEntry({
        id: "restore-test-1",
        title: "To Be Restored",
        summary: "Summary",
        transcript: "Transcript",
        tags: ["restored-tag"],
        duration_sec: 15,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        last_accessed_at: now,
        deleted_at: now,
      });

      // Initially excluded because deleted_at is set
      let entries = await entriesDao.getEntries();
      expect(entries.some((e) => e.id === "restore-test-1")).toBe(false);

      // Restore
      const restored = await entriesDao.restoreEntry("restore-test-1");
      expect(restored?.deleted_at).toBeNull();

      // Now visible in active queries
      entries = await entriesDao.getEntries();
      expect(entries.some((e) => e.id === "restore-test-1")).toBe(true);

      const tags = await entriesDao.getAllTags();
      expect(tags).toContain("restored-tag");
    });

    it("getBinnedEntries returns only binned entries in reverse chronological order of deletion", async () => {
      const t0 = 1000000;
      await entriesDao.insertEntry({
        id: "binned-old",
        title: "Deleted earlier",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0,
        deleted_at: t0 + 1000,
      });
      await entriesDao.insertEntry({
        id: "binned-recent",
        title: "Deleted later",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0,
        deleted_at: t0 + 5000,
      });
      await entriesDao.insertEntry({
        id: "not-binned",
        title: "Active",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0,
        deleted_at: null,
      });

      const binned = await entriesDao.getBinnedEntries();
      expect(binned.length).toBe(2);
      expect(binned[0].id).toBe("binned-recent");
      expect(binned[1].id).toBe("binned-old");
    });

    it("permanentlyDeleteEntry removes row and records a tombstone", async () => {
      const now = 1789700000000;
      await entriesDao.insertEntry({
        id: "perm-del-1",
        title: "Permanent Delete",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 20,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "drive-aud-1",
        drive_sidecar_file_id: "drive-sc-1",
        is_audio_cached: 1,
        created_at: now,
        last_accessed_at: now,
      });

      const deleted = await entriesDao.permanentlyDeleteEntry("perm-del-1");
      expect(deleted?.id).toBe("perm-del-1");

      // Removed from SQLite
      const byId = await entriesDao.getEntryById("perm-del-1");
      expect(byId).toBeNull();

      // Tombstone recorded
      const isMarked = await deletedEntriesDao.isDeleted("perm-del-1");
      expect(isMarked).toBe(true);
    });

    it("purgeExpiredBinnedEntries permanently purges only entries older than threshold", async () => {
      const cutoff = 5000000;
      // Older than cutoff -> should be purged
      await entriesDao.insertEntry({
        id: "expired-entry",
        title: "Expired",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "drive-sc-exp",
        drive_sidecar_file_id: "drive-aud-exp",
        is_audio_cached: 1,
        created_at: 1000,
        last_accessed_at: 1000,
        deleted_at: cutoff - 1000,
      });

      // Newer than cutoff -> should remain in bin
      await entriesDao.insertEntry({
        id: "recent-entry",
        title: "Recent",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: 1000,
        last_accessed_at: 1000,
        deleted_at: cutoff + 1000,
      });

      const purged = await entriesDao.purgeExpiredBinnedEntries(cutoff);
      expect(purged.map((e) => e.id)).toEqual(["expired-entry"]);

      // Expired row removed and tombstone created
      expect(await entriesDao.getEntryById("expired-entry")).toBeNull();
      expect(await deletedEntriesDao.isDeleted("expired-entry")).toBe(true);

      // Recent row still exists in DB
      const remaining = await entriesDao.getEntryById("recent-entry");
      expect(remaining).not.toBeNull();
      expect(remaining?.deleted_at).toBe(cutoff + 1000);
    });

    it("getUnsyncedEntries includes soft-deleted entries only if previously synced to Drive", async () => {
      const t0 = 1789700000000;
      // Entry 1: Soft-deleted, never in Drive -> excluded from unsynced
      await entriesDao.insertEntry({
        id: "soft-del-local-only",
        title: "Local only",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0,
        deleted_at: t0 + 100,
        updated_at: t0 + 100,
      });

      // Entry 2: Soft-deleted, previously in Drive, updated_at > drive_synced_at -> included in unsynced
      await entriesDao.insertEntry({
        id: "soft-del-in-drive",
        title: "In Drive",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "audio-id",
        drive_sidecar_file_id: "sidecar-id",
        is_audio_cached: 1,
        created_at: t0,
        drive_synced_at: t0 + 50,
        last_accessed_at: t0,
        deleted_at: t0 + 100,
        updated_at: t0 + 100,
      });

      const unsynced = await entriesDao.getUnsyncedEntries();
      const unsyncedIds = unsynced.map((e) => e.id);
      expect(unsyncedIds).not.toContain("soft-del-local-only");
      expect(unsyncedIds).toContain("soft-del-in-drive");
    });
  });

  describe("getAllTags & Timeline Pagination", () => {
    it("orders tags by hits descending within recent entries limit and respects maxTags", async () => {
      const baseTime = 1750000000000;
      // Entry 1 (most recent): work, ideas
      await entriesDao.insertEntry({
        id: "tag-entry-1",
        title: "E1",
        summary: "",
        transcript: "",
        tags: ["work", "ideas"],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: baseTime + 3000,
        last_accessed_at: baseTime + 3000,
      });
      // Entry 2: work, daily
      await entriesDao.insertEntry({
        id: "tag-entry-2",
        title: "E2",
        summary: "",
        transcript: "",
        tags: ["work", "daily"],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: baseTime + 2000,
        last_accessed_at: baseTime + 2000,
      });
      // Entry 3: work
      await entriesDao.insertEntry({
        id: "tag-entry-3",
        title: "E3",
        summary: "",
        transcript: "",
        tags: ["work"],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: baseTime + 1000,
        last_accessed_at: baseTime + 1000,
      });
      // Entry 4 (oldest): stale-old-tag
      await entriesDao.insertEntry({
        id: "tag-entry-4",
        title: "E4",
        summary: "",
        transcript: "",
        tags: ["stale-old-tag"],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: baseTime,
        last_accessed_at: baseTime,
      });

      // Window of top 3 recent entries: Entry 1, 2, 3
      // In this window:
      // "work" = 3 hits
      // "daily" = 1 hit
      // "ideas" = 1 hit
      // "stale-old-tag" is outside top 3 entries
      const tags = await entriesDao.getAllTags({
        recentEntriesLimit: 3,
        maxTags: 2,
      });
      expect(tags).toEqual(["work", "daily"]);

      const allRecent = await entriesDao.getAllTags({
        recentEntriesLimit: 3,
        maxTags: 10,
      });
      expect(allRecent).toEqual(["work", "daily", "ideas"]);
      expect(allRecent).not.toContain("stale-old-tag");
    });

    it("paginates entries using limit and offset", async () => {
      const baseTime = 1750000000000;
      for (let i = 1; i <= 5; i++) {
        await entriesDao.insertEntry({
          id: `page-entry-${i}`,
          title: `Entry ${i}`,
          summary: "",
          transcript: `Transcript ${i}`,
          tags: ["test"],
          duration_sec: 10,
          source_type: "recorded",
          local_audio_path: null,
          drive_audio_file_id: null,
          drive_sidecar_file_id: null,
          is_audio_cached: 1,
          created_at: baseTime + i * 1000,
          last_accessed_at: baseTime + i * 1000,
        });
      }

      // Page 1: limit 2, offset 0 -> entries 5 and 4
      const page1 = await entriesDao.getEntries({ limit: 2, offset: 0 });
      expect(page1.map((e) => e.id)).toEqual(["page-entry-5", "page-entry-4"]);

      // Page 2: limit 2, offset 2 -> entries 3 and 2
      const page2 = await entriesDao.getEntries({ limit: 2, offset: 2 });
      expect(page2.map((e) => e.id)).toEqual(["page-entry-3", "page-entry-2"]);

      // Page 3: limit 2, offset 4 -> entry 1
      const page3 = await entriesDao.getEntries({ limit: 2, offset: 4 });
      expect(page3.map((e) => e.id)).toEqual(["page-entry-1"]);
    });

    it("groups entries into month and day sections with groupEntriesIntoMonthSections", () => {
      const d1 = new Date(2026, 8, 20, 10, 0).getTime();
      const d2 = new Date(2026, 8, 20, 14, 0).getTime();
      const d3 = new Date(2026, 7, 15, 9, 0).getTime();

      const entries: JournalEntry[] = [
        {
          id: "m-1",
          title: "Clip 1",
          summary: "",
          transcript: "",
          tags: [],
          duration_sec: 10,
          source_type: "recorded",
          local_audio_path: null,
          drive_audio_file_id: null,
          drive_sidecar_file_id: null,
          is_audio_cached: 1,
          created_at: d1,
          last_accessed_at: d1,
        },
        {
          id: "m-2",
          title: "Clip 2",
          summary: "",
          transcript: "",
          tags: [],
          duration_sec: 10,
          source_type: "recorded",
          local_audio_path: null,
          drive_audio_file_id: null,
          drive_sidecar_file_id: null,
          is_audio_cached: 1,
          created_at: d2,
          last_accessed_at: d2,
        },
        {
          id: "m-3",
          title: "Clip 3",
          summary: "",
          transcript: "",
          tags: [],
          duration_sec: 10,
          source_type: "recorded",
          local_audio_path: null,
          drive_audio_file_id: null,
          drive_sidecar_file_id: null,
          is_audio_cached: 1,
          created_at: d3,
          last_accessed_at: d3,
        },
      ];

      const sections = groupEntriesIntoMonthSections(entries);
      expect(sections.length).toBe(2);
      expect(sections[0].dayGroups.length).toBe(1);
      expect(sections[0].dayGroups[0].clips.length).toBe(2);
      expect(sections[1].dayGroups.length).toBe(1);
      expect(sections[1].dayGroups[0].clips.length).toBe(1);
    });
  });

  describe("database initialization recovery", () => {
    it("resets initPromise on failure so subsequent attempts can succeed", async () => {
      const failingDb: DatabaseConnection = {
        execAsync: jest.fn().mockRejectedValue(new Error("Disk I/O error")),
        getAllAsync: jest.fn(),
        getFirstAsync: jest.fn(),
        runAsync: jest.fn(),
      };

      setDatabaseConnection(failingDb);
      await expect(initDatabase()).rejects.toThrow("Disk I/O error");

      // Verify that after failure, a subsequent attempt with valid db succeeds
      const recoveryDb = createTestDb();
      setDatabaseConnection(recoveryDb);
      const initialized = await initDatabase();
      expect(initialized).toBe(recoveryDb);
    });
  });
});
