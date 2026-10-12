import * as Sharing from "expo-sharing";
import { Share } from "react-native";
import { File } from "expo-file-system";
import { AudioShareService } from "../src/services/share/AudioShareService";

/** Mock expo-file-system File constructor exposing its static mock controls. */
const MockFile = File as unknown as {
  defaultExists: boolean;
  defaultSize: number;
  existingFiles: Set<string> | null;
  fileSizes: Map<string, number> | null;
};

/** Reset expo-file-system File mocks to defaults, optionally seeding files. */
function resetMockFiles(
  existingFiles: Set<string> = new Set(),
  fileSizes: Map<string, number> = new Map(),
): void {
  MockFile.defaultExists = true;
  MockFile.defaultSize = 1024;
  MockFile.existingFiles = existingFiles;
  MockFile.fileSizes = fileSizes;
}

describe("AudioShareService", () => {
  const isAvailableAsyncMock = Sharing.isAvailableAsync as jest.Mock;
  const shareAsyncMock = Sharing.shareAsync as jest.Mock;
  let shareSpy: jest.SpyInstance;

  beforeEach(() => {
    resetMockFiles();

    // Reset Sharing mocks
    isAvailableAsyncMock.mockReset();
    isAvailableAsyncMock.mockResolvedValue(true);
    shareAsyncMock.mockReset();
    shareAsyncMock.mockResolvedValue(undefined);

    // Spy on React Native Share.share
    shareSpy = jest.spyOn(Share, "share").mockResolvedValue({
      action: Share.sharedAction,
      activityType: undefined,
    });
  });

  afterEach(() => {
    shareSpy.mockRestore();
    resetMockFiles();
  });

  describe("isAudioDownloaded", () => {
    it("returns true when file exists and has positive size", () => {
      resetMockFiles(
        new Set(["file:///valid/audio.m4a"]),
        new Map([["file:///valid/audio.m4a", 2048]]),
      );

      expect(
        AudioShareService.isAudioDownloaded("file:///valid/audio.m4a"),
      ).toBe(true);
    });

    it("returns false for null, undefined, or empty path", () => {
      expect(AudioShareService.isAudioDownloaded(null)).toBe(false);
      expect(AudioShareService.isAudioDownloaded(undefined)).toBe(false);
      expect(AudioShareService.isAudioDownloaded("")).toBe(false);
      expect(AudioShareService.isAudioDownloaded("   ")).toBe(false);
    });

    it("returns false when file does not exist", () => {
      resetMockFiles(new Set());

      expect(
        AudioShareService.isAudioDownloaded("file:///missing/audio.m4a"),
      ).toBe(false);
    });

    it("returns false when file is 0 bytes", () => {
      resetMockFiles(
        new Set(["file:///empty/audio.m4a"]),
        new Map([["file:///empty/audio.m4a", 0]]),
      );

      expect(
        AudioShareService.isAudioDownloaded("file:///empty/audio.m4a"),
      ).toBe(false);
    });
  });

  describe("isSharingAvailable", () => {
    it("returns true when expo-sharing reports available", async () => {
      isAvailableAsyncMock.mockResolvedValueOnce(true);
      const available = await AudioShareService.isSharingAvailable();
      expect(available).toBe(true);
      expect(isAvailableAsyncMock).toHaveBeenCalled();
    });

    it("returns false when expo-sharing reports unavailable", async () => {
      isAvailableAsyncMock.mockResolvedValueOnce(false);
      const available = await AudioShareService.isSharingAvailable();
      expect(available).toBe(false);
    });

    it("returns false when isAvailableAsync throws an exception", async () => {
      isAvailableAsyncMock.mockRejectedValueOnce(
        new Error("Native module error"),
      );
      const available = await AudioShareService.isSharingAvailable();
      expect(available).toBe(false);
    });
  });

  describe("shareAudioFile", () => {
    const validPath = "file:///data/user/0/app/audio/entry1.m4a";

    beforeEach(() => {
      resetMockFiles(new Set([validPath]), new Map([[validPath, 4096]]));
    });

    it("fails when audio file is not downloaded locally", async () => {
      const result = await AudioShareService.shareAudioFile(
        "file:///nonexistent/audio.m4a",
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not available/i);
      expect(shareAsyncMock).not.toHaveBeenCalled();
    });

    it("fails when sharing is not available on device", async () => {
      isAvailableAsyncMock.mockResolvedValueOnce(false);

      const result = await AudioShareService.shareAudioFile(validPath);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not supported/i);
      expect(shareAsyncMock).not.toHaveBeenCalled();
    });

    it("shares audio using RFC standard audio/mp4 mimeType", async () => {
      const result = await AudioShareService.shareAudioFile(validPath);

      expect(result.success).toBe(true);
      expect(shareAsyncMock).toHaveBeenCalledTimes(1);
      expect(shareAsyncMock).toHaveBeenCalledWith(validPath, {
        mimeType: "audio/mp4",
        dialogTitle: "Share Audio Recording",
      });
    });

    it("prepends file:// if localPath does not have file scheme", async () => {
      const rawPath = "/data/user/0/app/audio/entry1.m4a";
      resetMockFiles(new Set([validPath]), new Map([[validPath, 4096]]));

      const result = await AudioShareService.shareAudioFile(rawPath);

      expect(result.success).toBe(true);
      expect(shareAsyncMock).toHaveBeenCalledWith(
        `file://${rawPath}`,
        expect.objectContaining({ mimeType: "audio/mp4" }),
      );
    });

    it("handles cancellation gracefully without error toast flag", async () => {
      shareAsyncMock.mockRejectedValueOnce(
        new Error("User cancelled the share"),
      );

      const result = await AudioShareService.shareAudioFile(validPath);

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("handles dismiss gracefully without error toast flag", async () => {
      shareAsyncMock.mockRejectedValueOnce(new Error("Share sheet dismissed"));

      const result = await AudioShareService.shareAudioFile(validPath);

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("returns error on unexpected native share failure", async () => {
      shareAsyncMock.mockRejectedValueOnce(new Error("Permission denied"));

      const result = await AudioShareService.shareAudioFile(validPath);

      expect(result.success).toBe(false);
      expect(result.cancelled).toBeUndefined();
      expect(result.error).toBe("Permission denied");
    });
  });

  describe("shareTranscript", () => {
    it("fails when transcript is empty or whitespace", async () => {
      const emptyResult = await AudioShareService.shareTranscript("Title", "");
      expect(emptyResult.success).toBe(false);
      expect(emptyResult.error).toMatch(/no transcript/i);

      const wsResult = await AudioShareService.shareTranscript(
        "Title",
        "   \n  ",
      );
      expect(wsResult.success).toBe(false);
      expect(shareSpy).not.toHaveBeenCalled();
    });

    it("formats message with title prefix when title is provided", async () => {
      const result = await AudioShareService.shareTranscript(
        "Morning Thoughts",
        "Today is a good day.",
      );

      expect(result.success).toBe(true);
      expect(shareSpy).toHaveBeenCalledWith({
        message: "Morning Thoughts\n\nToday is a good day.",
        title: "Morning Thoughts",
      });
    });

    it("shares only transcript and default title when title is empty", async () => {
      const result = await AudioShareService.shareTranscript(
        "",
        "Today is a good day.",
      );

      expect(result.success).toBe(true);
      expect(shareSpy).toHaveBeenCalledWith({
        message: "Today is a good day.",
        title: "Voice Journal Transcript",
      });
    });

    it("handles dismissedAction as cancelled without error", async () => {
      shareSpy.mockResolvedValueOnce({ action: Share.dismissedAction });

      const result = await AudioShareService.shareTranscript(
        "Note",
        "Hello world",
      );

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("handles dismissal/cancel exception gracefully", async () => {
      shareSpy.mockRejectedValueOnce(new Error("User cancelled"));

      const result = await AudioShareService.shareTranscript(
        "Note",
        "Hello world",
      );

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("returns error on unexpected share exception", async () => {
      shareSpy.mockRejectedValueOnce(new Error("Sharing service unavailable"));

      const result = await AudioShareService.shareTranscript(
        "Note",
        "Hello world",
      );

      expect(result.success).toBe(false);
      expect(result.cancelled).toBeUndefined();
      expect(result.error).toBe("Sharing service unavailable");
    });
  });
});
