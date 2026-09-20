import { AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { Directory, File } from "expo-file-system";
import { getEntryAudioPath, normalizeMetering } from "../../utils/paths";
import { generateUUID } from "../../utils/uuid";
import { resampleWaveform, WAVEFORM_BAR_COUNT } from "../../utils/waveform";
import { audioPlaybackService } from "./AudioPlaybackService";

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
  getStatus?: () => { metering?: number; isRecording?: boolean };
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
  private recordedSamples: number[] = [];

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
    // Ensure any active playback is halted to avoid feedback/conflicts
    try {
      await audioPlaybackService.stop();
    } catch {
      // Ignore
    }

    this.currentEntryId = entryId;
    this.currentTimestamp = Date.now();
    this.statusCallback = onStatusUpdate || null;
    this.durationMillis = 0;
    this.isPaused = false;
    this.recordedSamples = [];

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
        const recordingOptions = {
          ...RecordingPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        };
        const recorder = new AudioModule.AudioRecorder(recordingOptions);
        this.activeRecorder = recorder;
        await recorder.prepareToRecordAsync(recordingOptions);
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
      let rawDb: number | null = null;

      if (this.activeRecorder) {
        if (typeof this.activeRecorder.getStatus === "function") {
          try {
            const st = this.activeRecorder.getStatus();
            if (st && typeof st.metering === "number") {
              rawDb = st.metering;
            }
            if (
              st &&
              typeof (st as { durationMillis?: number }).durationMillis ===
                "number" &&
              (st as { durationMillis?: number }).durationMillis! > 0
            ) {
              this.durationMillis = (
                st as { durationMillis: number }
              ).durationMillis;
            } else if (!this.isPaused) {
              this.durationMillis += 100;
            }
          } catch {
            if (!this.isPaused) {
              this.durationMillis += 100;
            }
          }
        } else if (this.activeRecorder.metering !== undefined) {
          rawDb = this.activeRecorder.metering;
          if (!this.isPaused) {
            this.durationMillis += 100;
          }
        } else if (!this.isPaused) {
          this.durationMillis += 100;
        }
      } else if (!this.isPaused) {
        this.durationMillis += 100;
      }

      if (this.statusCallback) {
        const normalized = this.isPaused
          ? 0.05
          : rawDb !== null
            ? normalizeMetering(rawDb)
            : 0.05;

        if (!this.isPaused) {
          this.recordedSamples.push(normalized);
        }

        this.statusCallback({
          isRecording: true,
          isPaused: this.isPaused,
          durationMillis: this.durationMillis,
          meteringLevel: normalized,
        });
      }
    }, 100);
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
    waveformData?: number[];
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
          const tempFile = new File(recordedTempUri);
          if (tempFile.exists) {
            tempFile.delete();
          }
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
      const directory = new Directory(dir);
      if (!directory.exists) {
        directory.create({ intermediates: true, idempotent: true });
      }

      if (recordedTempUri && recordedTempUri !== destinationUri) {
        await new File(recordedTempUri).copy(new File(destinationUri));
      }
    } catch (fsErr) {
      console.warn("Could not copy recording to sandbox path:", fsErr);
    }

    const waveformData =
      this.recordedSamples.length > 0
        ? resampleWaveform(this.recordedSamples, WAVEFORM_BAR_COUNT)
        : undefined;

    this.activeRecorder = null;
    this.statusCallback = null;
    this.currentEntryId = null;
    this.recordedSamples = [];

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // Ignore audio mode reset error
    }

    return {
      localUri: destinationUri,
      durationSec: finalDurationSec,
      waveformData,
    };
  }

  async cancelRecording(): Promise<void> {
    this.stopStatusTimer();
    this.recordedSamples = [];
    if (this.activeRecorder) {
      try {
        await this.activeRecorder.stop?.();
        const uri = this.activeRecorder.uri || this.activeRecorder.getURI?.();
        if (uri) {
          const tempFile = new File(uri);
          if (tempFile.exists) {
            tempFile.delete();
          }
        }
      } catch {
        // Ignore cancel cleanup errors
      }
    }
    this.activeRecorder = null;
    this.statusCallback = null;
    this.currentEntryId = null;

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // Ignore audio mode reset error
    }
  }
}

export const audioRecordingService = new AudioRecordingService();
