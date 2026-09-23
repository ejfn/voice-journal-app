import {
  EventEmitter,
  NativeModule,
  requireNativeModule,
} from "expo-modules-core";

export interface VoiceRecorderStatusUpdate {
  isRecording: boolean;
  isPaused: boolean;
  isFinished?: boolean;
  durationMillis?: number;
  meteringLevel?: number;
  uri?: string;
  hasError?: boolean;
  error?: string;
}

export interface VoiceRecorderStatus {
  isRecording: boolean;
  isPaused: boolean;
  durationMillis: number;
}

export interface VoiceRecorderResult {
  uri: string;
  durationMillis: number;
}

type VoiceRecorderEvents = {
  onStatusUpdate: (status: VoiceRecorderStatusUpdate) => void;
};

declare class VoiceRecorderNativeModule extends NativeModule<VoiceRecorderEvents> {
  startRecording(filePath: string): Promise<boolean>;
  pauseRecording(): Promise<boolean>;
  resumeRecording(): Promise<boolean>;
  stopRecording(): Promise<VoiceRecorderResult>;
  getStatus(): VoiceRecorderStatus;
}

let nativeModule: VoiceRecorderNativeModule | null = null;
try {
  nativeModule = requireNativeModule<VoiceRecorderNativeModule>("VoiceRecorder");
} catch {
  // Graceful fallback for non-Android or mock test environments
  nativeModule = null;
}

const emitter = nativeModule
  ? new EventEmitter<VoiceRecorderEvents>(nativeModule)
  : null;

export const VoiceRecorder = {
  isAvailable(): boolean {
    return nativeModule !== null;
  },

  async startRecording(filePath: string): Promise<boolean> {
    if (!nativeModule) return false;
    return nativeModule.startRecording(filePath);
  },

  async pauseRecording(): Promise<boolean> {
    if (!nativeModule) return false;
    return nativeModule.pauseRecording();
  },

  async resumeRecording(): Promise<boolean> {
    if (!nativeModule) return false;
    return nativeModule.resumeRecording();
  },

  async stopRecording(): Promise<VoiceRecorderResult> {
    if (!nativeModule) return { uri: "", durationMillis: 0 };
    return nativeModule.stopRecording();
  },

  getStatus(): VoiceRecorderStatus {
    if (!nativeModule) {
      return { isRecording: false, isPaused: false, durationMillis: 0 };
    }
    return nativeModule.getStatus();
  },

  addListener(
    listener: (status: VoiceRecorderStatusUpdate) => void,
  ): { remove: () => void } {
    if (!emitter) {
      return { remove: () => {} };
    }
    return emitter.addListener("onStatusUpdate", listener);
  },
};
