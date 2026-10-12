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

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

function normalizeMockUri(raw) {
  if (!raw) return "";
  const str = typeof raw === "object" && raw.uri ? raw.uri : String(raw);
  const withoutScheme = str
    .replace(/^file:\/*/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  return `file:///${withoutScheme}`;
}

class MockFile {
  constructor(...uris) {
    const raw = uris
      .map((u) => (u && typeof u === "object" && u.uri ? u.uri : String(u)))
      .join("/");
    this.uri = normalizeMockUri(raw);
    if (MockFile.existingFiles instanceof Set) {
      this.exists = MockFile.existingFiles.has(this.uri);
    } else {
      this.exists =
        MockFile.defaultExists !== undefined ? MockFile.defaultExists : true;
    }
    if (MockFile.fileSizes instanceof Map && MockFile.fileSizes.has(this.uri)) {
      this.size = MockFile.fileSizes.get(this.uri);
    } else {
      this.size =
        MockFile.defaultSize !== undefined ? MockFile.defaultSize : 1024;
    }
  }
  async base64() {
    return "mock_base64_data";
  }
  async copy(destination) {
    MockFile.mockCopy(this, destination);
    const destUri = normalizeMockUri(destination);
    if (MockFile.existingFiles instanceof Set) {
      MockFile.existingFiles.add(destUri);
    }
    if (MockFile.fileSizes instanceof Map) {
      const srcSize =
        MockFile.fileSizes.get(this.uri) !== undefined
          ? MockFile.fileSizes.get(this.uri)
          : MockFile.defaultSize;
      MockFile.fileSizes.set(destUri, srcSize);
    }
    return Promise.resolve();
  }
  async move(destination) {
    MockFile.mockMove(this, destination);
    const destUri = normalizeMockUri(destination);
    if (MockFile.existingFiles instanceof Set) {
      MockFile.existingFiles.add(destUri);
      MockFile.existingFiles.delete(this.uri);
    }
    if (MockFile.fileSizes instanceof Map) {
      const srcSize =
        MockFile.fileSizes.get(this.uri) !== undefined
          ? MockFile.fileSizes.get(this.uri)
          : MockFile.defaultSize;
      MockFile.fileSizes.set(destUri, srcSize);
      MockFile.fileSizes.delete(this.uri);
    }
    return Promise.resolve();
  }
  delete() {
    MockFile.mockDelete(this.uri);
    if (MockFile.existingFiles instanceof Set) {
      MockFile.existingFiles.delete(this.uri);
    }
    if (MockFile.fileSizes instanceof Map) {
      MockFile.fileSizes.delete(this.uri);
    }
  }
  async upload(url, options) {
    return MockFile.mockUpload(url, options);
  }
  static async downloadFileAsync(url, destination, options) {
    return MockFile.mockDownload(url, destination, options);
  }
}

MockFile.mockCopy = jest.fn();
MockFile.mockMove = jest.fn();
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
MockFile.existingFiles = null;
MockFile.fileSizes = null;

class MockDirectory {
  constructor(...uris) {
    const raw = uris
      .map((u) => (u && typeof u === "object" && u.uri ? u.uri : String(u)))
      .join("/");
    const formatted = normalizeMockUri(raw);
    this.uri = formatted.endsWith("/") ? formatted : `${formatted}/`;
    this.exists = true;
  }
  create(options) {
    MockDirectory.mockCreate(this.uri, options);
  }
  delete() {
    MockDirectory.mockDelete(this.uri);
  }
  list() {
    if (typeof MockDirectory.mockList === "function") {
      return MockDirectory.mockList(this.uri);
    }
    return [];
  }
}
MockDirectory.mockCreate = jest.fn();
MockDirectory.mockDelete = jest.fn();
MockDirectory.mockList = jest.fn(() => []);

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

const mockDeviceInfo = require("react-native-device-info/jest/react-native-device-info-mock.js");
const { NativeModules } = require("react-native");
NativeModules.RNDeviceInfo = mockDeviceInfo;

jest.mock("react-native-device-info", () => mockDeviceInfo);
