import { getDatabase } from "../database";
import { SyncQueueItem } from "../schema";

export const syncQueueDao = {
  async enqueue(item: {
    id?: string;
    entry_id: string;
    action: "ANALYZE_AND_UPLOAD" | "METADATA_ONLY";
    status?: "PENDING" | "FAILED" | "PROCESSING" | "COMPLETED";
    retry_count?: number;
    created_at?: number;
  }): Promise<string> {
    const db = getDatabase();
    const id =
      item.id ||
      `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

  async deleteItem(id: string): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
  },

  async getItemByEntryId(entryId: string): Promise<SyncQueueItem | null> {
    const db = getDatabase();
    return db.getFirstAsync<SyncQueueItem>(
      `SELECT * FROM sync_queue WHERE entry_id = ? ORDER BY created_at DESC`,
      [entryId],
    );
  },
};
