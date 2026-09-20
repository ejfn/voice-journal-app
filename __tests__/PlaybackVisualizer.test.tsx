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

  describe("computed waveform bar heights", () => {
    const getAudioBarHeights = (
      tree: ReactTestRenderer,
      audioBarCount: number,
    ): number[] => {
      const stripNodes = tree.root.findAll(
        (node: { props: Record<string, unknown> }) =>
          Array.isArray(node.props.style) &&
          (node.props.style as Record<string, unknown>[]).some(
            (item) => item && Array.isArray(item.transform),
          ),
      );
      const stripNode = stripNodes[0];
      const children = stripNode.props.children as {
        props: { style: Record<string, unknown>[] };
      }[];
      const allHeights = children.map((child) => {
        const dynamicStyle = child.props.style.find(
          (item) =>
            item &&
            typeof item.height === "number" &&
            typeof item.backgroundColor === "string",
        );
        return dynamicStyle!.height as number;
      });
      const leadBarsCount = (allHeights.length - audioBarCount) / 2;
      return allHeights.slice(leadBarsCount, leadBarsCount + audioBarCount);
    };

    it("bypasses auto-gain for empty fallback and uniform baseline waveforms", () => {
      // 1. Empty fallback (waveformData undefined)
      const { tree: fallbackTree } = renderVisualizer({
        waveformData: undefined,
      });
      const fallbackHeights = getAudioBarHeights(fallbackTree, 64);
      expect(fallbackHeights.length).toBe(64);
      // Neutral baseline with gain = 1.0: Math.tanh(0.2 * 1.25) * 0.95 * 104 ≈ 24.2px
      // If 3x auto-gain was erroneously applied, height would be ~62.8px
      for (const h of fallbackHeights) {
        expect(h).toBeCloseTo(24.2, 1);
        expect(h).toBeLessThan(30);
      }

      // 2. Uniform baseline (legacy dummy 0.2 bars)
      const uniformBars = [0.2, 0.2, 0.2, 0.2, 0.2];
      const { tree: uniformTree } = renderVisualizer({
        waveformData: uniformBars,
      });
      const uniformHeights = getAudioBarHeights(
        uniformTree,
        uniformBars.length,
      );
      for (const h of uniformHeights) {
        expect(h).toBeCloseTo(24.2, 1);
        expect(h).toBeLessThan(30);
      }

      // 3. Un-sampled zero placeholder bars (effectiveHeight = 0.2 directly: 0.2 * 104 = 20.8px)
      const placeholderBars = [0, 0, 0];
      const { tree: placeholderTree } = renderVisualizer({
        waveformData: placeholderBars,
      });
      const placeholderHeights = getAudioBarHeights(
        placeholderTree,
        placeholderBars.length,
      );
      for (const h of placeholderHeights) {
        expect(h).toBeCloseTo(20.8, 1);
      }
    });

    it("amplifies quiet waveforms via dynamic auto-gain", () => {
      // Quiet recording with max peak = 0.12 (e.g. whisper)
      // Peak is 0.12, dynamicGain = min(3.0, 0.85 / 0.12 = 7.08) = 3.0
      // Amplified peak: 0.12 * 3.0 = 0.36 -> tanh(0.36 * 1.25) * 0.95 * 104 ≈ 41.7px
      // Without auto-gain (gain = 1.0), height would only be ~14.7px
      const quietBars = [0.04, 0.08, 0.12, 0.06];
      const { tree } = renderVisualizer({ waveformData: quietBars });
      const heights = getAudioBarHeights(tree, quietBars.length);

      const peakHeight = heights[2];
      expect(peakHeight).toBeCloseTo(41.7, 1);
      // Verify peak is amplified by more than 2.5x compared to unamplified baseline height (14.7px)
      expect(peakHeight).toBeGreaterThan(35);

      // Near-silence threshold (peak <= 0.05): gain stays 1.0 to avoid boosting background noise
      const nearSilentBars = [0.01, 0.02, 0.03, 0.02];
      const { tree: silentTree } = renderVisualizer({
        waveformData: nearSilentBars,
      });
      const silentHeights = getAudioBarHeights(
        silentTree,
        nearSilentBars.length,
      );
      // clamped to minimum effective height 0.08 * 104 = 8.32px (not amplified)
      expect(silentHeights[2]).toBeCloseTo(8.32, 2);
    });

    it("compresses loud values smoothly below ceiling without hard clipping", () => {
      // Normal/loud audio with peak = 1.0
      // dynamicGain = max(0.85, min(3.0, 0.85 / 1.0)) = 0.85
      const loudBars = [0.3, 0.6, 0.85, 1.0];
      const { tree } = renderVisualizer({ waveformData: loudBars });
      const heights = getAudioBarHeights(tree, loudBars.length);

      // Heights should scale monotonically without clipping to the exact same ceiling
      expect(heights[0]).toBeLessThan(heights[1]);
      expect(heights[1]).toBeLessThan(heights[2]);
      expect(heights[2]).toBeLessThan(heights[3]);

      // Loudest bar (1.0) with soft-knee compression:
      // amplified = 0.85 -> tanh(0.85 * 1.25) * 0.95 * 104 ≈ 77.7px
      // Must stay strictly below container max height (104px)
      expect(heights[3]).toBeCloseTo(77.7, 1);
      expect(heights[3]).toBeLessThan(104);

      // Bar with 0.85:
      // amplified = 0.7225 -> tanh(0.7225 * 1.25) * 0.95 * 104 ≈ 70.9px
      // Difference between 0.85 and 1.0 is preserved (distinct peak shapes, not flat-topped)
      expect(heights[2]).toBeCloseTo(70.9, 1);
      expect(heights[3] - heights[2]).toBeGreaterThan(5);
    });
  });
});
