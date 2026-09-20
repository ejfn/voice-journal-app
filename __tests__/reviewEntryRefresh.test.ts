import { MonthSection, entriesDao } from "../src/db/dao/entriesDao";
import { JournalEntry } from "../src/db/schema";
import {
  findEntryInSections,
  getRefreshedReviewEntry,
} from "../src/utils/reviewEntryRefresh";

describe("reviewEntryRefresh", () => {
  const baseEntry: JournalEntry = {
    id: "entry-1",
    title: "Original title",
    summary: "Original summary",
    transcript: "Original transcript",
    tags: ["voice"],
    duration_sec: 10,
    source_type: "recorded",
    local_audio_path: "file:///mock.m4a",
    drive_audio_file_id: null,
    drive_sidecar_file_id: null,
    is_audio_cached: 1,
    created_at: 1000,
    updated_at: 1000,
    drive_synced_at: null,
    last_accessed_at: 1000,
    transcription_status: "processing",
  };

  const makeSections = (entry: JournalEntry): MonthSection[] => [
    {
      monthKey: "2026-09",
      monthLabel: "September 2026",
      dayGroups: [
        {
          dayKey: "2026-09-20",
          dayLabel: "Today",
          clips: [entry],
        },
      ],
    },
  ];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("finds the refreshed entry object by id from grouped sections", () => {
    const refreshedEntry: JournalEntry = {
      ...baseEntry,
      title: "Refreshed title",
      summary: "Refreshed summary",
      tags: ["voice", "ai"],
      updated_at: 2000,
      transcription_status: "completed",
    };

    expect(
      findEntryInSections(makeSections(refreshedEntry), baseEntry.id),
    ).toBe(refreshedEntry);
  });

  it("replaces the open review entry with the latest database row", async () => {
    const refreshedEntry: JournalEntry = {
      ...baseEntry,
      title: "Refreshed title",
      summary: "Refreshed summary",
      updated_at: 2000,
      transcription_status: "completed",
    };
    jest.spyOn(entriesDao, "getEntryById").mockResolvedValue(refreshedEntry);

    await expect(getRefreshedReviewEntry(baseEntry)).resolves.toBe(
      refreshedEntry,
    );
  });

  it("preserves the current review entry when no refreshed row exists", async () => {
    jest.spyOn(entriesDao, "getEntryById").mockResolvedValue(null);

    await expect(getRefreshedReviewEntry(baseEntry)).resolves.toBe(baseEntry);
  });

  it("keeps null when there is no current review entry", async () => {
    await expect(getRefreshedReviewEntry(null)).resolves.toBeNull();
  });
});
