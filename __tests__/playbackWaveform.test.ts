import { audioPlaybackService } from "../src/services/audio/AudioPlaybackService";
import { entriesDao } from "../src/db/dao/entriesDao";
import { createAudioPlayer } from "expo-audio";
import { WAVEFORM_BAR_COUNT } from "../src/utils/waveform";

jest.mock("../src/db/dao/entriesDao", () => ({
  entriesDao: {
    getEntryById: jest.fn(),
    updateWaveform: jest.fn(),
  },
}));

describe("AudioPlaybackService Smart Waveform Generation", () => {
  let mockPlayer: {
    play: jest.Mock;
    pause: jest.Mock;
    seekTo: jest.Mock;
    remove: jest.Mock;
    addListener: jest.Mock;
    setAudioSamplingEnabled: jest.Mock;
    currentTime: number;
    duration: number;
    playing: boolean;
    isAudioSamplingSupported: boolean;
  };
  let sampleListener: ((data: unknown) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    sampleListener = null;

    mockPlayer = {
      play: jest.fn(),
      pause: jest.fn(),
      seekTo: jest.fn(),
      remove: jest.fn(),
      addListener: jest.fn(
        (event: string, callback: (data: unknown) => void) => {
          if (event === "audioSampleUpdate") {
            sampleListener = callback;
          }
          return { remove: jest.fn() };
        },
      ),
      setAudioSamplingEnabled: jest.fn(),
      currentTime: 0,
      duration: 10,
      playing: true,
      isAudioSamplingSupported: true,
    };

    (createAudioPlayer as jest.Mock).mockReturnValue(mockPlayer);
  });

  afterEach(async () => {
    await audioPlaybackService.stop();
  });

  it("initializes missing waveform with 75 baseline 0s and enables sampling", async () => {
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-1",
      waveform_data: null,
      duration_sec: 10,
    });

    await audioPlaybackService.play("entry-1", "file:///test.m4a", 10);

    expect(mockPlayer.setAudioSamplingEnabled).toHaveBeenCalledWith(true);
    expect(mockPlayer.addListener).toHaveBeenCalledWith(
      "audioSampleUpdate",
      expect.any(Function),
    );

    const state = audioPlaybackService.getState();
    expect(state.waveformBars).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(state.waveformBars?.every((v) => v === 0)).toBe(true);
  });

  it("recognizes partially generated waveform, keeps populated bars, and samples missing gap", async () => {
    // Waveform where first 20 bars are populated, rest are 0
    const partialWaveform = new Array(WAVEFORM_BAR_COUNT).fill(0);
    for (let i = 0; i < 20; i++) {
      partialWaveform[i] = 0.5;
    }

    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-partial",
      waveform_data: partialWaveform,
      duration_sec: 10,
    });

    await audioPlaybackService.play("entry-partial", "file:///test.m4a", 10);

    expect(mockPlayer.setAudioSamplingEnabled).toHaveBeenCalledWith(true);
    const state = audioPlaybackService.getState();
    expect(state.waveformBars?.[0]).toBe(0.5);
    expect(state.waveformBars?.[19]).toBe(0.5);
    expect(state.waveformBars?.[20]).toBe(0);

    // Simulate sampling at timestamp 5.0s (index ~37)
    expect(sampleListener).toBeTruthy();
    sampleListener!({
      timestamp: 5.0,
      channels: [{ frames: [0.3, 0.4, 0.5] }],
    });

    const updatedState = audioPlaybackService.getState();
    expect(updatedState.waveformBars?.[37]).toBeGreaterThan(0.08);
  });

  it("skips audio sampling and database saving if clip is already fully generated", async () => {
    // Complete authentic waveform with dynamic amplitude values
    const completeWaveform = new Array(WAVEFORM_BAR_COUNT)
      .fill(0)
      .map((_, i) => 0.2 + (i % 10) * 0.05);

    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-complete",
      waveform_data: completeWaveform,
      duration_sec: 10,
    });

    await audioPlaybackService.play("entry-complete", "file:///test.m4a", 10);

    // Audio sampling should NOT be enabled for fully generated clips
    expect(mockPlayer.setAudioSamplingEnabled).not.toHaveBeenCalled();
    expect(mockPlayer.addListener).not.toHaveBeenCalledWith(
      "audioSampleUpdate",
      expect.any(Function),
    );

    // Pause playback: should NOT trigger redundant updateWaveform
    await audioPlaybackService.pause();
    expect(entriesDao.updateWaveform).not.toHaveBeenCalled();

    // Stop playback: should NOT trigger redundant updateWaveform
    await audioPlaybackService.stop();
    expect(entriesDao.updateWaveform).not.toHaveBeenCalled();
  });

  it("detects when waveform becomes completely filled during playback and stops sampling", async () => {
    // WAVEFORM_BAR_COUNT - 1 bars filled, only last index remaining (0)
    const almostDone = new Array(WAVEFORM_BAR_COUNT).fill(0.5);
    almostDone[WAVEFORM_BAR_COUNT - 1] = 0;

    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-almost-done",
      waveform_data: almostDone,
      duration_sec: 10,
    });

    await audioPlaybackService.play(
      "entry-almost-done",
      "file:///test.m4a",
      10,
    );

    expect(mockPlayer.setAudioSamplingEnabled).toHaveBeenCalledWith(true);

    // Now audio samples at timestamp 9.9s (last index)
    expect(sampleListener).toBeTruthy();
    sampleListener!({
      timestamp: 9.9,
      channels: [{ frames: [0.3, 0.3] }],
    });

    // Should immediately persist completed waveform to database
    expect(entriesDao.updateWaveform).toHaveBeenCalledWith(
      "entry-almost-done",
      expect.any(Array),
    );
    expect(mockPlayer.setAudioSamplingEnabled).toHaveBeenCalledWith(false);

    // Subsequent pause should NOT write again
    (entriesDao.updateWaveform as jest.Mock).mockClear();
    await audioPlaybackService.pause();
    expect(entriesDao.updateWaveform).not.toHaveBeenCalled();
  });

  it("jumps gaps when scrubbing/seeking and captures new positions correctly", async () => {
    const emptyWaveform = new Array(WAVEFORM_BAR_COUNT).fill(0);

    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-scrub",
      waveform_data: emptyWaveform,
      duration_sec: 100,
    });

    await audioPlaybackService.play("entry-scrub", "file:///test.m4a", 100);

    // Sample at 0s (bar 0)
    sampleListener!({
      timestamp: 0.5,
      channels: [{ frames: [0.2] }],
    });

    // Scrub / skip forward to 80s (bar 60)
    await audioPlaybackService.seekTo(80);
    sampleListener!({
      timestamp: 80.0,
      channels: [{ frames: [0.4] }],
    });

    const state = audioPlaybackService.getState();
    expect(state.waveformBars?.[0]).toBeGreaterThan(0);
    expect(state.waveformBars?.[30]).toBe(0); // Gap remained untouched (0)
    expect(state.waveformBars?.[60]).toBeGreaterThan(0); // Jumped and captured bar 60

    // Pausing persists partially generated state
    await audioPlaybackService.pause();
    expect(entriesDao.updateWaveform).toHaveBeenCalledWith(
      "entry-scrub",
      state.waveformBars,
    );
  });

  it("does not re-save when playing an already-sampled section of a partially generated clip", async () => {
    // Waveform where bars 0..10 are already sampled (> 0) and rest are 0
    const partialWaveform = new Array(WAVEFORM_BAR_COUNT).fill(0);
    for (let i = 0; i < 10; i++) {
      partialWaveform[i] = 0.6;
    }

    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-replay-partial",
      waveform_data: partialWaveform,
      duration_sec: 10,
    });

    await audioPlaybackService.play(
      "entry-replay-partial",
      "file:///test.m4a",
      10,
    );

    // Audio plays across bar 2 (already sampled with 0.6)
    sampleListener!({
      timestamp: 0.27, // maps to bar 2
      channels: [{ frames: [0.7] }],
    });

    // Pause playback: because bar 2 already existed in the DB, it was not marked dirty
    (entriesDao.updateWaveform as jest.Mock).mockClear();
    await audioPlaybackService.pause();
    expect(entriesDao.updateWaveform).not.toHaveBeenCalled();

    // Stop playback: still no write
    await audioPlaybackService.stop();
    expect(entriesDao.updateWaveform).not.toHaveBeenCalled();
  });

  it("normalizes Android milliseconds timestamps to bar indices correctly", async () => {
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-android-ts",
      waveform_data: null,
      duration_sec: 10,
    });

    await audioPlaybackService.play("entry-android-ts", "file:///test.m4a", 10);

    // Android ExoPlayer emits timestamp in milliseconds (5000 ms for 5.0s)
    sampleListener!({
      timestamp: 5000,
      channels: [{ frames: [0.5, 0.6] }],
    });

    const state = audioPlaybackService.getState();
    // 5.0s / 10s * 75 = bar 37
    expect(state.waveformBars?.[37]).toBeGreaterThan(0.08);
  });

  it("normalizes iOS 0.0 timestamp by falling back to activePlayer.currentTime", async () => {
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-ios-ts",
      waveform_data: null,
      duration_sec: 10,
    });

    await audioPlaybackService.play("entry-ios-ts", "file:///test.m4a", 10);
    mockPlayer.currentTime = 4.0; // 4.0s / 10s * 75 = bar 30

    // iOS AudioTapProcessor emits 0.0 timestamp
    sampleListener!({
      timestamp: 0.0,
      channels: [{ frames: [0.4, 0.5] }],
    });

    const state = audioPlaybackService.getState();
    expect(state.waveformBars?.[30]).toBeGreaterThan(0.08);
  });

  it("persists authentic sampled bars without corrupting gaps with synthetic data", async () => {
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-completion",
      waveform_data: null,
      duration_sec: 5,
    });

    const notifiedStates: unknown[] = [];
    const unsubscribe = audioPlaybackService.addListener((s) => {
      notifiedStates.push(s);
    });

    await audioPlaybackService.play("entry-completion", "file:///test.m4a", 5);

    // Simulate native sampling emitted 1 sample at 1.0s (bar 15)
    sampleListener!({
      timestamp: 1.0,
      channels: [{ frames: [0.5] }],
    });

    await audioPlaybackService.stop();
    unsubscribe();

    // Verify sampled bar is populated, while un-sampled gaps remain 0 (half state)
    expect(entriesDao.updateWaveform).toHaveBeenCalledWith(
      "entry-completion",
      expect.any(Array),
    );
    const savedBars = (entriesDao.updateWaveform as jest.Mock).mock.calls[0][1];
    expect(savedBars).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(savedBars[15]).toBeGreaterThan(0.08);
    expect(savedBars[0]).toBe(0); // Un-sampled gap preserved as 0 (not synthetic)

    // Verify stop notification delivered bars and entryId
    const lastState = notifiedStates[notifiedStates.length - 1] as {
      isPlaying: boolean;
      entryId: string;
      waveformBars: number[];
    };
    expect(lastState.isPlaying).toBe(false);
    expect(lastState.entryId).toBe("entry-completion");
    expect(lastState.waveformBars).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(lastState.waveformBars[15]).toBeGreaterThan(0.08);
  });

  it("serializes concurrent stop calls with the same in-flight promise", async () => {
    (entriesDao.getEntryById as jest.Mock).mockResolvedValue({
      id: "entry-concurrent",
      waveform_data: null,
      duration_sec: 10,
    });

    await audioPlaybackService.play("entry-concurrent", "file:///test.m4a", 10);

    const stop1 = audioPlaybackService.stop();
    const stop2 = audioPlaybackService.stop();

    await Promise.all([stop1, stop2]);

    expect(mockPlayer.remove).toHaveBeenCalledTimes(1);
  });
});
