import { MonthSection } from "../db/dao/entriesDao";
import { JournalEntry } from "../db/schema";

export const findEntryInSections = (
  groupedSections: MonthSection[],
  entryId: string,
): JournalEntry | null => {
  for (const section of groupedSections) {
    for (const dayGroup of section.dayGroups) {
      const matchingEntry = dayGroup.clips.find((clip) => clip.id === entryId);
      if (matchingEntry) {
        return matchingEntry;
      }
    }
  }

  return null;
};

export const getRefreshedReviewEntry = (
  currentEntry: JournalEntry | null,
  groupedSections: MonthSection[],
): JournalEntry | null => {
  if (!currentEntry) {
    return currentEntry;
  }

  return findEntryInSections(groupedSections, currentEntry.id) ?? currentEntry;
};
