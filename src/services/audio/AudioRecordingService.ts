import { AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { getEntryAudioPath, normalizeMetering } from "../../utils/paths";
import { generateUUID } from "../../utils/uuid";

export interface RecordingStatus {
  isRecording: boolean;
  isPaused: boolean;
  durationMillis: number;
  meteringLevel: number; // 0.0 to 1.0
}

export type RecordingStatusCallback = (status: RecordingStatus) => void;

interface AudioRecorderInstance {
  prepareToRecordAsync?: (options?: unknown) => Promise<unknown>;
  record?: () => void;
  pause?: () => Promise<unknown> | void;
  resume?: () => Promise<unknown> | void;
  stop?: () => Promise<unknown> | void;
  uri?: string | null;
  getURI?: () => string | null;
  metering?: number;
  getStatusAsync?: () => Promise<{ metering?: number }>;
}

export const MIN_RECORDING_DURATION_SEC = 3;

class AudioRecordingService {
  private activeRecorder: AudioRecorderInstance | null = null;
  private statusCallback: RecordingStatusCallback | null = null;
  private timerInterval: NodeJS.Timeout | null = null;
  private durationMillis: number = 0;
  private isPaused: boolean = false;
  private currentEntryId: string | null = null;
  private currentTimestamp: number = 0;

  async requestPermissions(): Promise<boolean> {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      return status.granted;
    } catch {
      return false;
    }
  }

  async startRecording(
    entryId: string,
    onStatusUpdate?: RecordingStatusCallback,
  ): Promise<void> {
    this.currentEntryId = entryId;
    this.currentTimestamp = Date.now();
    this.statusCallback = onStatusUpdate || null;
    this.durationMillis = 0;
    this.isPaused = false;

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    // In modern expo-audio (SDK 57), native AudioRecorder is instantiated from ExpoAudio native module
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireNativeModule } = require("expo-modules-core");
      const AudioModule = requireNativeModule("ExpoAudio");
      if (AudioModule && AudioModule.AudioRecorder) {
        const recorder = new AudioModule.AudioRecorder(
          RecordingPresets.HIGH_QUALITY,
        );
        this.activeRecorder = recorder;
        await recorder.prepareToRecordAsync({
          ...RecordingPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        });
        recorder.record();
      } else {
        // Fallback for mock/test environments
        this.activeRecorder = {
          record: () => {},
          stop: async () => {},
          pause: () => {},
          resume: () => {},
          uri: null,
        };
      }
    } catch (recorderErr) {
      console.warn("Could not start native audio recorder:", recorderErr);
      this.activeRecorder = {
        record: () => {},
        stop: async () => {},
        pause: () => {},
        resume: () => {},
        uri: null,
      };
    }

    this.startStatusTimer();
  }

  private startStatusTimer() {
    this.stopStatusTimer();
    this.timerInterval = setInterval(() => {
      if (!this.isPaused) {
        this.durationMillis += 200;
      }
      if (this.statusCallback) {
        // Sample metering from recorder if available, or generate subtle simulated level
        let rawDb = -30;
        if (this.activeRecorder?.getStatusAsync) {
          this.activeRecorder
            .getStatusAsync()
            .then((st: { metering?: number }) => {
              if (st && typeof st.metering === "number") {
                rawDb = st.metering;
              }
            })
            .catch(() => {});
        } else if (this.activeRecorder?.metering !== undefined) {
          rawDb = this.activeRecorder.metering;
        }

        const normalized = this.isPaused ? 0.05 : normalizeMetering(rawDb);
        this.statusCallback({
          isRecording: true,
          isPaused: this.isPaused,
          durationMillis: this.durationMillis,
          meteringLevel: normalized,
        });
      }
    }, 200);
  }

  private stopStatusTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  async pauseRecording(): Promise<void> {
    if (this.activeRecorder && !this.isPaused) {
      this.isPaused = true;
      if (this.activeRecorder.pause) {
        await this.activeRecorder.pause();
      }
      if (this.statusCallback) {
        this.statusCallback({
          isRecording: true,
          isPaused: true,
          durationMillis: this.durationMillis,
          meteringLevel: 0.05,
        });
      }
    }
  }

  async resumeRecording(): Promise<void> {
    if (this.activeRecorder && this.isPaused) {
      this.isPaused = false;
      if (this.activeRecorder.record) {
        await this.activeRecorder.record();
      } else if (this.activeRecorder.resume) {
        await this.activeRecorder.resume();
      }
    }
  }

  async stopRecording(): Promise<{
    localUri: string;
    durationSec: number;
  }> {
    this.stopStatusTimer();
    const finalDurationSec = Math.floor(this.durationMillis / 1000);

    let recordedTempUri: string | null = null;
    if (this.activeRecorder) {
      try {
        if (this.activeRecorder.stop) {
          await this.activeRecorder.stop();
        }
        recordedTempUri =
          this.activeRecorder.uri || this.activeRecorder.getURI?.() || null;
      } catch (err) {
        console.warn("Error stopping audio recorder:", err);
      }
    }

    // Recordings shorter than MIN_RECORDING_DURATION_SEC will not be saved
    if (finalDurationSec < MIN_RECORDING_DURATION_SEC) {
      if (recordedTempUri) {
        try {
          await FileSystem.deleteAsync(recordedTempUri, { idempotent: true });
        } catch {
          // Ignore temp cleanup errors
        }
      }
      this.activeRecorder = null;
      this.statusCallback = null;
      this.currentEntryId = null;

      return {
        localUri: "",
        durationSec: finalDurationSec,
      };
    }

    const entryId = this.currentEntryId || generateUUID();
    const destinationUri = getEntryAudioPath(
      entryId,
      this.currentTimestamp || Date.now(),
    );

    // Ensure sandboxed destination directory exists (e.g. audio/YYYY/MM/)
    const dir = destinationUri.substring(
      0,
      destinationUri.lastIndexOf("/") + 1,
    );
    try {
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }

      if (recordedTempUri && recordedTempUri !== destinationUri) {
        await FileSystem.copyAsync({
          from: recordedTempUri,
          to: destinationUri,
        });
      }
    } catch (fsErr) {
      console.warn("Could not copy recording to sandbox path:", fsErr);
    }

    this.activeRecorder = null;
    this.statusCallback = null;
    this.currentEntryId = null;

    return {
      localUri: destinationUri,
      durationSec: finalDurationSec,
    };
  }

  async cancelRecording(): Promise<void> {
    this.stopStatusTimer();
    if (this.activeRecorder) {
      try {
        await this.activeRecorder.stop?.();
        const uri = this.activeRecorder.uri || this.activeRecorder.getURI?.();
        if (uri) {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        }
      } catch {
        // Ignore cancel cleanup errors
      }
    }
    this.activeRecorder = null;
    this.statusCallback = null;
    this.currentEntryId = null;
  }
}

export const audioRecordingService = new AudioRecordingService();
