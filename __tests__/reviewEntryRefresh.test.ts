import { MonthSection } from "../src/db/dao/entriesDao";
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

  it("replaces the open review entry when refreshed timeline data contains it", () => {
    const refreshedEntry: JournalEntry = {
      ...baseEntry,
      title: "Refreshed title",
      summary: "Refreshed summary",
      updated_at: 2000,
      transcription_status: "completed",
    };

    expect(
      getRefreshedReviewEntry(baseEntry, makeSections(refreshedEntry)),
    ).toBe(refreshedEntry);
  });

  it("preserves the current review entry when filters exclude it from refreshed sections", () => {
    const differentEntry: JournalEntry = {
      ...baseEntry,
      id: "entry-2",
      title: "Other entry",
    };

    expect(
      getRefreshedReviewEntry(baseEntry, makeSections(differentEntry)),
    ).toBe(baseEntry);
  });
});
