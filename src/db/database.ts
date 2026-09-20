import { SCHEMA_SQL } from "./schema";

export interface DatabaseConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  closeAsync?(): Promise<void>;
}

let activeDb: DatabaseConnection | null = null;

export const setDatabaseConnection = (db: DatabaseConnection | null): void => {
  activeDb = db;
};

export const getDatabase = (): DatabaseConnection => {
  if (!activeDb) {
    // In React Native environment, dynamically load expo-sqlite
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SQLite = require("expo-sqlite");
      const nativeDb = SQLite.openDatabaseSync("voicejournal.db");
      activeDb = {
        execAsync: async (sql: string) => nativeDb.execAsync(sql),
        runAsync: async (sql: string, params?: unknown[]) =>
          nativeDb.runAsync(sql, ...(params ?? [])),
        getAllAsync: async <T>(sql: string, params?: unknown[]) =>
          nativeDb.getAllAsync(sql, ...(params ?? [])) as Promise<T[]>,
        getFirstAsync: async <T>(sql: string, params?: unknown[]) =>
          nativeDb.getFirstAsync(sql, ...(params ?? [])) as Promise<T | null>,
        closeAsync: async () => nativeDb.closeAsync?.(),
      };
    } catch (err) {
      throw new Error(
        `Failed to initialize expo-sqlite database: ${(err as Error).message}`,
      );
    }
  }
  return activeDb;
};

export const initDatabase = async (
  customDb?: DatabaseConnection,
): Promise<DatabaseConnection> => {
  if (customDb) {
    activeDb = customDb;
  }
  const db = getDatabase();

  // Drop legacy triggers so they are recreated cleanly without FTS syntax errors
  try {
    await db.execAsync("DROP TRIGGER IF EXISTS entries_au;");
    await db.execAsync("DROP TRIGGER IF EXISTS entries_ad;");
  } catch {
    // Ignore
  }

  await db.execAsync(SCHEMA_SQL);

  try {
    await db.execAsync("ALTER TABLE entries ADD COLUMN updated_at INTEGER;");
  } catch {
    // Ignore if column already exists
  }
  try {
    await db.execAsync(
      "ALTER TABLE entries ADD COLUMN drive_synced_at INTEGER;",
    );
  } catch {
    // Ignore if column already exists
  }
  try {
    await db.execAsync(
      "ALTER TABLE entries ADD COLUMN transcription_status TEXT DEFAULT 'completed';",
    );
  } catch {
    // Ignore if column already exists
  }
  try {
    await db.execAsync(
      "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
    );
  } catch {
    // Ignore if table already exists
  }
  try {
    await db.execAsync(
      "CREATE TABLE IF NOT EXISTS deleted_entries (id TEXT PRIMARY KEY NOT NULL, drive_sidecar_file_id TEXT, drive_audio_file_id TEXT, deleted_at INTEGER NOT NULL);",
    );
  } catch {
    // Ignore if table already exists
  }

  return db;
};
