import { AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { File } from "expo-file-system";
import { VoiceRecorder } from "voice-recorder";
import {
  AppState,
  AppStateStatus,
  NativeEventSubscription,
  PermissionsAndroid,
  Platform,
} from "react-native";
import {
  getEntryAudioPath,
  getEntryAudioTempPath,
  normalizeMetering,
} from "../../utils/paths";
import {
  ensureAudioDirectoryExists,
  persistAudioFile,
} from "../../utils/audioPersistence";
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

interface ActiveRecordingContext {
  entryId: string;
  timestamp: number;
  tempFilePath: string;
  destinationUri: string;
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
  private activeContext: ActiveRecordingContext | null = null;
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
    // If a previous recording is active or in-flight, cancel/finalize it to avoid state races
    if (this.activeRecorder) {
      try {
        await this.cancelRecording();
      } catch {
        // Non-fatal
      }
    }

    // Ensure any active playback is halted to avoid feedback/conflicts
    try {
      await audioPlaybackService.stop();
    } catch {
      // Ignore
    }

    const timestamp = Date.now();
    const destinationUri = getEntryAudioPath(entryId, timestamp);
    // Write directly into the persistent sandboxed audio directory using a unique temp name.
    // This avoids volatile OS cache purges and enables instant zero-copy atomic renames on stop.
    const tempFilePath = getEntryAudioTempPath(entryId, timestamp);

    this.activeContext = {
      entryId,
      timestamp,
      tempFilePath,
      destinationUri,
    };

    this.currentEntryId = entryId;
    this.currentTimestamp = timestamp;
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

    // Ensure target sandboxed directory exists before recording starts
    await ensureAudioDirectoryExists(tempFilePath);

    if (Platform.OS === "android" && VoiceRecorder.isAvailable()) {
      try {
        const recorder = this.createVoiceRecorderAdapter(tempFilePath);
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
        recorder.record?.();
      } catch (err) {
        console.warn("Could not start VoiceRecorder on Android:", err);
      }
    } else {
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

    const ctx = this.activeContext;
    const finalDurationSec = Math.floor(this.durationMillis / 1000);
    const recordedTempUri =
      url ||
      ctx?.tempFilePath ||
      this.activeRecorder?.uri ||
      this.activeRecorder?.getURI?.() ||
      null;

    const entryId = ctx?.entryId || this.currentEntryId || generateUUID();
    const destinationUri =
      ctx?.destinationUri ||
      getEntryAudioPath(
        entryId,
        ctx?.timestamp || this.currentTimestamp || Date.now(),
      );

    this.activeContext = null;

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

    let finalUri = "";
    if (recordedTempUri) {
      try {
        const persistResult = await persistAudioFile(
          recordedTempUri,
          destinationUri,
        );
        finalUri = persistResult.uri;
      } catch (persistErr) {
        console.error(
          "Failed to persist recorded audio on external stop:",
          persistErr,
        );
      }
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
        localUri: finalUri,
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
        if (this.activeRecorder.resume) {
          await this.activeRecorder.resume();
        } else if (this.activeRecorder.record) {
          await this.activeRecorder.record();
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

    const ctx = this.activeContext;
    const entryId = ctx?.entryId || this.currentEntryId || generateUUID();
    const destinationUri =
      ctx?.destinationUri ||
      getEntryAudioPath(
        entryId,
        ctx?.timestamp || this.currentTimestamp || Date.now(),
      );

    let recordedTempUri: string | null = null;
    if (this.activeRecorder) {
      try {
        if (this.activeRecorder.stop) {
          await this.activeRecorder.stop();
        }
        recordedTempUri =
          this.activeRecorder.uri ||
          this.activeRecorder.getURI?.() ||
          ctx?.tempFilePath ||
          null;
      } catch (err) {
        console.warn("Error stopping audio recorder:", err);
      }
    } else if (ctx?.tempFilePath) {
      recordedTempUri = ctx.tempFilePath;
    }

    this.activeContext = null;

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

    if (!recordedTempUri) {
      this.activeRecorder = null;
      this.statusCallback = null;
      this.currentEntryId = null;
      this.recordedSamples = [];
      throw new Error(
        "Audio recording failed: no recorded audio data was captured. Your device storage may be full.",
      );
    }

    const persistResult = await persistAudioFile(
      recordedTempUri,
      destinationUri,
    );

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
      localUri: persistResult.uri,
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
    const ctx = this.activeContext;
    this.activeContext = null;

    if (this.activeRecorder) {
      try {
        await this.activeRecorder.stop?.();
        const uri =
          this.activeRecorder.uri ||
          this.activeRecorder.getURI?.() ||
          ctx?.tempFilePath;
        if (uri) {
          const tempFile = new File(uri);
          if (tempFile.exists) {
            tempFile.delete();
          }
        }
      } catch {
        // Ignore cancel cleanup errors
      }
    } else if (ctx?.tempFilePath) {
      try {
        const tempFile = new File(ctx.tempFilePath);
        if (tempFile.exists) {
          tempFile.delete();
        }
      } catch {
        // Ignore
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

  private createVoiceRecorderAdapter(
    initialFilePath: string,
  ): AudioRecorderInstance {
    let latestDuration = 0;
    let latestMeteringDb: number | null = null;
    let isCurrentlyPaused = false;
    let isCurrentlyRecording = false;
    let currentUri = initialFilePath;

    return {
      uri: currentUri,
      getURI: () => currentUri,
      prepareToRecordAsync: async () => {},
      record: () => {
        isCurrentlyRecording = true;
        isCurrentlyPaused = false;
        VoiceRecorder.startRecording(initialFilePath).catch((err) => {
          console.warn("Failed to start VoiceRecorder:", err);
        });
      },
      pause: async () => {
        isCurrentlyPaused = true;
        await VoiceRecorder.pauseRecording();
      },
      resume: async () => {
        isCurrentlyPaused = false;
        await VoiceRecorder.resumeRecording();
      },
      stop: async () => {
        isCurrentlyRecording = false;
        const res = await VoiceRecorder.stopRecording();
        if (res.uri) {
          currentUri = res.uri;
        }
      },
      getStatus: () => ({
        isRecording: isCurrentlyRecording && !isCurrentlyPaused,
        isPaused: isCurrentlyPaused,
        durationMillis: latestDuration,
        metering: latestMeteringDb !== null ? latestMeteringDb : undefined,
      }),
      addListener: (_eventName, listener) => {
        const sub = VoiceRecorder.addListener((update) => {
          if (typeof update.durationMillis === "number") {
            latestDuration = update.durationMillis;
          }
          if (typeof update.meteringLevel === "number") {
            latestMeteringDb =
              update.meteringLevel > 0
                ? Math.max(
                    -60,
                    Math.min(0, 20 * Math.log10(update.meteringLevel)),
                  )
                : -60;
          }
          if (update.isPaused !== undefined) {
            isCurrentlyPaused = update.isPaused;
          }
          if (update.isRecording !== undefined) {
            isCurrentlyRecording = update.isRecording;
          }

          listener({
            isFinished: update.isFinished,
            isPaused: update.isPaused,
            url: update.uri || currentUri,
            error: update.error,
          });
        });
        return sub;
      },
    };
  }
}

export const audioRecordingService = new AudioRecordingService();
