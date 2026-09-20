import {
  audioRecordingService,
  MIN_RECORDING_DURATION_SEC,
} from "../src/services/audio/AudioRecordingService";
import { setAudioModeAsync, AudioModule } from "expo-audio";
import { File } from "expo-file-system";
import { PermissionsAndroid, Platform } from "react-native";

describe("Android Background Recording & Notification Controls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Permissions", () => {
    it("requests POST_NOTIFICATIONS on Android 13+ (API 33+)", async () => {
      const originalOS = Platform.OS;
      const originalVersion = Platform.Version;

      // Simulate Android 33+
      Object.defineProperty(Platform, "OS", {
        value: "android",
        configurable: true,
      });
      Object.defineProperty(Platform, "Version", {
        value: 33,
        configurable: true,
      });

      const requestPermissionSpy = jest
        .spyOn(PermissionsAndroid, "request")
        .mockResolvedValueOnce("granted");

      jest
        .spyOn(AudioModule, "requestRecordingPermissionsAsync")
        .mockResolvedValueOnce({ granted: true, status: "granted" } as never);

      const result = await audioRecordingService.requestPermissions();

      expect(result).toBe(true);
      expect(requestPermissionSpy).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );

      Object.defineProperty(Platform, "OS", {
        value: originalOS,
        configurable: true,
      });
      Object.defineProperty(Platform, "Version", {
        value: originalVersion,
        configurable: true,
      });
    });

    it("returns false if microphone permission is denied", async () => {
      jest
        .spyOn(AudioModule, "requestRecordingPermissionsAsync")
        .mockResolvedValueOnce({ granted: false, status: "denied" } as never);

      const result = await audioRecordingService.requestPermissions();
      expect(result).toBe(false);
    });
  });

  describe("Background Audio Mode Configuration", () => {
    it("configures audio mode with allowsBackgroundRecording: true", async () => {
      await audioRecordingService.startRecording("bg-test-entry");

      expect(setAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          allowsRecording: true,
          playsInSilentMode: true,
          allowsBackgroundRecording: true,
        }),
      );

      await audioRecordingService.cancelRecording();

      expect(setAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          allowsRecording: false,
          allowsBackgroundRecording: false,
        }),
      );
    });
  });

  describe("External Notification Controls (recordingStatusUpdate)", () => {
    it("handles external pause from Android notification", async () => {
      const statusUpdates: { isPaused: boolean; isRecording: boolean }[] = [];

      await audioRecordingService.startRecording("notif-pause-id", (status) => {
        statusUpdates.push({
          isPaused: status.isPaused,
          isRecording: status.isRecording,
        });
      });

      // Simulate native notification trigger: pause action
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).handleRecordingStatusUpdate({
        isFinished: false,
        isPaused: true,
      });

      const lastStatus = statusUpdates[statusUpdates.length - 1];
      expect(lastStatus.isPaused).toBe(true);
      expect(lastStatus.isRecording).toBe(true);

      await audioRecordingService.cancelRecording();
    });

    it("handles external resume from Android notification", async () => {
      const statusUpdates: { isPaused: boolean; isRecording: boolean }[] = [];

      await audioRecordingService.startRecording(
        "notif-resume-id",
        (status) => {
          statusUpdates.push({
            isPaused: status.isPaused,
            isRecording: status.isRecording,
          });
        },
      );

      // Pause first
      await audioRecordingService.pauseRecording();
      expect(statusUpdates[statusUpdates.length - 1].isPaused).toBe(true);

      // Simulate native notification trigger: resume action
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).handleRecordingStatusUpdate({
        isFinished: false,
        isPaused: false,
      });

      expect(statusUpdates[statusUpdates.length - 1].isPaused).toBe(false);

      await audioRecordingService.cancelRecording();
    });

    it("saves recording and invokes onExternalStop when stopped from notification", async () => {
      const externalStopMock = jest.fn();
      audioRecordingService.setOnExternalStop(externalStopMock);

      await audioRecordingService.startRecording("notif-stop-id");

      // Simulate 5 seconds recorded
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).durationMillis = 5000;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).activeRecorder = {
        uri: "file:///mock-cache/Audio/recording-test.m4a",
        stop: jest.fn(),
      };

      // Simulate native notification Stop action
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (audioRecordingService as any).handleRecordingStatusUpdate({
        isFinished: true,
        url: "file:///mock-cache/Audio/recording-test.m4a",
      });

      expect(externalStopMock).toHaveBeenCalledWith(
        expect.objectContaining({
          entryId: "notif-stop-id",
          durationSec: 5,
        }),
      );

      const calledResult = externalStopMock.mock.calls[0][0];
      expect(calledResult.localUri).toContain("notif-stop-id.m4a");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((File as any).mockCopy).toHaveBeenCalled();

      // Clean up
      audioRecordingService.setOnExternalStop(null);
    });

    it("discards recording when stopped from notification under 3 seconds", async () => {
      const externalStopMock = jest.fn();
      audioRecordingService.setOnExternalStop(externalStopMock);

      await audioRecordingService.startRecording("short-notif-stop-id");

      // Duration < 3 seconds (1.5s)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).durationMillis = 1500;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRecordingService as any).activeRecorder = {
        uri: "file:///mock-cache/Audio/short.m4a",
        stop: jest.fn(),
      };

      // Simulate native notification Stop action
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (audioRecordingService as any).handleRecordingStatusUpdate({
        isFinished: true,
        url: "file:///mock-cache/Audio/short.m4a",
      });

      expect(externalStopMock).toHaveBeenCalledWith(
        expect.objectContaining({
          entryId: "short-notif-stop-id",
          localUri: "",
          durationSec: 1,
        }),
      );

      expect(1).toBeLessThan(MIN_RECORDING_DURATION_SEC);

      // Clean up
      audioRecordingService.setOnExternalStop(null);
    });
  });
});
