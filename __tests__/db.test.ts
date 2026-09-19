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
});
