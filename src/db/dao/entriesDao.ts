import * as FileSystem from "expo-file-system/legacy";
import { getDatabase } from "../database";
import { JournalEntry, JournalEntryRow } from "../schema";
import { formatDayLabel, getEntryAudioPath } from "../../utils/paths";
import { deletedEntriesDao } from "./deletedEntriesDao";

export interface DayGroup {
  dayKey: string; // "2026-09-19"
  dayLabel: string; // "Saturday, Sep 19"
  clips: JournalEntry[];
}

export interface MonthSection {
  monthKey: string; // "2026-09"
  monthLabel: string; // "September 2026"
  dayGroups: DayGroup[];
}

const rowToEntry = (row: JournalEntryRow): JournalEntry => {
  let parsedTags: string[] = [];
  try {
    if (row.tags) {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed)) {
        parsedTags = parsed.map((t) =>
          String(t).toLowerCase().replace(/^#/, "").trim(),
        );
      }
    }
  } catch {
    // If not JSON, try comma separated
    parsedTags = (row.tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
      .filter(Boolean);
  }

  // If audio is marked cached, dynamically resolve to the current device's sandbox path
  const canonicalPath = getEntryAudioPath(row.id, row.created_at);
  const localAudioPath =
    row.is_audio_cached === 1 ? canonicalPath : row.local_audio_path || null;

  return {
    id: row.id,
    title: row.title,
    summary: row.summary || "",
    transcript: row.transcript,
    tags: parsedTags,
    duration_sec: row.duration_sec,
    source_type: row.source_type,
    local_audio_path: localAudioPath,
    drive_audio_file_id: row.drive_audio_file_id,
    drive_sidecar_file_id: row.drive_sidecar_file_id,
    is_audio_cached: row.is_audio_cached,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
    drive_synced_at: row.drive_synced_at ?? null,
    last_accessed_at: row.last_accessed_at,
  };
};

export const sanitizeFtsQuery = (query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) return "";
  // Remove SQLite FTS special characters except letters, numbers, and spaces
  const clean = trimmed.replace(/[^\w\s]/g, " ").trim();
  if (!clean) return "";
  // Append wildcard to each term for prefix matching
  const words = clean.split(/\s+/).filter(Boolean);
  return words.map((w) => `"${w}"*`).join(" ");
};

export const entriesDao = {
  async insertEntry(entry: JournalEntry): Promise<void> {
    const db = getDatabase();
    const tagsJson = JSON.stringify(
      entry.tags.map((t) => t.toLowerCase().replace(/^#/, "").trim()),
    );
    const updatedAt = entry.updated_at || entry.created_at;
    await db.runAsync(
      `INSERT INTO entries (
        id, title, summary, transcript, tags, duration_sec, source_type,
        local_audio_path, drive_audio_file_id, drive_sidecar_file_id,
        is_audio_cached, created_at, updated_at, drive_synced_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.title,
        entry.summary || null,
        entry.transcript,
        tagsJson,
        entry.duration_sec,
        entry.source_type,
        entry.local_audio_path || null,
        entry.drive_audio_file_id || null,
        entry.drive_sidecar_file_id || null,
        entry.is_audio_cached,
        entry.created_at,
        updatedAt,
        entry.drive_synced_at ?? null,
        entry.last_accessed_at || entry.created_at,
      ],
    );
  },

  async updateEntry(entry: JournalEntry): Promise<void> {
    const db = getDatabase();
    const tagsJson = JSON.stringify(
      entry.tags.map((t) => t.toLowerCase().replace(/^#/, "").trim()),
    );
    const updatedAt = entry.updated_at || Date.now();
    await db.runAsync(
      `UPDATE entries SET
        title = ?, summary = ?, transcript = ?, tags = ?, duration_sec = ?,
        source_type = ?, local_audio_path = ?, drive_audio_file_id = ?,
        drive_sidecar_file_id = ?, is_audio_cached = ?, updated_at = ?,
        drive_synced_at = ?, last_accessed_at = ?
      WHERE id = ?`,
      [
        entry.title,
        entry.summary || null,
        entry.transcript,
        tagsJson,
        entry.duration_sec,
        entry.source_type,
        entry.local_audio_path || null,
        entry.drive_audio_file_id || null,
        entry.drive_sidecar_file_id || null,
        entry.is_audio_cached,
        updatedAt,
        entry.drive_synced_at ?? null,
        entry.last_accessed_at || Date.now(),
        entry.id,
      ],
    );
  },

  async deleteEntry(id: string): Promise<JournalEntry | null> {
    const db = getDatabase();
    const entry = await this.getEntryById(id);
    if (entry) {
      // Record tombstone for cloud sync
      await deletedEntriesDao.recordDeletion(
        entry.id,
        entry.drive_sidecar_file_id,
        entry.drive_audio_file_id,
      );

      // Clean up local audio file on device
      const localAudioUri =
        entry.local_audio_path || getEntryAudioPath(entry.id, entry.created_at);
      if (localAudioUri) {
        try {
          await FileSystem.deleteAsync(localAudioUri, { idempotent: true });
        } catch {
          // Ignore
        }
      }
    }

    await db.runAsync(`DELETE FROM entries WHERE id = ?`, [id]);
    return entry;
  },

  async getEntryById(id: string): Promise<JournalEntry | null> {
    const db = getDatabase();
    const row = await db.getFirstAsync<JournalEntryRow>(
      `SELECT * FROM entries WHERE id = ?`,
      [id],
    );
    return row ? rowToEntry(row) : null;
  },

  async getEntries(options?: {
    query?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  }): Promise<JournalEntry[]> {
    const db = getDatabase();
    const { query, tag, limit, offset } = options || {};
    const params: unknown[] = [];
    let sql: string;

    const ftsQuery = query ? sanitizeFtsQuery(query) : "";

    if (ftsQuery && tag && tag !== "all") {
      sql = `
        SELECT e.* FROM entries e
        JOIN entries_fts fts ON e.id = fts.id,
        json_each(e.tags)
        WHERE entries_fts MATCH ? AND json_each.value = ?
        ORDER BY e.created_at DESC
      `;
      params.push(ftsQuery, tag.toLowerCase().replace(/^#/, ""));
    } else if (ftsQuery) {
      sql = `
        SELECT e.* FROM entries e
        JOIN entries_fts fts ON e.id = fts.id
        WHERE entries_fts MATCH ?
        ORDER BY e.created_at DESC
      `;
      params.push(ftsQuery);
    } else if (tag && tag !== "all") {
      sql = `
        SELECT e.* FROM entries e, json_each(e.tags)
        WHERE json_each.value = ?
        ORDER BY e.created_at DESC
      `;
      params.push(tag.toLowerCase().replace(/^#/, ""));
    } else {
      sql = `SELECT * FROM entries ORDER BY created_at DESC`;
    }

    if (typeof limit === "number") {
      sql += ` LIMIT ?`;
      params.push(limit);
      if (typeof offset === "number") {
        sql += ` OFFSET ?`;
        params.push(offset);
      }
    }

    const rows = await db.getAllAsync<JournalEntryRow>(sql, params);
    return rows.map(rowToEntry);
  },

  async markAudioAccessed(id: string): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`UPDATE entries SET last_accessed_at = ? WHERE id = ?`, [
      Date.now(),
      id,
    ]);
  },

  async setAudioCached(
    id: string,
    isCached: boolean,
    localPath?: string | null,
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE entries SET is_audio_cached = ?, local_audio_path = ? WHERE id = ?`,
      [isCached ? 1 : 0, localPath || null, id],
    );
  },

  async updateSyncStatus(
    id: string,
    sidecarId: string,
    audioId: string | null,
    syncedAt: number,
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE entries SET
        drive_sidecar_file_id = ?,
        drive_audio_file_id = ?,
        drive_synced_at = ?
      WHERE id = ?`,
      [sidecarId, audioId, syncedAt, id],
    );
  },

  async getUnsyncedEntries(): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries
       WHERE drive_sidecar_file_id IS NULL
          OR drive_synced_at IS NULL
          OR (updated_at IS NOT NULL AND updated_at > drive_synced_at)
       ORDER BY created_at ASC`,
    );
    return rows.map(rowToEntry);
  },

  async getPrunableCachedEntries(): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries
       WHERE is_audio_cached = 1
         AND local_audio_path IS NOT NULL
         AND drive_audio_file_id IS NOT NULL
         AND length(drive_audio_file_id) > 0
         AND drive_sidecar_file_id IS NOT NULL
         AND length(drive_sidecar_file_id) > 0
         AND drive_synced_at IS NOT NULL
       ORDER BY last_accessed_at ASC`,
    );
    return rows.map(rowToEntry);
  },

  async getAllCachedEntries(): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries
       WHERE is_audio_cached = 1
         AND local_audio_path IS NOT NULL
       ORDER BY last_accessed_at ASC`,
    );
    return rows.map(rowToEntry);
  },

  async getAllTags(): Promise<string[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<{ tag: string }>(
      `SELECT DISTINCT json_each.value as tag FROM entries, json_each(entries.tags) WHERE json_each.value IS NOT NULL AND json_each.value != '' ORDER BY tag ASC`,
    );
    return rows.map((r) => r.tag);
  },

  async getGroupedTimelineEntries(options?: {
    query?: string;
    tag?: string;
  }): Promise<MonthSection[]> {
    const entries = await this.getEntries(options);

    const monthMap = new Map<
      string,
      {
        monthLabel: string;
        dayMap: Map<string, { dayLabel: string; clips: JournalEntry[] }>;
      }
    >();

    for (const entry of entries) {
      const date = new Date(entry.created_at);
      const year = date.getFullYear();
      const monthNum = String(date.getMonth() + 1).padStart(2, "0");
      const monthKey = `${year}-${monthNum}`;
      const monthLabel = date.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

      const dayKey = `${year}-${monthNum}-${String(date.getDate()).padStart(2, "0")}`; // "YYYY-MM-DD" local
      const dayLabel = formatDayLabel(date);

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          monthLabel,
          dayMap: new Map(),
        });
      }

      const currentMonth = monthMap.get(monthKey)!;
      if (!currentMonth.dayMap.has(dayKey)) {
        currentMonth.dayMap.set(dayKey, {
          dayLabel,
          clips: [],
        });
      }

      currentMonth.dayMap.get(dayKey)!.clips.push(entry);
    }

    const sections: MonthSection[] = [];
    for (const [monthKey, monthData] of monthMap.entries()) {
      const dayGroups: DayGroup[] = [];
      for (const [dayKey, dayData] of monthData.dayMap.entries()) {
        dayGroups.push({
          dayKey,
          dayLabel: dayData.dayLabel,
          clips: dayData.clips,
        });
      }
      sections.push({
        monthKey,
        monthLabel: monthData.monthLabel,
        dayGroups,
      });
    }

    return sections;
  },
};
