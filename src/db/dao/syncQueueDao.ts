import { getDatabase } from "../database";
import { SyncQueueItem } from "../schema";

import { generateUUID } from "../../utils/uuid";

export const syncQueueDao = {
  async enqueue(item: {
    id?: string;
    entry_id: string;
    action: SyncQueueItem["action"];
    status?: SyncQueueItem["status"];
    retry_count?: number;
    created_at?: number;
  }): Promise<string> {
    const db = getDatabase();
    const id = item.id || generateUUID();
    const status = item.status || "PENDING";
    const retryCount = item.retry_count || 0;
    const createdAt = item.created_at || Date.now();

    await db.runAsync(
      `INSERT INTO sync_queue (id, entry_id, action, status, retry_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, item.entry_id, item.action, status, retryCount, createdAt],
    );

    return id;
  },

  /**
   * Atomically enqueues an item only if no queue row exists for the entry.
   * Guards against the check-then-insert race where two concurrent
   * producers both pass the existence check and insert duplicate rows
   * (which would upload the same entry to Drive twice).
   *
   * @returns the inserted row's id, or null if a row already existed and
   *          the insert was skipped.
   */
  async enqueueIfAbsent(item: {
    id?: string;
    entry_id: string;
    action: SyncQueueItem["action"];
    status?: SyncQueueItem["status"];
    retry_count?: number;
    created_at?: number;
  }): Promise<string | null> {
    const db = getDatabase();
    const id = item.id || generateUUID();
    const status = item.status || "PENDING";
    const retryCount = item.retry_count || 0;
    const createdAt = item.created_at || Date.now();

    const result = await db.runAsync(
      `INSERT INTO sync_queue (id, entry_id, action, status, retry_count, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM sync_queue WHERE entry_id = ?)`,
      [
        id,
        item.entry_id,
        item.action,
        status,
        retryCount,
        createdAt,
        item.entry_id,
      ],
    );

    return result.changes > 0 ? id : null;
  },

  async getPendingItems(): Promise<SyncQueueItem[]> {
    const db = getDatabase();
    return db.getAllAsync<SyncQueueItem>(
      `SELECT * FROM sync_queue
       WHERE status IN ('PENDING', 'FAILED')
         AND retry_count < 5
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC`,
      [Date.now()],
    );
  },

  async updateStatus(
    id: string,
    status: SyncQueueItem["status"],
    retryCount?: number,
  ): Promise<void> {
    const db = getDatabase();
    if (typeof retryCount === "number") {
      await db.runAsync(
        `UPDATE sync_queue SET status = ?, retry_count = ? WHERE id = ?`,
        [status, retryCount, id],
      );
    } else {
      await db.runAsync(`UPDATE sync_queue SET status = ? WHERE id = ?`, [
        status,
        id,
      ]);
    }
  },

  async getItemById(id: string): Promise<SyncQueueItem | null> {
    const db = getDatabase();
    return db.getFirstAsync<SyncQueueItem>(
      `SELECT * FROM sync_queue WHERE id = ?`,
      [id],
    );
  },

  async updateAction(
    id: string,
    action: SyncQueueItem["action"],
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`UPDATE sync_queue SET action = ? WHERE id = ?`, [
      action,
      id,
    ]);
  },

  async deleteItem(id: string): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
  },

  async markCompleted(id: string): Promise<void> {
    await this.updateStatus(id, "COMPLETED");
  },

  /**
   * Resets an item to PENDING with a clean retry state, clearing any
   * persisted backoff window. Used when new work is enqueued for an
   * existing item (the new upload attempt should not inherit the old
   * failure's backoff).
   */
  async resetToPending(id: string, retryCount = 0): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE sync_queue SET status = 'PENDING', retry_count = ?, next_retry_at = NULL WHERE id = ?`,
      [retryCount, id],
    );
  },

  /**
   * Records a failed attempt: keeps the item PENDING but persists the
   * backoff window so no queue trigger can retry it before nextRetryAt.
   */
  async markRetry(
    id: string,
    retryCount: number,
    nextRetryAt: number,
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE sync_queue SET status = 'PENDING', retry_count = ?, next_retry_at = ? WHERE id = ?`,
      [retryCount, nextRetryAt, id],
    );
  },

  /**
   * Atomically sets an existing item's action AND resets it to PENDING
   * (retry state + backoff cleared) in a single statement. Two separate
   * awaited writes would let a concurrent queue pass read the item in
   * between (e.g. action updated but still PROCESSING) and drop it.
   */
  async setActionPending(
    id: string,
    action: SyncQueueItem["action"],
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE sync_queue
       SET action = ?, status = 'PENDING', retry_count = 0, next_retry_at = NULL
       WHERE id = ?`,
      [action, id],
    );
  },

  /**
   * Atomically upserts a queue row as PENDING for the entry: updates the
   * existing row in one statement, or inserts via enqueueIfAbsent. This is
   * the only safe re-enqueue path for producers that may race
   * UploadQueueService (e.g. syncTwoWay's race-detected branch).
   */
  async upsertAsPending(
    entryId: string,
    action: SyncQueueItem["action"],
  ): Promise<void> {
    const db = getDatabase();
    const result = await db.runAsync(
      `UPDATE sync_queue
       SET action = ?, status = 'PENDING', retry_count = 0, next_retry_at = NULL
       WHERE entry_id = ?`,
      [action, entryId],
    );
    if (result.changes === 0) {
      await this.enqueueIfAbsent({ entry_id: entryId, action });
    }
  },

  async deleteByEntryId(entryId: string): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`DELETE FROM sync_queue WHERE entry_id = ?`, [entryId]);
  },

  async getItemByEntryId(entryId: string): Promise<SyncQueueItem | null> {
    const db = getDatabase();
    return db.getFirstAsync<SyncQueueItem>(
      `SELECT * FROM sync_queue WHERE entry_id = ? ORDER BY created_at DESC`,
      [entryId],
    );
  },
};
