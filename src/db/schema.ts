export type TranscriptionStatus =
  "queued" | "processing" | "completed" | "failed";

export interface JournalEntry {
  id: string;
  title: string;
  summary: string;
  transcript: string;
  tags: string[]; // JSON array of lowercase tags without '#'
  duration_sec: number;
  source_type: "recorded" | "imported";
  local_audio_path: string | null;
  drive_audio_file_id: string | null;
  drive_sidecar_file_id: string | null;
  is_audio_cached: number; // 1 = cached/local, 0 = cloud-only
  created_at: number; // Epoch timestamp ms
  updated_at?: number; // Epoch timestamp ms for edits/sync detection
  drive_synced_at?: number | null; // Epoch timestamp ms for Drive sync status
  last_accessed_at: number; // Epoch timestamp ms for LRU
  transcription_status?: TranscriptionStatus;
}

export interface JournalEntryRow {
  id: string;
  title: string;
  summary: string | null;
  transcript: string;
  tags: string; // JSON string
  duration_sec: number;
  source_type: "recorded" | "imported";
  local_audio_path: string | null;
  drive_audio_file_id: string | null;
  drive_sidecar_file_id: string | null;
  is_audio_cached: number;
  created_at: number;
  updated_at?: number | null;
  drive_synced_at?: number | null;
  last_accessed_at: number;
  transcription_status?: string | null;
}

export interface SyncQueueItem {
  id: string;
  entry_id: string;
  action: "ANALYZE_AND_UPLOAD" | "METADATA_ONLY";
  status: "PENDING" | "FAILED" | "PROCESSING" | "COMPLETED";
  retry_count: number;
  created_at: number;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  transcript TEXT NOT NULL,
  tags TEXT,
  duration_sec INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  local_audio_path TEXT,
  drive_audio_file_id TEXT,
  drive_sidecar_file_id TEXT,
  is_audio_cached INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  drive_synced_at INTEGER,
  last_accessed_at INTEGER NOT NULL,
  transcription_status TEXT DEFAULT 'completed'
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  id UNINDEXED,
  title,
  transcript,
  summary,
  tags,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY NOT NULL,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deleted_entries (
  id TEXT PRIMARY KEY NOT NULL,
  drive_sidecar_file_id TEXT,
  drive_audio_file_id TEXT,
  deleted_at INTEGER NOT NULL
);

-- Triggers to maintain entries_fts in sync with entries
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(id, title, transcript, summary, tags)
  VALUES (new.id, new.title, new.transcript, new.summary, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  DELETE FROM entries_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  DELETE FROM entries_fts WHERE id = old.id;
  INSERT INTO entries_fts(id, title, transcript, summary, tags)
  VALUES (new.id, new.title, new.transcript, new.summary, new.tags);
END;
`;
