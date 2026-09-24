import { Linking } from "react-native";
import {
  updateService,
  parseCleanVersion,
  isVersionNewer,
  LATEST_RELEASE_API,
  LATEST_RELEASE_PAGE_URL,
} from "../src/services/updates/updateService";
import { settingsDao } from "../src/db/dao/settingsDao";
import { initDatabase, setDatabaseConnection } from "../src/db/database";
import { createTestDb } from "./helpers/testDb";

describe("updateService", () => {
  beforeEach(async () => {
    const testDb = createTestDb();
    setDatabaseConnection(testDb);
    await initDatabase();
    jest.clearAllMocks();
  });

  afterEach(() => {
    setDatabaseConnection(null);
  });

  describe("version parsing and comparison", () => {
    it("parses clean semver correctly", () => {
      expect(parseCleanVersion("v0.9.3")).toEqual([0, 9, 3]);
      expect(parseCleanVersion("0.1.0")).toEqual([0, 1, 0]);
      expect(parseCleanVersion("v1.2.3-dev+abc1234")).toEqual([1, 2, 3]);
      expect(parseCleanVersion("v2.0.0-beta.1")).toEqual([2, 0, 0]);
      expect(parseCleanVersion("")).toEqual([0, 0, 0]);
      expect(parseCleanVersion("invalid")).toEqual([0, 0, 0]);
    });

    it("correctly determines if remote version is newer", () => {
      expect(isVersionNewer("v0.9.3", "v0.9.2")).toBe(true);
      expect(isVersionNewer("v0.10.0", "v0.9.9")).toBe(true);
      expect(isVersionNewer("v1.0.0", "v0.9.9")).toBe(true);
      expect(isVersionNewer("v0.9.2", "v0.9.2")).toBe(false);
      expect(isVersionNewer("v0.9.1", "v0.9.2")).toBe(false);
      expect(isVersionNewer("v0.9.2", "v0.1.0-dev+abc1234")).toBe(true);
    });
  });

  describe("snooze settings in settingsDao", () => {
    it("reads and writes snooze settings", async () => {
      const initial = await settingsDao.getUpdateSnooze();
      expect(initial.version).toBe("");
      expect(initial.until).toBe(0);

      const targetUntil = Date.now() + 7 * 86400000;
      await settingsDao.setUpdateSnooze("v0.9.3", targetUntil);

      const saved = await settingsDao.getUpdateSnooze();
      expect(saved.version).toBe("v0.9.3");
      expect(saved.until).toBe(targetUntil);

      await settingsDao.clearUpdateSnooze();
      const cleared = await settingsDao.getUpdateSnooze();
      expect(cleared.version).toBe("");
      expect(cleared.until).toBe(0);
    });
  });

  describe("checkForAvailableUpdate", () => {
    const mockApkRelease = {
      tag_name: "v0.9.3",
      name: "Voice Journal v0.9.3",
      assets: [
        {
          name: "voice-journal-app-0.9.3.apk",
          browser_download_url:
            "https://github.com/ejfn/voice-journal-app/releases/download/v0.9.3/voice-journal-app-0.9.3.apk",
        },
      ],
    };

    it("returns update info when newer APK release is found", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v0.9.2");

      expect(fetch).toHaveBeenCalledWith(
        LATEST_RELEASE_API,
        expect.objectContaining({
          headers: { Accept: "application/vnd.github.v3+json" },
        }),
      );
      expect(update).toEqual({
        tagName: "v0.9.3",
        version: "0.9.3",
        name: "Voice Journal v0.9.3",
        releaseUrl: LATEST_RELEASE_PAGE_URL,
        apkDownloadUrl:
          "https://github.com/ejfn/voice-journal-app/releases/download/v0.9.3/voice-journal-app-0.9.3.apk",
      });
    });

    it("returns null if release has no APK asset", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v0.9.3",
          name: "v0.9.3",
          assets: [{ name: "source-code.zip" }],
        }),
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v0.9.2");
      expect(update).toBeNull();
    });

    it("returns null if remote version is not newer than current", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v0.9.3");
      expect(update).toBeNull();
    });

    it("returns null if the release is snoozed within 7 days", async () => {
      await updateService.snoozeUpdate("v0.9.3", 7);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v0.9.2");
      expect(update).toBeNull();
    });

    it("returns update if a newer release tag arrives after a previous version was snoozed", async () => {
      await updateService.snoozeUpdate("v0.9.2", 7);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease, // tag_name: "v0.9.3"
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v0.9.1");
      expect(update).not.toBeNull();
      expect(update?.tagName).toBe("v0.9.3");
    });

    it("silently catches network errors and returns null", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network connection lost"));

      const update = await updateService.checkForAvailableUpdate("v0.9.2");
      expect(update).toBeNull();
    });

    it("silently catches non-200 responses and returns null", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v0.9.2");
      expect(update).toBeNull();
    });
  });

  describe("openLatestReleasePage", () => {
    it("calls Linking.openURL with the latest release page url", async () => {
      const openURLSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

      await updateService.openLatestReleasePage();
      expect(openURLSpy).toHaveBeenCalledWith(LATEST_RELEASE_PAGE_URL);
    });
  });
});
