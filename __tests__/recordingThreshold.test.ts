import {
  audioRecordingService,
  MIN_RECORDING_DURATION_SEC,
} from "../src/services/audio/AudioRecordingService";
import { File } from "expo-file-system";
import { AppState } from "react-native";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((File as any).mockCopy).not.toHaveBeenCalled();
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

  it("freezes duration while paused and suppresses timer increments", async () => {
    jest.useFakeTimers();
    const statusHolder: {
      current?: { isPaused: boolean; durationMillis: number };
    } = {};

    await audioRecordingService.startRecording("pause-freeze-id", (status) => {
      statusHolder.current = status;
    });

    // Advance 500ms while active
    jest.advanceTimersByTime(500);
    const recordedDuration = statusHolder.current?.durationMillis ?? 0;
    expect(recordedDuration).toBeGreaterThan(0);

    // Pause recording
    await audioRecordingService.pauseRecording();
    expect(statusHolder.current?.isPaused).toBe(true);
    const pausedDuration = statusHolder.current?.durationMillis ?? 0;

    // Advance timers 1000ms while paused
    jest.advanceTimersByTime(1000);
    expect(statusHolder.current?.durationMillis).toBe(pausedDuration);

    await audioRecordingService.cancelRecording();
    jest.useRealTimers();
  });

  it("re-pauses native recorder on foreground transition if user was paused", async () => {
    let appStateListener: ((state: string) => void) | null = null;
    jest
      .spyOn(AppState, "addEventListener")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((event: string, callback: any) => {
        if (event === "change") {
          appStateListener = callback;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { remove: jest.fn() } as any;
      });

    await audioRecordingService.startRecording("background-id");

    const mockPause = jest.fn();
    const mockRecord = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioRecordingService as any).activeRecorder = {
      getStatus: () => ({ isRecording: true, durationMillis: 2000 }),
      pause: mockPause,
      record: mockRecord,
      stop: jest.fn(),
    };

    // User explicitly paused recording
    await audioRecordingService.pauseRecording();

    // App comes back to foreground (simulating Android OnActivityEntersForeground auto-resume)
    expect(appStateListener).toBeTruthy();
    appStateListener!("active");

    // Native recorder must be re-paused to honor the user's paused state
    expect(mockPause).toHaveBeenCalled();

    await audioRecordingService.cancelRecording();
  });

  it("safely handles resumeRecording without throwing if recorder is already recording or throws IllegalStateException", async () => {
    await audioRecordingService.startRecording("safe-resume-id");

    const mockRecord = jest.fn().mockImplementation(() => {
      throw new Error("java.lang.IllegalStateException");
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioRecordingService as any).activeRecorder = {
      getStatus: () => ({ isRecording: false }),
      record: mockRecord,
      pause: jest.fn(),
      stop: jest.fn(),
    };
    await audioRecordingService.pauseRecording();

    // Should catch the IllegalStateException without uncaught rejection
    await expect(
      audioRecordingService.resumeRecording(),
    ).resolves.not.toThrow();

    await audioRecordingService.cancelRecording();
  });
});
