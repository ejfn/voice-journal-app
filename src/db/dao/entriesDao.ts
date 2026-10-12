import { File } from "expo-file-system";
import { getDatabase } from "../database";
import {
  JournalEntry,
  JournalEntryRow,
  TranscriptionCheckpoint,
  TranscriptionStatus,
} from "../schema";
import { formatDayLabel, getEntryAudioPath } from "../../utils/paths";
import { isAudioFileValid } from "../../utils/audioPersistence";
import { BIN_RETENTION_MS } from "../../utils/binUtils";
import { deletedEntriesDao } from "./deletedEntriesDao";
import { syncQueueDao } from "./syncQueueDao";

export interface EntrySyncInfo {
  id: string;
  created_at: number;
  updated_at: number | null;
  drive_synced_at: number | null;
  deleted_at: number | null;
  drive_sidecar_file_id: string | null;
  drive_audio_file_id: string | null;
  is_audio_cached: number;
  local_audio_path: string | null;
}

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

export const sanitizeWaveform = (waveform: unknown): number[] | undefined => {
  if (!Array.isArray(waveform) || waveform.length === 0) {
    return undefined;
  }
  const result: number[] = [];
  for (let i = 0; i < waveform.length; i++) {
    const rawVal = waveform[i];
    if (typeof rawVal !== "number" || !Number.isFinite(rawVal)) {
      return undefined;
    }
    result.push(Math.max(0, Math.min(1, Number(rawVal.toFixed(2)))));
  }
  return result;
};

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

  // Preserve stored local_audio_path (e.g. permanent sandbox fallback paths).
  // If local_audio_path is unset but is_audio_cached is 1, dynamically resolve canonical sandbox path.
  const canonicalPath = getEntryAudioPath(row.id, row.created_at);
  const localAudioPath =
    row.local_audio_path || (row.is_audio_cached === 1 ? canonicalPath : null);

  let parsedWaveform: number[] | undefined = undefined;
  if (row.waveform_data) {
    try {
      const parsed = JSON.parse(row.waveform_data);
      parsedWaveform = sanitizeWaveform(parsed);
    } catch {
      // Ignore malformed waveform data
    }
  }

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
    transcription_status:
      (row.transcription_status as TranscriptionStatus) || "completed",
    transcription_retry_count: row.transcription_retry_count ?? 0,
    transcription_next_retry_at: row.transcription_next_retry_at ?? null,
    waveform_data: parsedWaveform,
    deleted_at: row.deleted_at ?? null,
    transcription_checkpoint: row.transcription_checkpoint
      ? (() => {
          try {
            return JSON.parse(
              row.transcription_checkpoint,
            ) as TranscriptionCheckpoint;
          } catch {
            return null;
          }
        })()
      : null,
  };
};

export const sanitizeFtsQuery = (query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) return "";
  // Remove SQLite FTS special characters except letters, numbers, and spaces (Unicode-aware)
  const clean = trimmed.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!clean) return "";
  // Append wildcard to each term for prefix matching
  const words = clean.split(/\s+/).filter(Boolean);
  return words.map((w) => `"${w}"*`).join(" ");
};

export const entriesDao = {
  async insertEntry(entry: JournalEntry): Promise<void> {
    const db = getDatabase();
    const tagsJson = JSON.stringify(
      (Array.isArray(entry.tags) ? entry.tags : []).map((t) =>
        t.toLowerCase().replace(/^#/, "").trim(),
      ),
    );
    const updatedAt = entry.updated_at || entry.created_at;
    const transcriptionStatus = entry.transcription_status || "completed";
    const retryCount = entry.transcription_retry_count ?? 0;
    const nextRetryAt = entry.transcription_next_retry_at ?? null;
    const sanitizedWaveform = entry.waveform_data
      ? sanitizeWaveform(entry.waveform_data)
      : undefined;
    const waveformJson = sanitizedWaveform
      ? JSON.stringify(sanitizedWaveform)
      : null;
    const checkpointJson = entry.transcription_checkpoint
      ? JSON.stringify(entry.transcription_checkpoint)
      : null;
    await db.runAsync(
      `INSERT INTO entries (
        id, title, summary, transcript, tags, duration_sec, source_type,
        local_audio_path, drive_audio_file_id, drive_sidecar_file_id,
        is_audio_cached, created_at, updated_at, drive_synced_at, last_accessed_at,
        transcription_status, transcription_retry_count, transcription_next_retry_at,
        waveform_data, deleted_at, transcription_checkpoint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        transcriptionStatus,
        retryCount,
        nextRetryAt,
        waveformJson,
        entry.deleted_at ?? null,
        checkpointJson,
      ],
    );
  },

  async updateEntry(entry: JournalEntry): Promise<void> {
    const db = getDatabase();
    const tagsJson = JSON.stringify(
      (Array.isArray(entry.tags) ? entry.tags : []).map((t) =>
        t.toLowerCase().replace(/^#/, "").trim(),
      ),
    );
    const updatedAt = entry.updated_at || Date.now();
    const transcriptionStatus = entry.transcription_status || "completed";
    const sanitizedWaveform = entry.waveform_data
      ? sanitizeWaveform(entry.waveform_data)
      : undefined;
    const waveformJson = sanitizedWaveform
      ? JSON.stringify(sanitizedWaveform)
      : null;
    await db.runAsync(
      `UPDATE entries SET
        title = ?, summary = ?, transcript = ?, tags = ?, duration_sec = ?,
        source_type = ?, local_audio_path = ?, drive_audio_file_id = ?,
        drive_sidecar_file_id = ?, is_audio_cached = ?, updated_at = ?,
        drive_synced_at = ?, last_accessed_at = ?, transcription_status = ?,
        waveform_data = COALESCE(?, waveform_data), deleted_at = ?
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
        transcriptionStatus,
        waveformJson,
        entry.deleted_at !== undefined ? entry.deleted_at : null,
        entry.id,
      ],
    );
  },

  async updateTranscriptionStatus(
    id: string,
    status: TranscriptionStatus,
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE entries SET transcription_status = ? WHERE id = ?`,
      [status, id],
    );
  },

  async updateTranscription(
    id: string,
    updates: {
      title: string;
      summary: string;
      transcript: string;
      tags: string[];
      transcription_status: TranscriptionStatus;
    },
  ): Promise<void> {
    const db = getDatabase();
    const tagsJson = JSON.stringify(
      updates.tags.map((t) => t.toLowerCase().replace(/^#/, "").trim()),
    );
    const now = Date.now();
    await db.runAsync(
      `UPDATE entries SET
        title = ?, summary = ?, transcript = ?, tags = ?,
        transcription_status = ?, transcription_checkpoint = NULL, updated_at = ?
      WHERE id = ?`,
      [
        updates.title,
        updates.summary,
        updates.transcript,
        tagsJson,
        updates.transcription_status,
        now,
        id,
      ],
    );
  },

  async updateTranscriptionCheckpoint(
    id: string,
    checkpoint: TranscriptionCheckpoint | null,
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE entries SET transcription_checkpoint = ?, transcription_retry_count = 0, transcription_next_retry_at = NULL WHERE id = ?`,
      [checkpoint ? JSON.stringify(checkpoint) : null, id],
    );
  },

  async updateDuration(id: string, durationSec: number): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`UPDATE entries SET duration_sec = ? WHERE id = ?`, [
      durationSec,
      id,
    ]);
  },

  async getQueuedEntries(now: number = Date.now()): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries
       WHERE ((transcription_status = 'queued' AND (transcription_next_retry_at IS NULL OR transcription_next_retry_at <= ?))
          OR transcription_status = 'processing')
         AND is_audio_cached = 1
         AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [now],
    );
    return rows.map(rowToEntry);
  },

  async recordTranscriptionFailure(
    id: string,
    retryCount: number,
    nextRetryAt: number | null,
    status: TranscriptionStatus = "queued",
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE entries SET
        transcription_status = ?,
        transcription_retry_count = ?,
        transcription_next_retry_at = ?
       WHERE id = ?`,
      [status, retryCount, nextRetryAt, id],
    );
  },

  async resetTranscriptionRetry(id: string): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE entries SET
        transcription_status = 'queued',
        transcription_retry_count = 0,
        transcription_next_retry_at = NULL
       WHERE id = ?`,
      [id],
    );
  },

  async getNextScheduledRetryTime(
    now: number = Date.now(),
  ): Promise<number | null> {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ nextTime: number | null }>(
      `SELECT MIN(transcription_next_retry_at) as nextTime
       FROM entries
       WHERE transcription_status = 'queued'
         AND transcription_next_retry_at > ?
         AND is_audio_cached = 1
         AND deleted_at IS NULL`,
      [now],
    );
    return row?.nextTime ?? null;
  },

  async softDeleteEntry(id: string): Promise<JournalEntry | null> {
    const db = getDatabase();
    const now = Date.now();
    await db.runAsync(
      `UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, id],
    );
    return this.getEntryById(id);
  },

  async restoreEntry(id: string): Promise<JournalEntry | null> {
    const db = getDatabase();
    const now = Date.now();
    await db.runAsync(
      `UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
      [now, id],
    );
    // Defensive: clear any stale tombstone (e.g. left by an interrupted
    // purge) so the next sync does not delete the restored entry's
    // Drive backup.
    await deletedEntriesDao.removeDeletion(id);
    return this.getEntryById(id);
  },

  async getBinnedEntries(): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    );
    return rows.map(rowToEntry);
  },

  async permanentlyDeleteEntry(id: string): Promise<JournalEntry | null> {
    const db = getDatabase();
    const entry = await this.getEntryById(id);
    if (entry) {
      // Cancel any queued/in-flight uploads for this entry first, so a
      // pending upload cannot recreate Drive files after the tombstone
      // sync deletes them (the schema's ON DELETE CASCADE is inert
      // because PRAGMA foreign_keys is not enabled).
      await syncQueueDao.deleteByEntryId(entry.id);

      // Tombstone + row delete must be atomic. If the process dies (or a
      // sync fires) between the two, a still-restorable binned entry would
      // carry a live tombstone, and the next sync would delete its Drive
      // backup while the UI still offers Restore.
      await db.execAsync("BEGIN IMMEDIATE");
      try {
        await deletedEntriesDao.recordDeletion(
          entry.id,
          entry.drive_sidecar_file_id,
          entry.drive_audio_file_id,
        );
        await db.runAsync(`DELETE FROM entries WHERE id = ?`, [id]);
        await db.execAsync("COMMIT");
      } catch (err) {
        await db.execAsync("ROLLBACK");
        throw err;
      }

      // Clean up local audio files only after the row is gone (entry is
      // unrestorable), so an interrupted purge stays retryable.
      const canonicalPath = getEntryAudioPath(entry.id, entry.created_at);
      const pathsToDelete = new Set<string>();
      if (entry.local_audio_path) pathsToDelete.add(entry.local_audio_path);
      if (canonicalPath) pathsToDelete.add(canonicalPath);

      for (const p of pathsToDelete) {
        try {
          const file = new File(p);
          if (file.exists) {
            file.delete();
          }
        } catch {
          // Ignore
        }
      }
    } else {
      await db.runAsync(`DELETE FROM entries WHERE id = ?`, [id]);
    }
    return entry;
  },

  async deleteEntry(id: string): Promise<JournalEntry | null> {
    return this.softDeleteEntry(id);
  },

  /**
   * Permanently purges binned entries past the retention window.
   * Resilient: one failing entry does not abort the rest.
   * Returns only the entries that were successfully purged.
   */
  async purgeExpiredBinnedEntries(
    thresholdMs: number = Date.now() - BIN_RETENTION_MS,
  ): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries WHERE deleted_at IS NOT NULL AND deleted_at <= ?`,
      [thresholdMs],
    );
    const purged: JournalEntry[] = [];
    for (const row of rows) {
      const entry = rowToEntry(row);
      try {
        await this.permanentlyDeleteEntry(entry.id);
        purged.push(entry);
      } catch (err) {
        console.warn(`Failed to purge expired binned entry ${entry.id}:`, err);
      }
    }
    return purged;
  },

  /**
   * Permanently deletes every binned entry.
   * Resilient: one failing entry does not abort the rest.
   * Returns only the entries that were successfully purged.
   */
  async emptyBin(): Promise<JournalEntry[]> {
    const binned = await this.getBinnedEntries();
    const purged: JournalEntry[] = [];
    for (const entry of binned) {
      try {
        await this.permanentlyDeleteEntry(entry.id);
        purged.push(entry);
      } catch (err) {
        console.warn(
          `Failed to permanently delete binned entry ${entry.id}:`,
          err,
        );
      }
    }
    return purged;
  },

  /** Lightweight count of binned entries (avoids loading full rows/transcripts). */
  async getBinnedEntryCount(): Promise<number> {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM entries WHERE deleted_at IS NOT NULL`,
    );
    return row?.count ?? 0;
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
        json_each(CASE WHEN json_valid(e.tags) THEN e.tags ELSE '[]' END)
        WHERE entries_fts MATCH ? AND json_each.value = ? AND e.deleted_at IS NULL
        ORDER BY e.created_at DESC
      `;
      params.push(ftsQuery, tag.toLowerCase().replace(/^#/, ""));
    } else if (ftsQuery) {
      sql = `
        SELECT e.* FROM entries e
        JOIN entries_fts fts ON e.id = fts.id
        WHERE entries_fts MATCH ? AND e.deleted_at IS NULL
        ORDER BY e.created_at DESC
      `;
      params.push(ftsQuery);
    } else if (tag && tag !== "all") {
      sql = `
        SELECT e.* FROM entries e,
        json_each(CASE WHEN json_valid(e.tags) THEN e.tags ELSE '[]' END)
        WHERE json_each.value = ? AND e.deleted_at IS NULL
        ORDER BY e.created_at DESC
      `;
      params.push(tag.toLowerCase().replace(/^#/, ""));
    } else {
      sql = `SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY created_at DESC`;
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
    sidecarId: string | null | undefined,
    audioId: string | null | undefined,
    syncedAt: number | null | undefined,
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE entries SET
        drive_sidecar_file_id = ?,
        drive_audio_file_id = ?,
        drive_synced_at = ?
      WHERE id = ?`,
      [sidecarId ?? null, audioId ?? null, syncedAt ?? null, id],
    );
  },

  async getUnsyncedEntries(limit?: number): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries
       WHERE (deleted_at IS NULL AND (
         drive_sidecar_file_id IS NULL
         OR drive_synced_at IS NULL
         OR (updated_at IS NOT NULL AND updated_at > drive_synced_at)
       ))
       OR (deleted_at IS NOT NULL AND drive_sidecar_file_id IS NOT NULL AND (
         drive_synced_at IS NULL
         OR (updated_at IS NOT NULL AND updated_at > drive_synced_at)
       ))
       ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
       ${limit == null ? "" : "LIMIT ?"}`,
      limit == null ? [] : [Math.max(0, Math.floor(limit))],
    );
    return rows.map(rowToEntry);
  },

  async getEntriesNeedingAudioRecovery(): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries
       WHERE deleted_at IS NULL
         AND drive_audio_file_id IS NULL
       ORDER BY created_at ASC`,
    );
    return rows.map(rowToEntry);
  },

  async getPrunableCachedEntries(): Promise<JournalEntry[]> {
    const db = getDatabase();
    const rows = await db.getAllAsync<JournalEntryRow>(
      `SELECT * FROM entries
       WHERE is_audio_cached = 1
         AND deleted_at IS NULL
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

  async getAllTags(options?: {
    recentEntriesLimit?: number;
    maxTags?: number;
  }): Promise<string[]> {
    const db = getDatabase();
    const recentLimit = options?.recentEntriesLimit ?? 100;
    const maxTags = options?.maxTags ?? 15;

    const rows = await db.getAllAsync<{ tag: string }>(
      `SELECT json_each.value AS tag, COUNT(*) AS hits
       FROM (
         SELECT tags FROM entries
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?
       ), json_each(CASE WHEN json_valid(tags) THEN tags ELSE '[]' END)
       WHERE json_each.value IS NOT NULL AND json_each.value != ''
       GROUP BY json_each.value
       ORDER BY hits DESC, tag ASC
       LIMIT ?`,
      [recentLimit, maxTags],
    );
    return rows.map((r) => r.tag);
  },

  async getGroupedTimelineEntries(options?: {
    query?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  }): Promise<MonthSection[]> {
    const entries = await this.getEntries(options);
    return groupEntriesIntoMonthSections(entries);
  },

  async updateWaveform(id: string, waveform: number[]): Promise<void> {
    const db = getDatabase();
    const sanitized = sanitizeWaveform(waveform);
    if (!sanitized) {
      return;
    }
    const waveformJson = JSON.stringify(sanitized);
    await db.runAsync(`UPDATE entries SET waveform_data = ? WHERE id = ?`, [
      waveformJson,
      id,
    ]);
  },

  async getAllEntryIds(): Promise<Set<string>> {
    const db = getDatabase();
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM entries;`,
    );
    return new Set(rows.map((r) => r.id));
  },

  async getEntrySyncInfoMap(): Promise<Map<string, EntrySyncInfo>> {
    const db = getDatabase();
    const rows = await db.getAllAsync<EntrySyncInfo>(
      `SELECT id, created_at, updated_at, drive_synced_at, deleted_at,
              drive_sidecar_file_id, drive_audio_file_id, is_audio_cached, local_audio_path
       FROM entries;`,
    );
    const map = new Map<string, EntrySyncInfo>();
    for (const row of rows) {
      map.set(row.id, row);
    }
    return map;
  },

  async applyCloudUpdate(
    cloudEntry: JournalEntry,
    sidecarFileId: string,
    cloudSyncedAt: number,
  ): Promise<void> {
    const db = getDatabase();
    const existing = await this.getEntryById(cloudEntry.id);
    if (!existing) return;

    // Check if audio file exists locally on this device
    const localAudioPath =
      existing.local_audio_path ||
      getEntryAudioPath(existing.id, existing.created_at);
    const localAudioExists = isAudioFileValid(localAudioPath);

    const tagsJson = JSON.stringify(
      (Array.isArray(cloudEntry.tags) ? cloudEntry.tags : []).map((t) =>
        t.toLowerCase().replace(/^#/, "").trim(),
      ),
    );
    const sanitizedWaveform = cloudEntry.waveform_data
      ? sanitizeWaveform(cloudEntry.waveform_data)
      : existing.waveform_data
        ? sanitizeWaveform(existing.waveform_data)
        : undefined;
    const waveformJson = sanitizedWaveform
      ? JSON.stringify(sanitizedWaveform)
      : null;

    const audioFileId =
      cloudEntry.drive_audio_file_id || existing.drive_audio_file_id || null;
    const updatedAt =
      cloudEntry.updated_at ?? existing.updated_at ?? cloudEntry.created_at;
    const deletedAt =
      cloudEntry.deleted_at !== undefined
        ? cloudEntry.deleted_at
        : existing.deleted_at;
    const transcriptionStatus =
      cloudEntry.transcription_status ||
      existing.transcription_status ||
      "completed";

    await db.runAsync(
      `UPDATE entries SET
        title = ?, summary = ?, transcript = ?, tags = ?, duration_sec = ?,
        source_type = ?, local_audio_path = ?, drive_audio_file_id = ?,
        drive_sidecar_file_id = ?, is_audio_cached = ?, updated_at = ?,
        drive_synced_at = ?, last_accessed_at = ?, transcription_status = ?,
        waveform_data = COALESCE(?, waveform_data), deleted_at = ?
      WHERE id = ?`,
      [
        cloudEntry.title,
        cloudEntry.summary || null,
        cloudEntry.transcript,
        tagsJson,
        cloudEntry.duration_sec,
        cloudEntry.source_type,
        localAudioExists ? localAudioPath : null,
        audioFileId,
        sidecarFileId,
        localAudioExists ? 1 : 0,
        updatedAt,
        cloudSyncedAt,
        Date.now(),
        transcriptionStatus,
        waveformJson,
        deletedAt,
        cloudEntry.id,
      ],
    );
  },
};

export function groupEntriesIntoMonthSections(
  entries: JournalEntry[],
): MonthSection[] {
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
}
