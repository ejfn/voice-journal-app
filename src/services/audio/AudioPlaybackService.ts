import { createAudioPlayer } from "expo-audio";
import { entriesDao } from "../../db/dao/entriesDao";

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

    // Check if entry is missing waveform data
    try {
      const existing = await entriesDao.getEntryById(entryId);
      if (!existing?.waveform_data || existing.waveform_data.length === 0) {
        this.hasMissingWaveform = true;
        this.playbackWaveformBars = new Array(75).fill(0.2);
      } else {
        this.playbackWaveformBars = [...existing.waveform_data];
      }
    } catch {
      this.playbackWaveformBars = null;
    }

    try {
      if (typeof createAudioPlayer === "function") {
        const player = createAudioPlayer({ uri: audioUri });
        this.activePlayer = player as unknown as AudioPlayerInstance;

        // If waveform is missing and audio sampling is supported, enable sampling
        if (
          this.hasMissingWaveform &&
          this.activePlayer.isAudioSamplingSupported
        ) {
          try {
            this.activePlayer.setAudioSamplingEnabled?.(true);
            if (this.activePlayer.addListener) {
              this.sampleSubscription = this.activePlayer.addListener(
                "audioSampleUpdate",
                (data: unknown) => {
                  const sample = data as AudioSampleData;
                  if (
                    !sample ||
                    !sample.channels ||
                    !this.playbackWaveformBars
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
                  // Scale normalized RMS (0.0 to 1.0) with vocal gain
                  const amplitude = Math.max(0.08, Math.min(1.0, rms * 2.8));

                  // Map sample timestamp to corresponding bar index (0 to 74)
                  const dur =
                    this.durationSec > 0
                      ? this.durationSec
                      : initialDurationSec || 1;
                  const targetIdx = Math.floor((sample.timestamp / dur) * 75);
                  if (targetIdx >= 0 && targetIdx < 75) {
                    // Update bar if higher than existing or if still at default baseline
                    const currentVal = this.playbackWaveformBars[targetIdx];
                    if (currentVal === 0.2 || amplitude > currentVal) {
                      this.playbackWaveformBars[targetIdx] = Number(
                        amplitude.toFixed(2),
                      );
                      this.isDirtyWaveform = true;
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
                  status.currentTime >= status.duration)
              ) {
                this.stop();
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
        // If native player stopped or reached duration
        if (
          (this.durationSec > 0 && this.currentTimeSec >= this.durationSec) ||
          (!this.activePlayer.playing &&
            this.currentTimeSec > 0 &&
            this.currentTimeSec >= this.durationSec - 0.5)
        ) {
          this.stop();
          return;
        }
      } else {
        this.currentTimeSec += 0.25;
        if (this.durationSec > 0 && this.currentTimeSec >= this.durationSec) {
          this.stop();
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
      this.isDirtyWaveform &&
      this.currentEntryId &&
      this.playbackWaveformBars &&
      this.playbackWaveformBars.length === 75
    ) {
      try {
        await entriesDao.updateWaveform(
          this.currentEntryId,
          this.playbackWaveformBars,
        );
        this.isDirtyWaveform = false;
      } catch (err) {
        console.warn("Could not save regenerated waveform to database:", err);
      }
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
    this.stopProgressTracker();
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
    this.activePlayer = null;
    this.currentEntryId = null;
    this.currentTimeSec = 0;
    this.playbackWaveformBars = null;
    this.hasMissingWaveform = false;
    this.isDirtyWaveform = false;
    this.notify();
  }
}

export const audioPlaybackService = new AudioPlaybackService();
