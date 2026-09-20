import { createAudioPlayer } from "expo-audio";

export interface PlaybackState {
  isPlaying: boolean;
  currentTimeSec: number;
  durationSec: number;
  entryId: string | null;
}

export type PlaybackListener = (state: PlaybackState) => void;

interface AudioPlayerStatusUpdate {
  didJustFinish?: boolean;
  playing?: boolean;
  duration?: number;
  currentTime?: number;
}

interface AudioPlayerInstance {
  playing?: boolean;
  currentTime?: number;
  duration?: number;
  play?: () => void;
  pause?: () => void;
  seekTo?: (seconds: number) => Promise<void> | void;
  remove?: () => void;
  addListener?: (
    event: string,
    listener: (status: AudioPlayerStatusUpdate) => void,
  ) => { remove: () => void };
}

class AudioPlaybackService {
  private activePlayer: AudioPlayerInstance | null = null;
  private playerSubscription: { remove: () => void } | null = null;
  private currentEntryId: string | null = null;
  private listeners: Set<PlaybackListener> = new Set();
  private progressInterval: NodeJS.Timeout | null = null;
  private currentTimeSec: number = 0;
  private durationSec: number = 0;

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

    try {
      if (typeof createAudioPlayer === "function") {
        const player = createAudioPlayer({ uri: audioUri });
        this.activePlayer = player as unknown as AudioPlayerInstance;
        if (this.activePlayer?.addListener) {
          this.playerSubscription = this.activePlayer.addListener(
            "playbackStatusUpdate",
            (status: AudioPlayerStatusUpdate) => {
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
        this.currentTimeSec = Math.round(this.activePlayer.currentTime);
        if (this.activePlayer.duration) {
          this.durationSec = Math.round(this.activePlayer.duration);
        }
        // If native player stopped or reached duration
        if (
          (this.durationSec > 0 && this.currentTimeSec >= this.durationSec) ||
          (!this.activePlayer.playing &&
            this.currentTimeSec > 0 &&
            this.currentTimeSec >= this.durationSec - 1)
        ) {
          this.stop();
          return;
        }
      } else {
        this.currentTimeSec += 1;
        if (this.durationSec > 0 && this.currentTimeSec >= this.durationSec) {
          this.stop();
          return;
        }
      }
      this.notify();
    }, 1000);
  }

  private stopProgressTracker() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  async pause(): Promise<void> {
    this.stopProgressTracker();
    if (this.activePlayer?.pause) {
      this.activePlayer.pause();
    }
    this.notify();
  }

  async seekTo(seconds: number): Promise<void> {
    this.currentTimeSec = seconds;
    if (this.activePlayer?.seekTo) {
      await this.activePlayer.seekTo(seconds);
    }
    this.notify();
  }

  async stop(): Promise<void> {
    this.stopProgressTracker();
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
    this.notify();
  }
}

export const audioPlaybackService = new AudioPlaybackService();
