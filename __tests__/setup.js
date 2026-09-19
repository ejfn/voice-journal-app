/* eslint-disable no-undef */

// Prevent expo-sqlite from trying to load native module directly in Jest
jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(),
  openDatabaseAsync: jest.fn(),
}));

jest.mock("expo-audio", () => ({
  useAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    currentTime: 0,
    duration: 0,
    playing: false,
  })),
  useAudioRecorder: jest.fn(() => ({
    prepareToRecordAsync: jest.fn(),
    record: jest.fn(),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    uri: null,
  })),
  useAudioRecorderState: jest.fn(() => ({
    isRecording: false,
    isPaused: false,
    durationMillis: 0,
  })),
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  },
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: ".m4a",
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
    },
  },
  setAudioModeAsync: jest.fn(async () => {}),
}));

const mockFileSystem = {
  documentDirectory: "file:///mock/document/",
  cacheDirectory: "file:///mock/cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1024 })),
  readAsStringAsync: jest.fn(async () => "mock_base64_data"),
  writeAsStringAsync: jest.fn(async () => {}),
  uploadAsync: jest.fn(async () => ({ status: 200 })),
  downloadAsync: jest.fn(async () => ({ status: 200 })),
  FileSystemUploadType: {
    BINARY_CONTENT: 0,
    MULTIPART: 1,
  },
  EncodingType: {
    Base64: "base64",
    UTF8: "utf8",
  },
  Paths: {
    document: { uri: "file:///mock/document/" },
    cache: { uri: "file:///mock/cache/" },
  },
};

jest.mock("expo-file-system", () => mockFileSystem);
jest.mock("expo-file-system/legacy", () => mockFileSystem);

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ data: { idToken: "mock-token" } })),
    getTokens: jest.fn(async () => ({ accessToken: "mock-access-token" })),
    signOut: jest.fn(async () => {}),
  },
}));
