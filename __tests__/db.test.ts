import { entriesDao } from "../src/db/dao/entriesDao";
import { syncQueueDao } from "../src/db/dao/syncQueueDao";
import { initDatabase, setDatabaseConnection } from "../src/db/database";
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

  it("persists and updates amplitude_data round trip correctly", async () => {
    const samples = [0.12, 0.45, 0.88, 0.33, 0.05];
    const entry: JournalEntry = {
      id: "amp-entry-1",
      title: "Audio Waveform Test",
      summary: "Testing amplitude storage",
      transcript: "Testing waveform persistence.",
      tags: ["test"],
      duration_sec: 10,
      source_type: "recorded",
      local_audio_path: "file:///audio/2026/09/amp-entry-1.m4a",
      drive_audio_file_id: null,
      drive_sidecar_file_id: null,
      is_audio_cached: 1,
      created_at: 1789700000000,
      last_accessed_at: 1789700000000,
      amplitude_data: samples,
    };

    await entriesDao.insertEntry(entry);
    const retrieved = await entriesDao.getEntryById("amp-entry-1");
    expect(retrieved?.amplitude_data).toEqual(samples);

    const updatedSamples = [0.99, 0.77, 0.55];
    await entriesDao.updateEntry({
      ...entry,
      amplitude_data: updatedSamples,
    });
    const updated = await entriesDao.getEntryById("amp-entry-1");
    expect(updated?.amplitude_data).toEqual(updatedSamples);
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
});
