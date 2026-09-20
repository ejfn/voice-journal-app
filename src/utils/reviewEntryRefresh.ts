import { MonthSection, entriesDao } from "../db/dao/entriesDao";
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

export const getRefreshedReviewEntry = async (
  currentEntry: JournalEntry | null,
): Promise<JournalEntry | null> => {
  if (!currentEntry) {
    return currentEntry;
  }

  return (await entriesDao.getEntryById(currentEntry.id)) ?? currentEntry;
};
