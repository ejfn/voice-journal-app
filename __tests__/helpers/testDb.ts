import Database from "better-sqlite3";
import { DatabaseConnection } from "../../src/db/database";

export function createTestDb(): DatabaseConnection {
  const db = new Database(":memory:");
  return {
    async execAsync(sql: string): Promise<void> {
      db.exec(sql);
    },
    async runAsync(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ lastInsertRowId: number; changes: number }> {
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: result.changes,
      };
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    },
    async getFirstAsync<T>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T | null> {
      const stmt = db.prepare(sql);
      const row = stmt.get(...params);
      return (row ?? null) as T | null;
    },
    async closeAsync(): Promise<void> {
      db.close();
    },
  };
}
