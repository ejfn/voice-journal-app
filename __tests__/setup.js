/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */

// Prevent expo-sqlite from trying to load native module directly in Jest
jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(),
  openDatabaseAsync: jest.fn(),
}));

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn(),
    currentTime: 0,
    duration: 0,
    playing: false,
    isAudioSamplingSupported: false,
    setAudioSamplingEnabled: jest.fn(),
  })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({
    granted: true,
    status: "granted",
  })),
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

class MockFile {
  constructor(...uris) {
    const raw = uris
      .map((u) => (u && typeof u === "object" && u.uri ? u.uri : String(u)))
      .join("/")
      .replace(/\/+/g, "/");
    this.uri = raw.startsWith("file:/")
      ? raw
      : `file:///${raw.replace(/^\/+/, "")}`;
    this.exists =
      MockFile.defaultExists !== undefined ? MockFile.defaultExists : true;
    this.size =
      MockFile.defaultSize !== undefined ? MockFile.defaultSize : 1024;
  }
  async base64() {
    return "mock_base64_data";
  }
  async copy(destination) {
    MockFile.mockCopy(this, destination);
    return Promise.resolve();
  }
  delete() {
    MockFile.mockDelete(this.uri);
  }
  async upload(url, options) {
    return MockFile.mockUpload(url, options);
  }
  static async downloadFileAsync(url, destination, options) {
    return MockFile.mockDownload(url, destination, options);
  }
}

MockFile.mockCopy = jest.fn();
MockFile.mockDelete = jest.fn();
MockFile.mockUpload = jest.fn(async () => ({
  status: 200,
  body: "",
  headers: {},
}));
MockFile.mockDownload = jest.fn(
  async (_url, destination) => new MockFile(destination),
);
MockFile.defaultExists = true;
MockFile.defaultSize = 1024;

class MockDirectory {
  constructor(...uris) {
    const raw = uris
      .map((u) => (u && typeof u === "object" && u.uri ? u.uri : String(u)))
      .join("/")
      .replace(/\/+/g, "/");
    const formatted = raw.startsWith("file:/")
      ? raw
      : `file:///${raw.replace(/^\/+/, "")}`;
    this.uri = formatted.endsWith("/") ? formatted : `${formatted}/`;
    this.exists = true;
  }
  create(options) {
    MockDirectory.mockCreate(this.uri, options);
  }
  delete() {
    MockDirectory.mockDelete(this.uri);
  }
}
MockDirectory.mockCreate = jest.fn();
MockDirectory.mockDelete = jest.fn();

const mockFileSystem = {
  File: MockFile,
  Directory: MockDirectory,
  Paths: {
    document: new MockDirectory("file:///mock/document/"),
    cache: new MockDirectory("file:///mock/cache/"),
  },
  UploadType: {
    BINARY_CONTENT: 0,
    MULTIPART: 1,
  },
};

jest.mock("expo-file-system", () => mockFileSystem);

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ data: { idToken: "mock-token" } })),
    getTokens: jest.fn(async () => ({ accessToken: "mock-access-token" })),
    signOut: jest.fn(async () => {}),
  },
}));

jest.mock("@react-native-vector-icons/material-icons", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const MockIcon = (props) => React.createElement(Text, props, props.name);
  return {
    __esModule: true,
    default: MockIcon,
    MaterialIcons: MockIcon,
  };
});
