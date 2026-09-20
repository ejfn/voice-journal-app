import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import { PlaybackVisualizer } from "../src/components/PlaybackVisualizer";
import { ThemeProvider } from "../src/theme/ThemeContext";

interface TestNode {
  props: Record<string, unknown>;
}

describe("PlaybackVisualizer", () => {
  const renderVisualizer = (
    props: Partial<React.ComponentProps<typeof PlaybackVisualizer>> = {},
  ) => {
    const defaultProps = {
      entryId: "entry-123",
      isPlaying: false,
      currentTimeSec: 3,
      durationSec: 10,
      isDownloading: false,
      onPlayPause: jest.fn(),
      onSeek: jest.fn(),
      onSkip: jest.fn(),
      ...props,
    };

    let tree: ReactTestRenderer;
    void act(() => {
      tree = renderer.create(
        <ThemeProvider>
          <PlaybackVisualizer {...defaultProps} />
        </ThemeProvider>,
      );
    });

    return { tree: tree!, props: defaultProps };
  };

  it("renders center-needle waveform scrubber, timeline track, and dual timestamps", () => {
    const { tree } = renderVisualizer({
      currentTimeSec: 3,
      durationSec: 10,
    });

    // Elapsed timestamp: 00:03
    const elapsedNodes = tree.root.findAllByProps({
      testID: "playback-elapsed-time",
    }) as TestNode[];
    expect(elapsedNodes.length).toBeGreaterThan(0);
    expect(elapsedNodes[0].props.children).toBe("00:03");

    // Negative countdown timestamp: -(10 - 3) = -00:07
    const remainingNodes = tree.root.findAllByProps({
      testID: "playback-remaining-time",
    }) as TestNode[];
    expect(remainingNodes.length).toBeGreaterThan(0);
    expect(remainingNodes[0].props.children).toBe("-00:07");

    // Timeline track
    const trackNodes = tree.root.findAllByProps({
      testID: "playback-timeline-track",
    }) as TestNode[];
    expect(trackNodes.length).toBeGreaterThan(0);
  });

  it("triggers onSkip(-10) when 10-second rewind button is pressed", () => {
    const onSkip = jest.fn();
    const { tree } = renderVisualizer({ onSkip });

    const rewindNodes = tree.root.findAllByProps({
      testID: "playback-rewind-10",
    }) as TestNode[];
    expect(rewindNodes.length).toBeGreaterThan(0);

    void act(() => {
      (rewindNodes[0].props.onPress as () => void)();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith(-10);
  });

  it("triggers onSkip(10) when 10-second forward button is pressed", () => {
    const onSkip = jest.fn();
    const { tree } = renderVisualizer({ onSkip });

    const forwardNodes = tree.root.findAllByProps({
      testID: "playback-forward-10",
    }) as TestNode[];
    expect(forwardNodes.length).toBeGreaterThan(0);

    void act(() => {
      (forwardNodes[0].props.onPress as () => void)();
    });

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith(10);
  });

  it("triggers onPlayPause when primary play/pause button is pressed", () => {
    const onPlayPause = jest.fn();
    const { tree } = renderVisualizer({
      isPlaying: false,
      onPlayPause,
    });

    const playPauseNodes = tree.root.findAllByProps({
      testID: "playback-play-pause",
    }) as TestNode[];
    expect(playPauseNodes.length).toBeGreaterThan(0);

    void act(() => {
      (playPauseNodes[0].props.onPress as () => void)();
    });

    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it("seeks when timeline track is pressed", () => {
    const onSeek = jest.fn();
    const { tree } = renderVisualizer({
      durationSec: 100,
      onSeek,
    });

    const trackNodes = tree.root.findAllByProps({
      testID: "playback-timeline-track",
    }) as TestNode[];
    expect(trackNodes.length).toBeGreaterThan(0);

    void act(() => {
      (
        trackNodes[0].props.onPress as (event: {
          nativeEvent: { locationX: number };
        }) => void
      )({
        nativeEvent: { locationX: 150 },
      });
    });

    // 150 / default 300 trackWidth = 50% of 100s = 50s
    expect(onSeek).toHaveBeenCalledWith(50);
  });

  it("renders with custom recorded waveformData when provided", () => {
    const customWave = [0.2, 0.4, 0.6, 0.8, 1.0];
    const { tree } = renderVisualizer({
      waveformData: customWave,
    });
    expect(tree.root).toBeTruthy();
  });
});
