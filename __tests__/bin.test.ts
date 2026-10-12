import { entriesDao } from "../src/db/dao/entriesDao";
import { deletedEntriesDao } from "../src/db/dao/deletedEntriesDao";
import { initDatabase, setDatabaseConnection } from "../src/db/database";
import { createTestDb } from "./helpers/testDb";
import {
  BIN_RETENTION_MS,
  getBinRemainingDays,
  formatBinCountdown,
} from "../src/utils/binUtils";

describe("Recycle Bin and Soft-Delete Features", () => {
  beforeEach(async () => {
    const testDb = createTestDb();
    setDatabaseConnection(testDb);
    await initDatabase();
  });

  afterEach(async () => {
    setDatabaseConnection(null);
  });

  describe("binUtils", () => {
    const now = 1000000000000;

    it("calculates exact days remaining correctly", () => {
      // Just deleted right now
      expect(getBinRemainingDays(now, now)).toBe(30);

      // Deleted 1 day ago (29 days remaining)
      expect(getBinRemainingDays(now - 24 * 60 * 60 * 1000, now)).toBe(29);

      // Deleted 15.5 days ago (15 days remaining)
      expect(getBinRemainingDays(now - 15.5 * 24 * 60 * 60 * 1000, now)).toBe(
        15,
      );

      // Deleted 29 days ago (1 day remaining)
      expect(getBinRemainingDays(now - 29 * 24 * 60 * 60 * 1000, now)).toBe(1);

      // Deleted 29.8 days ago (< 24 hours remaining) -> returns 1
      expect(getBinRemainingDays(now - 29.8 * 24 * 60 * 60 * 1000, now)).toBe(
        1,
      );

      // Exactly 30 days ago (0 days remaining)
      expect(getBinRemainingDays(now - BIN_RETENTION_MS, now)).toBe(0);

      // Past 30 days ago
      expect(getBinRemainingDays(now - (BIN_RETENTION_MS + 5000), now)).toBe(0);
    });

    it("formats human-readable countdown text correctly", () => {
      // 30 days remaining
      expect(formatBinCountdown(now, now)).toBe("30 days remaining");

      // 15 days remaining
      expect(formatBinCountdown(now - 15 * 24 * 60 * 60 * 1000, now)).toBe(
        "15 days remaining",
      );

      // 2 days remaining
      expect(formatBinCountdown(now - 28.2 * 24 * 60 * 60 * 1000, now)).toBe(
        "2 days remaining",
      );

      // 1 day remaining
      expect(formatBinCountdown(now - 29 * 24 * 60 * 60 * 1000, now)).toBe(
        "1 day remaining",
      );

      // Less than 24 hours remaining
      expect(formatBinCountdown(now - 29.5 * 24 * 60 * 60 * 1000, now)).toBe(
        "1 day remaining",
      );

      // Exactly or past expiration
      expect(formatBinCountdown(now - BIN_RETENTION_MS, now)).toBe(
        "Expires today",
      );

      expect(formatBinCountdown(now - (BIN_RETENTION_MS + 1000), now)).toBe(
        "Expires today",
      );

      // Defensive: missing deleted_at is treated as expired
      expect(formatBinCountdown(null, now)).toBe("Expires today");
      expect(formatBinCountdown(undefined, now)).toBe("Expires today");
    });

    it("clamps future deleted_at timestamps (cross-device clock skew)", () => {
      const twoDaysAhead = now + 2 * 24 * 60 * 60 * 1000;
      // A device clock 2 days ahead must not extend the countdown past 30 days
      expect(getBinRemainingDays(twoDaysAhead, now)).toBe(30);
      expect(formatBinCountdown(twoDaysAhead, now)).toBe("30 days remaining");
    });
  });

  describe("entriesDao.emptyBin", () => {
    it("permanently purges all binned entries and records tombstones without affecting active entries", async () => {
      const t0 = 1789700000000;

      // Active entry 1
      await entriesDao.insertEntry({
        id: "active-1",
        title: "Active Entry 1",
        summary: "Active note",
        transcript: "Active transcript",
        tags: ["work"],
        duration_sec: 25,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "drive-aud-active",
        drive_sidecar_file_id: "drive-sc-active",
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0,
        deleted_at: null,
      });

      // Binned entry 1
      await entriesDao.insertEntry({
        id: "binned-1",
        title: "Binned Note 1",
        summary: "Old note",
        transcript: "Binned transcript 1",
        tags: ["personal"],
        duration_sec: 30,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "drive-aud-bin1",
        drive_sidecar_file_id: "drive-sc-bin1",
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0,
        deleted_at: t0 + 1000,
      });

      // Binned entry 2
      await entriesDao.insertEntry({
        id: "binned-2",
        title: "Binned Note 2",
        summary: "Another note",
        transcript: "Binned transcript 2",
        tags: ["ideas"],
        duration_sec: 15,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "drive-aud-bin2",
        drive_sidecar_file_id: "drive-sc-bin2",
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0,
        deleted_at: t0 + 2000,
      });

      // Verify initial state
      const initialBinned = await entriesDao.getBinnedEntries();
      expect(initialBinned.length).toBe(2);

      // Empty the bin
      const purged = await entriesDao.emptyBin();
      expect(purged.length).toBe(2);
      expect(purged.map((e) => e.id)).toEqual(
        expect.arrayContaining(["binned-1", "binned-2"]),
      );

      // Bin is now empty
      const afterEmptyBinned = await entriesDao.getBinnedEntries();
      expect(afterEmptyBinned.length).toBe(0);

      // Binned rows deleted from SQLite
      expect(await entriesDao.getEntryById("binned-1")).toBeNull();
      expect(await entriesDao.getEntryById("binned-2")).toBeNull();

      // Cloud deletion tombstones recorded for synced binned entries
      expect(await deletedEntriesDao.isDeleted("binned-1")).toBe(true);
      expect(await deletedEntriesDao.isDeleted("binned-2")).toBe(true);

      // Active entry remains completely unaffected
      const activeEntry = await entriesDao.getEntryById("active-1");
      expect(activeEntry).not.toBeNull();
      expect(activeEntry?.title).toBe("Active Entry 1");
      expect(await deletedEntriesDao.isDeleted("active-1")).toBe(false);

      const activeList = await entriesDao.getEntries();
      expect(activeList.length).toBe(1);
      expect(activeList[0].id).toBe("active-1");
    });
  });

  describe("entriesDao.purgeExpiredBinnedEntries", () => {
    it("purges only entries past the retention window and records Drive tombstones", async () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      // Active entry (never binned)
      await entriesDao.insertEntry({
        id: "purge-active",
        title: "Active",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now,
        last_accessed_at: now,
        deleted_at: null,
      });

      // Binned 5 days ago (within retention)
      await entriesDao.insertEntry({
        id: "purge-kept",
        title: "Kept",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now - 6 * dayMs,
        last_accessed_at: now - 6 * dayMs,
        deleted_at: now - 5 * dayMs,
      });

      // Binned 31 days ago (past retention, synced to Drive)
      await entriesDao.insertEntry({
        id: "purge-expired",
        title: "Expired",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "drive-aud-purge",
        drive_sidecar_file_id: "drive-sc-purge",
        is_audio_cached: 1,
        created_at: now - 32 * dayMs,
        last_accessed_at: now - 32 * dayMs,
        deleted_at: now - 31 * dayMs,
      });

      expect(await entriesDao.getBinnedEntryCount()).toBe(2);

      const purged = await entriesDao.purgeExpiredBinnedEntries();

      // Only the expired entry is purged
      expect(purged.map((e) => e.id)).toEqual(["purge-expired"]);
      expect(await entriesDao.getEntryById("purge-expired")).toBeNull();

      // Tombstone recorded with Drive file IDs so sync deletes cloud copies
      const tombstones = await deletedEntriesDao.getPendingDeletions();
      const tomb = tombstones.find((d) => d.id === "purge-expired");
      expect(tomb).toBeDefined();
      expect(tomb?.drive_sidecar_file_id).toBe("drive-sc-purge");
      expect(tomb?.drive_audio_file_id).toBe("drive-aud-purge");

      // Non-expired binned and active entries are untouched
      const kept = await entriesDao.getEntryById("purge-kept");
      expect(kept).not.toBeNull();
      expect(kept?.deleted_at).toBe(now - 5 * dayMs);
      expect(await entriesDao.getEntryById("purge-active")).not.toBeNull();
      expect(await deletedEntriesDao.isDeleted("purge-active")).toBe(false);

      expect(await entriesDao.getBinnedEntryCount()).toBe(1);
      expect((await entriesDao.getBinnedEntries()).map((e) => e.id)).toEqual([
        "purge-kept",
      ]);
    });

    it("records no tombstone for never-uploaded entries", async () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      await entriesDao.insertEntry({
        id: "purge-local-only",
        title: "Local Only",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: null,
        drive_sidecar_file_id: null,
        is_audio_cached: 1,
        created_at: now - 32 * dayMs,
        last_accessed_at: now - 32 * dayMs,
        deleted_at: now - 31 * dayMs,
      });

      const purged = await entriesDao.purgeExpiredBinnedEntries();
      expect(purged.map((e) => e.id)).toEqual(["purge-local-only"]);

      const tomb = (await deletedEntriesDao.getPendingDeletions()).find(
        (d) => d.id === "purge-local-only",
      );
      // Tombstone row exists (permanent deletion marker) but has no Drive IDs
      expect(tomb).toBeDefined();
      expect(tomb?.drive_sidecar_file_id).toBeNull();
      expect(tomb?.drive_audio_file_id).toBeNull();
    });
  });

  describe("entriesDao.restoreEntry", () => {
    it("restores a binned entry and marks it for cloud re-upload via the unsynced scan", async () => {
      const t0 = 1789700000000;
      const syncedAt = t0 + 5000;

      // Fully synced entry: local is not newer than cloud
      await entriesDao.insertEntry({
        id: "restore-1",
        title: "Restorable",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: null,
        drive_audio_file_id: "drive-aud-restore",
        drive_sidecar_file_id: "drive-sc-restore",
        is_audio_cached: 1,
        created_at: t0,
        updated_at: syncedAt,
        drive_synced_at: syncedAt,
        last_accessed_at: t0,
        deleted_at: null,
      });

      const hasUnsynced = async (id: string) =>
        (await entriesDao.getUnsyncedEntries()).some((e) => e.id === id);

      // Baseline: fully synced, nothing pending
      expect(await hasUnsynced("restore-1")).toBe(false);

      // Soft delete bumps updated_at -> pending cloud propagation
      await entriesDao.softDeleteEntry("restore-1");
      expect(await hasUnsynced("restore-1")).toBe(true);

      // Restore clears the bin flag and bumps updated_at -> picked up again
      const restored = await entriesDao.restoreEntry("restore-1");
      expect(restored?.deleted_at).toBeNull();

      const unsynced = await entriesDao.getUnsyncedEntries();
      const restoredUnsynced = unsynced.find((e) => e.id === "restore-1");
      expect(restoredUnsynced).toBeDefined();
      expect(restoredUnsynced?.deleted_at).toBeNull();
      expect(restoredUnsynced?.updated_at ?? 0).toBeGreaterThan(syncedAt);

      // Back in the active timeline, out of the bin
      expect((await entriesDao.getEntries()).map((e) => e.id)).toContain(
        "restore-1",
      );
      expect(
        (await entriesDao.getBinnedEntries()).map((e) => e.id),
      ).not.toContain("restore-1");
      expect(await entriesDao.getBinnedEntryCount()).toBe(0);
    });
  });

  describe("entriesDao.getPrunableCachedEntries", () => {
    it("excludes binned entries from LRU cache eviction", async () => {
      const t0 = 1789700000000;

      // Active entry with synced cloud copy
      await entriesDao.insertEntry({
        id: "prunable-active",
        title: "Active Prunable",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: "/data/audio/active.m4a",
        drive_audio_file_id: "drive-aud-prunable",
        drive_sidecar_file_id: "drive-sc-prunable",
        drive_synced_at: t0,
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0 - 5000,
        deleted_at: null,
      });

      // Binned entry with synced cloud copy
      await entriesDao.insertEntry({
        id: "binned-cached",
        title: "Binned Cached",
        summary: "",
        transcript: "",
        tags: [],
        duration_sec: 10,
        source_type: "recorded",
        local_audio_path: "/data/audio/binned.m4a",
        drive_audio_file_id: "drive-aud-bin-cached",
        drive_sidecar_file_id: "drive-sc-bin-cached",
        drive_synced_at: t0,
        is_audio_cached: 1,
        created_at: t0,
        last_accessed_at: t0 - 10000,
        deleted_at: t0,
      });

      const prunable = await entriesDao.getPrunableCachedEntries();
      expect(prunable.map((e) => e.id)).toEqual(["prunable-active"]);
      expect(prunable.some((e) => e.id === "binned-cached")).toBe(false);
    });
  });
});
