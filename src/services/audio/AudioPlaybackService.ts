import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { Platform } from "react-native";
import { entriesDao } from "../../db/dao/entriesDao";
import {
  generateDeterministicWaveform,
  getWaveformState,
  WAVEFORM_BAR_COUNT,
} from "../../utils/waveform";

export interface PlaybackState {
  isPlaying: boolean;
  currentTimeSec: number;
  durationSec: number;
  entryId: string | null;
  waveformBars?: number[];
}

export type PlaybackListener = (state: PlaybackState) => void;

interface AudioPlayerStatusUpdate {
  didJustFinish?: boolean;
  playing?: boolean;
  duration?: number;
  currentTime?: number;
}

export interface AudioSampleData {
  channels: { frames: number[] }[];
  timestamp: number;
}

interface AudioPlayerInstance {
  playing?: boolean;
  status?: { isPlaying?: boolean };
  currentStatus?: { playing?: boolean };
  currentTime?: number;
  duration?: number;
  isAudioSamplingSupported?: boolean;
  setAudioSamplingEnabled?: (enabled: boolean) => void;
  play?: () => void;
  pause?: () => void;
  seekTo?: (seconds: number) => Promise<void> | void;
  remove?: () => void;
  addListener?: (
    event: string,
    listener: (data: AudioPlayerStatusUpdate | AudioSampleData) => void,
  ) => { remove: () => void };
}

class AudioPlaybackService {
  private activePlayer: AudioPlayerInstance | null = null;
  private playerSubscription: { remove: () => void } | null = null;
  private sampleSubscription: { remove: () => void } | null = null;
  private currentEntryId: string | null = null;
  private listeners: Set<PlaybackListener> = new Set();
  private progressInterval: NodeJS.Timeout | null = null;
  private currentTimeSec: number = 0;
  private durationSec: number = 0;
  private playbackWaveformBars: number[] | null = null;
  private hasMissingWaveform: boolean = false;
  private isDirtyWaveform: boolean = false;
  private newlySampledIndices: Set<number> = new Set();
  private receivedSampleCount: number = 0;
  private fallbackEnvelope: number[] | null = null;
  private isStopping: boolean = false;
  private isCompleted: boolean = false;

  addListener(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  getState(): PlaybackState {
    const isPlaying = Boolean(
      this.currentEntryId &&
      (this.activePlayer?.playing ||
        (this.progressInterval && !this.activePlayer?.pause)),
    );
    return {
      isPlaying,
      currentTimeSec: this.currentTimeSec,
      durationSec: this.durationSec,
      entryId: this.currentEntryId,
      waveformBars: this.playbackWaveformBars
        ? [...this.playbackWaveformBars]
        : undefined,
    };
  }

  async play(
    entryId: string,
    audioUri: string,
    initialDurationSec?: number,
  ): Promise<void> {
    if (this.currentEntryId === entryId && this.activePlayer) {
      // Resume if same file
      if (this.activePlayer.play) {
        this.activePlayer.play();
      }
      this.startProgressTracker();
      this.notify();
      return;
    }

    // Stop existing playback
    await this.stop();

    this.currentEntryId = entryId;
    this.currentTimeSec = 0;
    this.durationSec = initialDurationSec || 0;
    this.hasMissingWaveform = false;
    this.isDirtyWaveform = false;
    this.newlySampledIndices.clear();
    this.receivedSampleCount = 0;
    this.fallbackEnvelope = null;
    this.isCompleted = false;

    // Check if entry waveform is missing, half, or done:
    // - "missing": null/undefined, wrong length, all 0s, all 0.2, flat uniform, or synthetic fallback envelope
    // - "half": partially sampled (some bars are 0 un-sampled placeholders)
    // - "done": 75 authentic, non-zero, dynamic audio amplitudes
    try {
      const existing = await entriesDao.getEntryById(entryId);
      const raw = existing?.waveform_data;
      const waveformState = getWaveformState(entryId, raw);

      if (waveformState === "missing") {
        this.hasMissingWaveform = true;
        this.playbackWaveformBars = new Array(WAVEFORM_BAR_COUNT).fill(0);
      } else if (waveformState === "half") {
        this.hasMissingWaveform = true;
        this.playbackWaveformBars = [...(raw as number[])];
      } else {
        // Fully generated ("done"): skip audio sampling and skip database saves
        this.hasMissingWaveform = false;
        this.playbackWaveformBars = [...(raw as number[])];
      }
    } catch (err) {
      console.warn("Error reading entry from DB:", err);
      this.playbackWaveformBars = null;
      this.hasMissingWaveform = false;
    }

    // If waveform is missing, ensure recording permissions on Android so setAudioSamplingEnabled doesn't silently fail
    if (this.hasMissingWaveform) {
      try {
        if (typeof requestRecordingPermissionsAsync === "function") {
          await requestRecordingPermissionsAsync();
        }
      } catch (err) {
        console.warn("Permission request failed:", err);
      }
    }

    try {
      if (typeof createAudioPlayer === "function") {
        const player = createAudioPlayer({ uri: audioUri });
        this.activePlayer = player as unknown as AudioPlayerInstance;

        // Only enable audio sampling if this clip has missing/un-sampled waveform bars
        if (
          this.hasMissingWaveform &&
          this.activePlayer.isAudioSamplingSupported !== false &&
          typeof this.activePlayer.setAudioSamplingEnabled === "function"
        ) {
          try {
            this.activePlayer.setAudioSamplingEnabled(true);
            if (this.activePlayer.addListener) {
              this.sampleSubscription = this.activePlayer.addListener(
                "audioSampleUpdate",
                (data: unknown) => {
                  this.receivedSampleCount++;
                  const sample = data as AudioSampleData;
                  if (
                    !sample ||
                    !sample.channels ||
                    !this.playbackWaveformBars ||
                    !this.hasMissingWaveform
                  ) {
                    return;
                  }
                  // Calculate RMS amplitude from incoming audio channels
                  let sumSquares = 0;
                  let frameCount = 0;
                  for (const ch of sample.channels) {
                    if (ch.frames) {
                      for (const frame of ch.frames) {
                        sumSquares += frame * frame;
                        frameCount++;
                      }
                    }
                  }
                  if (frameCount === 0) return;
                  const rms = Math.sqrt(sumSquares / frameCount);
                  // Scale normalized RMS (0.0 to 1.0) with vocal gain (minimum 0.08)
                  const amplitude = Math.max(0.08, Math.min(1.0, rms * 2.8));

                  // Map sample timestamp to corresponding bar index (0 to 74)
                  const dur =
                    this.durationSec > 0
                      ? this.durationSec
                      : initialDurationSec || 1;

                  // Normalize timestamp across platforms:
                  // - Android ExoPlayer returns currentPosition in milliseconds
                  // - iOS AudioTapProcessor hardcodes timestamp to 0.0
                  // - Fall back to player's actual currentTimeSec
                  let sampleTimeSec =
                    this.activePlayer?.currentTime ?? this.currentTimeSec;
                  if (
                    typeof sample.timestamp === "number" &&
                    sample.timestamp > 0
                  ) {
                    if (Platform.OS === "android") {
                      sampleTimeSec = sample.timestamp / 1000;
                    } else if (
                      sample.timestamp > 100 &&
                      sample.timestamp > dur * 1.5
                    ) {
                      sampleTimeSec = sample.timestamp / 1000;
                    } else if (sample.timestamp <= dur) {
                      sampleTimeSec = sample.timestamp;
                    }
                  }

                  const targetIdx = Math.max(
                    0,
                    Math.min(
                      WAVEFORM_BAR_COUNT - 1,
                      Math.floor((sampleTimeSec / dur) * WAVEFORM_BAR_COUNT),
                    ),
                  );

                  if (targetIdx >= 0 && targetIdx < WAVEFORM_BAR_COUNT) {
                    const currentVal = this.playbackWaveformBars[targetIdx];
                    const isUnsampled = currentVal === 0;
                    const isNewlySampled =
                      this.newlySampledIndices.has(targetIdx);

                    // Only update and mark dirty if filling an un-sampled gap or refining peak during this session
                    if (isUnsampled) {
                      this.playbackWaveformBars[targetIdx] = Number(
                        amplitude.toFixed(2),
                      );
                      this.newlySampledIndices.add(targetIdx);
                      this.isDirtyWaveform = true;
                    } else if (isNewlySampled && amplitude > currentVal) {
                      this.playbackWaveformBars[targetIdx] = Number(
                        amplitude.toFixed(2),
                      );
                      this.isDirtyWaveform = true;
                    }

                    // Check if clip has become fully generated (all 75 bars filled with real data)
                    if (
                      isUnsampled &&
                      !this.playbackWaveformBars.some((v) => v === 0)
                    ) {
                      this.hasMissingWaveform = false;
                      if (this.sampleSubscription) {
                        try {
                          this.sampleSubscription.remove();
                        } catch {
                          // Ignore unbind error
                        }
                        this.sampleSubscription = null;
                      }
                      try {
                        this.activePlayer?.setAudioSamplingEnabled?.(false);
                      } catch {
                        // Ignore
                      }
                      // Persist complete waveform to database immediately
                      void this.persistRegeneratedWaveform();
                      this.notify();
                    }
                  }
                },
              );
            }
          } catch {
            // If audio sampling not supported, continue normally
          }
        }

        if (this.activePlayer?.addListener) {
          this.playerSubscription = this.activePlayer.addListener(
            "playbackStatusUpdate",
            (data: unknown) => {
              const status = data as AudioPlayerStatusUpdate;
              if (
                status?.didJustFinish ||
                (!status?.playing &&
                  status?.duration !== undefined &&
                  status.duration > 0 &&
                  status?.currentTime !== undefined &&
                  status.currentTime >= status.duration - 0.5)
              ) {
                this.isCompleted = true;
                void this.stop();
              }
            },
          );
        }
        this.activePlayer?.play?.();
      } else {
        // Fallback for mock environments
        this.activePlayer = {
          playing: true,
          play: () => {},
          pause: () => {},
          seekTo: (_pos: number) => {},
          remove: () => {},
        };
      }
    } catch (err) {
      console.warn("Error creating audio player:", err);
    }

    this.startProgressTracker();
    this.notify();
  }

  private startProgressTracker() {
    this.stopProgressTracker();
    this.progressInterval = setInterval(() => {
      if (this.activePlayer?.currentTime !== undefined) {
        this.currentTimeSec = this.activePlayer.currentTime;
        if (this.activePlayer.duration) {
          this.durationSec = Math.round(this.activePlayer.duration);
        }

        // Progressive waveform fallback:
        // If native audioSampleUpdate is not emitting samples (unsupported device/emulator or permission denied),
        // progressively fill waveform bars along with playback position
        if (
          this.hasMissingWaveform &&
          this.playbackWaveformBars &&
          this.receivedSampleCount === 0 &&
          this.currentTimeSec > 0.3
        ) {
          const dur = this.durationSec > 0 ? this.durationSec : 1;
          const targetIdx = Math.max(
            0,
            Math.min(
              WAVEFORM_BAR_COUNT - 1,
              Math.floor((this.currentTimeSec / dur) * WAVEFORM_BAR_COUNT),
            ),
          );
          if (!this.fallbackEnvelope) {
            this.fallbackEnvelope = generateDeterministicWaveform(
              this.currentEntryId || "fallback",
              WAVEFORM_BAR_COUNT,
            );
          }
          for (let i = 0; i <= targetIdx; i++) {
            if (this.playbackWaveformBars[i] === 0) {
              this.playbackWaveformBars[i] = this.fallbackEnvelope[i] ?? 0.35;
              this.newlySampledIndices.add(i);
              this.isDirtyWaveform = true;
            }
          }
        }

        // If native player stopped or reached duration
        if (
          (this.durationSec > 0 && this.currentTimeSec >= this.durationSec) ||
          (!this.activePlayer.playing &&
            this.currentTimeSec > 0 &&
            this.currentTimeSec >= this.durationSec - 0.5)
        ) {
          this.isCompleted = true;
          void this.stop();
          return;
        }
      } else {
        this.currentTimeSec += 0.25;
        if (this.durationSec > 0 && this.currentTimeSec >= this.durationSec) {
          this.isCompleted = true;
          void this.stop();
          return;
        }
      }
      this.notify();
    }, 250);
  }

  private stopProgressTracker() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  private async persistRegeneratedWaveform(): Promise<void> {
    if (
      !this.isDirtyWaveform ||
      !this.currentEntryId ||
      !this.playbackWaveformBars ||
      this.playbackWaveformBars.length !== WAVEFORM_BAR_COUNT
    ) {
      return;
    }
    this.isDirtyWaveform = false;
    try {
      await entriesDao.updateWaveform(
        this.currentEntryId,
        this.playbackWaveformBars,
      );
    } catch (err) {
      this.isDirtyWaveform = true;
      console.warn("Could not save regenerated waveform to database:", err);
    }
  }

  async pause(): Promise<void> {
    this.stopProgressTracker();
    if (this.activePlayer?.pause) {
      this.activePlayer.pause();
    }
    await this.persistRegeneratedWaveform();
    this.notify();
  }

  async seekTo(seconds: number): Promise<void> {
    const clamped = Math.max(
      0,
      this.durationSec > 0 ? Math.min(this.durationSec, seconds) : seconds,
    );
    this.currentTimeSec = clamped;
    if (this.activePlayer?.seekTo) {
      await this.activePlayer.seekTo(clamped);
    }
    this.notify();
  }

  async skip(offsetSec: number): Promise<void> {
    const target = Math.max(
      0,
      this.durationSec > 0
        ? Math.min(this.durationSec, this.currentTimeSec + offsetSec)
        : Math.max(0, this.currentTimeSec + offsetSec),
    );
    await this.seekTo(target);
  }

  async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
    try {
      this.stopProgressTracker();

      const effectiveCurrentTime =
        typeof this.activePlayer?.currentTime === "number" &&
        this.activePlayer.currentTime > 0
          ? this.activePlayer.currentTime
          : this.currentTimeSec;
      const effectiveDuration =
        typeof this.activePlayer?.duration === "number" &&
        this.activePlayer.duration > 0
          ? this.activePlayer.duration
          : this.durationSec;

      const wasCompleted =
        this.isCompleted ||
        (effectiveDuration > 0 &&
          effectiveCurrentTime >= effectiveDuration - 0.5);

      // If clip had missing waveform and playback completed to the end:
      // ensure any remaining un-sampled bars are filled and persisted
      if (
        this.hasMissingWaveform &&
        this.playbackWaveformBars &&
        this.currentEntryId &&
        (wasCompleted || this.isDirtyWaveform)
      ) {
        if (wasCompleted && this.playbackWaveformBars.some((v) => v === 0)) {
          if (!this.fallbackEnvelope) {
            this.fallbackEnvelope = generateDeterministicWaveform(
              this.currentEntryId,
              WAVEFORM_BAR_COUNT,
            );
          }
          for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
            if (this.playbackWaveformBars[i] === 0) {
              this.playbackWaveformBars[i] = this.fallbackEnvelope[i] ?? 0.35;
              this.newlySampledIndices.add(i);
              this.isDirtyWaveform = true;
            }
          }
        }
      }

      await this.persistRegeneratedWaveform();
      if (this.sampleSubscription) {
        try {
          this.sampleSubscription.remove();
        } catch {
          // Ignore unbind error
        }
        this.sampleSubscription = null;
      }
      if (this.playerSubscription) {
        try {
          this.playerSubscription.remove();
        } catch {
          // Ignore unbind error
        }
        this.playerSubscription = null;
      }
      if (this.activePlayer) {
        try {
          if (this.activePlayer.pause) {
            this.activePlayer.pause();
          }
          if (this.activePlayer.remove) {
            this.activePlayer.remove();
          }
        } catch {
          // Ignore cleanup errors
        }
      }

      const stoppedEntryId = this.currentEntryId;
      const finalWaveform = this.playbackWaveformBars
        ? [...this.playbackWaveformBars]
        : undefined;

      this.activePlayer = null;
      this.currentEntryId = null;
      this.currentTimeSec = 0;
      this.playbackWaveformBars = null;
      this.hasMissingWaveform = false;
      this.isDirtyWaveform = false;
      this.newlySampledIndices.clear();
      this.receivedSampleCount = 0;
      this.fallbackEnvelope = null;
      this.isCompleted = false;

      const state: PlaybackState = {
        isPlaying: false,
        currentTimeSec: 0,
        durationSec: this.durationSec,
        entryId: stoppedEntryId,
        waveformBars: finalWaveform,
      };
      this.listeners.forEach((l) => l(state));
    } finally {
      this.isStopping = false;
    }
  }
}

export const audioPlaybackService = new AudioPlaybackService();
