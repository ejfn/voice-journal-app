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
  await db.execAsync(SCHEMA_SQL);

  // Safe migration for existing databases missing waveform_data
  try {
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(entries);`,
    );
    const hasWaveformCol = columns.some((col) => col.name === "waveform_data");
    if (!hasWaveformCol) {
      await db.execAsync(`ALTER TABLE entries ADD COLUMN waveform_data TEXT;`);
    }
  } catch (migrationError) {
    // Only tolerate if column is present (e.g. concurrent migration race); otherwise rethrow
    try {
      const columns = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(entries);`,
      );
      const hasWaveformCol = columns.some(
        (col) => col.name === "waveform_data",
      );
      if (!hasWaveformCol) {
        throw migrationError;
      }
    } catch {
      throw migrationError;
    }
  }

  // Safe migration for existing databases missing deleted_at
  try {
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(entries);`,
    );
    const hasDeletedAtCol = columns.some((col) => col.name === "deleted_at");
    if (!hasDeletedAtCol) {
      await db.execAsync(
        `ALTER TABLE entries ADD COLUMN deleted_at INTEGER DEFAULT NULL;`,
      );
    }
  } catch (migrationError) {
    try {
      const columns = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(entries);`,
      );
      const hasDeletedAtCol = columns.some((col) => col.name === "deleted_at");
      if (!hasDeletedAtCol) {
        throw migrationError;
      }
    } catch {
      throw migrationError;
    }
  }

  return db;
};
