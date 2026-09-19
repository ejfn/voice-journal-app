import {
  audioRecordingService,
  MIN_RECORDING_DURATION_SEC,
} from "../src/services/audio/AudioRecordingService";
import * as FileSystem from "expo-file-system/legacy";

describe("Recording Minimum Duration Threshold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports MIN_RECORDING_DURATION_SEC set to 3", () => {
    expect(MIN_RECORDING_DURATION_SEC).toBe(3);
  });

  it("discards and cleans up recordings shorter than 3 seconds", async () => {
    await audioRecordingService.startRecording("short-entry-id");

    // Immediately stop without waiting 3 seconds (duration < 3s)
    const result = await audioRecordingService.stopRecording();

    expect(result.durationSec).toBeLessThan(MIN_RECORDING_DURATION_SEC);
    expect(result.localUri).toBe("");
    // Should not copy to destination path
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  });

  it("saves and copies recordings that meet or exceed 3 seconds", async () => {
    await audioRecordingService.startRecording("valid-entry-id");

    // Mock internal durationMillis to simulate 3.5 seconds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioRecordingService as any).durationMillis = 3500;

    const result = await audioRecordingService.stopRecording();

    expect(result.durationSec).toBeGreaterThanOrEqual(
      MIN_RECORDING_DURATION_SEC,
    );
    expect(result.durationSec).toBe(3);
    expect(result.localUri).toContain("valid-entry-id.m4a");
  });
});
