import { getDatabase } from "../database";

export interface DeletedEntryRecord {
  id: string;
  drive_sidecar_file_id: string | null;
  drive_audio_file_id: string | null;
  deleted_at: number;
}

export const deletedEntriesDao = {
  async recordDeletion(
    id: string,
    driveSidecarFileId?: string | null,
    driveAudioFileId?: string | null,
  ): Promise<void> {
    const db = getDatabase();
    await db.runAsync(
      `INSERT OR REPLACE INTO deleted_entries (id, drive_sidecar_file_id, drive_audio_file_id, deleted_at)
       VALUES (?, ?, ?, ?)`,
      [id, driveSidecarFileId ?? null, driveAudioFileId ?? null, Date.now()],
    );
  },

  async getPendingDeletions(): Promise<DeletedEntryRecord[]> {
    const db = getDatabase();
    return db.getAllAsync<DeletedEntryRecord>(
      `SELECT * FROM deleted_entries ORDER BY deleted_at ASC`,
    );
  },

  async removeDeletion(id: string): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`DELETE FROM deleted_entries WHERE id = ?`, [id]);
  },

  async isDeleted(id: string): Promise<boolean> {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM deleted_entries WHERE id = ?`,
      [id],
    );
    return !!row;
  },

  async clearAll(): Promise<void> {
    const db = getDatabase();
    await db.runAsync(`DELETE FROM deleted_entries`);
  },
};
