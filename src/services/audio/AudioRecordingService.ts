import { AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { Directory, File } from "expo-file-system";
import {
  AppState,
  AppStateStatus,
  NativeEventSubscription,
  PermissionsAndroid,
  Platform,
} from "react-native";
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

export interface RecordingResult {
  entryId: string;
  localUri: string;
  durationSec: number;
  waveformData?: number[];
}

export type ExternalStopCallback = (
  result: RecordingResult,
) => void | Promise<void>;

interface AudioRecorderInstance {
  prepareToRecordAsync?: (options?: unknown) => Promise<unknown>;
  record?: () => void;
  pause?: () => Promise<unknown> | void;
  resume?: () => Promise<unknown> | void;
  stop?: () => Promise<unknown> | void;
  uri?: string | null;
  getURI?: () => string | null;
  metering?: number;
  getStatus?: () => {
    metering?: number;
    isRecording?: boolean;
    durationMillis?: number;
  };
  getStatusAsync?: () => Promise<{ metering?: number }>;
  addListener?: (
    eventName: string,
    listener: (event: {
      isFinished?: boolean;
      isPaused?: boolean;
      error?: string | null;
      url?: string | null;
    }) => void,
  ) => { remove: () => void };
}

export const MIN_RECORDING_DURATION_SEC = 3;

class AudioRecordingService {
  private activeRecorder: AudioRecorderInstance | null = null;
  private statusCallback: RecordingStatusCallback | null = null;
  private externalStopCallback: ExternalStopCallback | null = null;
  private statusSubscription: { remove: () => void } | null = null;
  private timerInterval: NodeJS.Timeout | null = null;
  private durationMillis: number = 0;
  private isPaused: boolean = false;
  private isActionInProgress: boolean = false;
  private isStoppingInternally: boolean = false;
  private appStateSubscription: NativeEventSubscription | null = null;
  private currentEntryId: string | null = null;
  private currentTimestamp: number = 0;
  private recordedSamples: number[] = [];

  setOnExternalStop(callback: ExternalStopCallback | null) {
    this.externalStopCallback = callback;
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        return false;
      }
      const androidVersion =
        typeof Platform.Version === "number"
          ? Platform.Version
          : parseInt(String(Platform.Version), 10);
      if (
        Platform.OS === "android" &&
        !isNaN(androidVersion) &&
        androidVersion >= 33
      ) {
        try {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
        } catch {
          // Non-fatal if permission request throws in mock/test
        }
      }
      return true;
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
    this.isActionInProgress = false;
    this.isStoppingInternally = false;
    this.recordedSamples = [];
    this.setupAppStateListener();

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      allowsBackgroundRecording: true,
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
        if (typeof recorder.addListener === "function") {
          this.statusSubscription = recorder.addListener(
            "recordingStatusUpdate",
            (status: {
              isFinished?: boolean;
              isPaused?: boolean;
              error?: string | null;
              url?: string | null;
            }) => {
              this.handleRecordingStatusUpdate(status);
            },
          );
        }
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

  private handleRecordingStatusUpdate(status: {
    isFinished?: boolean;
    isPaused?: boolean;
    error?: string | null;
    url?: string | null;
  }) {
    if (status.isPaused !== undefined) {
      if (status.isPaused && !this.isPaused) {
        this.isPaused = true;
        this.emitStatus();
      } else if (!status.isPaused && this.isPaused) {
        this.isPaused = false;
        this.emitStatus();
      }
    }

    if (status.isFinished && !this.isStoppingInternally) {
      // Stopped externally from Android notification
      return this.handleExternalStop(status.url || null);
    }
  }

  private async handleExternalStop(url: string | null) {
    if (this.isStoppingInternally) return;
    this.isStoppingInternally = true;
    this.stopStatusTimer();
    this.removeAppStateListener();
    this.removeStatusSubscription();
    this.isActionInProgress = false;

    const finalDurationSec = Math.floor(this.durationMillis / 1000);
    const recordedTempUri =
      url ||
      this.activeRecorder?.uri ||
      this.activeRecorder?.getURI?.() ||
      null;

    const entryId = this.currentEntryId || generateUUID();

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

      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          allowsBackgroundRecording: false,
        });
      } catch {
        // Ignore
      }

      if (this.externalStopCallback) {
        await this.externalStopCallback({
          entryId,
          localUri: "",
          durationSec: finalDurationSec,
        });
      }
      return;
    }

    const destinationUri = getEntryAudioPath(
      entryId,
      this.currentTimestamp || Date.now(),
    );

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
        allowsBackgroundRecording: false,
      });
    } catch {
      // Ignore
    }

    if (this.externalStopCallback) {
      await this.externalStopCallback({
        entryId,
        localUri: destinationUri,
        durationSec: finalDurationSec,
        waveformData,
      });
    }
  }

  private setupAppStateListener() {
    this.removeAppStateListener();
    this.appStateSubscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (!this.activeRecorder) return;
        if (nextState === "active") {
          // When app returns to foreground, check status to keep synced with notification actions
          if (typeof this.activeRecorder.getStatus === "function") {
            try {
              const st = this.activeRecorder.getStatus();
              if (st) {
                if (st.isRecording === false && !this.isPaused) {
                  this.isPaused = true;
                  this.emitStatus();
                } else if (st.isRecording === true && this.isPaused) {
                  this.activeRecorder.pause?.();
                }
              }
            } catch {
              // Ignore
            }
          }
        }
      },
    );
  }

  private removeAppStateListener() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  private removeStatusSubscription() {
    if (this.statusSubscription) {
      this.statusSubscription.remove();
      this.statusSubscription = null;
    }
  }

  private emitStatus() {
    if (this.statusCallback) {
      this.statusCallback({
        isRecording: true,
        isPaused: this.isPaused,
        durationMillis: this.durationMillis,
        meteringLevel: 0.05,
      });
    }
  }

  private startStatusTimer() {
    this.stopStatusTimer();
    this.timerInterval = setInterval(() => {
      let rawDb: number | null = null;

      if (this.activeRecorder) {
        if (this.isPaused) {
          // While paused, do NOT advance duration.
          // Re-enforce pause if native state drifted
          try {
            const st = this.activeRecorder.getStatus?.();
            if (st?.isRecording) {
              this.activeRecorder.pause?.();
            }
          } catch {
            // Ignore
          }
        } else {
          // Actively recording: query native status and advance duration
          if (typeof this.activeRecorder.getStatus === "function") {
            try {
              const st = this.activeRecorder.getStatus();
              if (st && typeof st.metering === "number") {
                rawDb = st.metering;
              }
              if (
                st &&
                typeof st.durationMillis === "number" &&
                st.durationMillis > 0
              ) {
                this.durationMillis = st.durationMillis;
              } else {
                this.durationMillis += 100;
              }
            } catch {
              this.durationMillis += 100;
            }
          } else if (this.activeRecorder.metering !== undefined) {
            rawDb = this.activeRecorder.metering;
            this.durationMillis += 100;
          } else {
            this.durationMillis += 100;
          }
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
    if (this.isActionInProgress || !this.activeRecorder || this.isPaused) {
      return;
    }
    this.isActionInProgress = true;
    this.isPaused = true;
    try {
      if (this.activeRecorder.pause) {
        await this.activeRecorder.pause();
      }
    } catch (err) {
      console.warn("Error pausing audio recorder:", err);
    } finally {
      this.isActionInProgress = false;
    }
    this.emitStatus();
  }

  async resumeRecording(): Promise<void> {
    if (this.isActionInProgress || !this.activeRecorder || !this.isPaused) {
      return;
    }
    this.isActionInProgress = true;
    this.isPaused = false;
    try {
      let isAlreadyRecording = false;
      if (typeof this.activeRecorder.getStatus === "function") {
        try {
          const st = this.activeRecorder.getStatus();
          isAlreadyRecording = Boolean(st?.isRecording);
        } catch {
          // Ignore
        }
      }
      if (!isAlreadyRecording) {
        if (this.activeRecorder.record) {
          await this.activeRecorder.record();
        } else if (this.activeRecorder.resume) {
          await this.activeRecorder.resume();
        }
      }
    } catch (err) {
      console.warn("Error resuming audio recorder:", err);
    } finally {
      this.isActionInProgress = false;
    }
    this.emitStatus();
  }

  async stopRecording(): Promise<{
    localUri: string;
    durationSec: number;
    waveformData?: number[];
  }> {
    this.isStoppingInternally = true;
    this.stopStatusTimer();
    this.removeAppStateListener();
    this.removeStatusSubscription();
    this.isActionInProgress = false;
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

      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          allowsBackgroundRecording: false,
        });
      } catch {
        // Ignore
      }

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
        allowsBackgroundRecording: false,
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
    this.isStoppingInternally = true;
    this.stopStatusTimer();
    this.removeAppStateListener();
    this.removeStatusSubscription();
    this.isActionInProgress = false;
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
        allowsBackgroundRecording: false,
      });
    } catch {
      // Ignore audio mode reset error
    }
  }
}

export const audioRecordingService = new AudioRecordingService();
