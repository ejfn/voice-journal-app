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

  async getPendingItems(): Promise<SyncQueueItem[]> {
    const db = getDatabase();
    return db.getAllAsync<SyncQueueItem>(
      `SELECT * FROM sync_queue WHERE status IN ('PENDING', 'FAILED') AND retry_count < 5 ORDER BY created_at ASC`,
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
