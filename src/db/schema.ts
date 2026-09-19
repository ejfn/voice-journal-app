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
  last_accessed_at: number; // Epoch timestamp ms for LRU
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
  last_accessed_at: number;
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
  last_accessed_at INTEGER NOT NULL
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

-- Triggers to maintain entries_fts in sync with entries
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(id, title, transcript, summary, tags)
  VALUES (new.id, new.title, new.transcript, new.summary, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, id, title, transcript, summary, tags)
  VALUES('delete', old.id, old.title, old.transcript, old.summary, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, id, title, transcript, summary, tags)
  VALUES('delete', old.id, old.title, old.transcript, old.summary, old.tags);
  INSERT INTO entries_fts(id, title, transcript, summary, tags)
  VALUES (new.id, new.title, new.transcript, new.summary, new.tags);
END;
`;
