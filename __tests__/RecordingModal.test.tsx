import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import { RecordingModal } from "../src/components/RecordingModal";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { MIN_RECORDING_DURATION_SEC } from "../src/services/audio/AudioRecordingService";

describe("RecordingModal", () => {
  let trees: ReactTestRenderer[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    trees.forEach((t) => {
      try {
        t.unmount();
      } catch {}
    });
    trees = [];
  });

  const findCancelButtons = (tree: ReactTestRenderer) =>
    tree.root.findAllByProps({ testID: "discard-recording-button" });

  const renderModal = (durationSec: number, onCancel = jest.fn()) => {
    const tr = renderer.create(
      <ThemeProvider>
        <RecordingModal
          visible
          durationSec={durationSec}
          meteringLevel={0.5}
          isPaused={false}
          isProcessing={false}
          onPause={jest.fn()}
          onResume={jest.fn()}
          onStop={jest.fn()}
          onCancel={onCancel}
        />
      </ThemeProvider>,
    );
    trees.push(tr);
    return tr;
  };

  const findModalCloseHandlers = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) => typeof node.props.onRequestClose === "function",
    );

  it("shows the cancel button before the minimum recording duration is reached", () => {
    let tree: ReactTestRenderer;

    void act(() => {
      tree = renderModal(MIN_RECORDING_DURATION_SEC - 1);
    });

    expect(findCancelButtons(tree!).length).toBeGreaterThan(0);
  });

  it("hides the cancel button once the minimum recording duration is reached", () => {
    let tree: ReactTestRenderer;

    void act(() => {
      tree = renderModal(MIN_RECORDING_DURATION_SEC);
    });

    expect(findCancelButtons(tree!)).toHaveLength(0);
  });

  it("only allows modal close requests before the minimum recording duration is reached", () => {
    const beforeThresholdCancel = jest.fn();
    const validRecordingCancel = jest.fn();
    let beforeThresholdTree: ReactTestRenderer;
    let validRecordingTree: ReactTestRenderer;

    void act(() => {
      beforeThresholdTree = renderModal(
        MIN_RECORDING_DURATION_SEC - 1,
        beforeThresholdCancel,
      );
      validRecordingTree = renderModal(
        MIN_RECORDING_DURATION_SEC,
        validRecordingCancel,
      );
    });

    const beforeThresholdCloseHandler = findModalCloseHandlers(
      beforeThresholdTree!,
    )[0].props.onRequestClose as () => void;
    const validRecordingCloseHandler = findModalCloseHandlers(
      validRecordingTree!,
    )[0].props.onRequestClose as () => void;

    void act(() => {
      beforeThresholdCloseHandler();
      validRecordingCloseHandler();
    });

    expect(beforeThresholdCancel).toHaveBeenCalledTimes(1);
    expect(validRecordingCancel).not.toHaveBeenCalled();
  });

  it("uses MIN_RECORDING_DURATION_SEC for status hint text and stop-button opacity styling", () => {
    let tree: ReactTestRenderer;

    void act(() => {
      tree = renderer.create(
        <ThemeProvider>
          <RecordingModal
            visible
            durationSec={MIN_RECORDING_DURATION_SEC - 1}
            meteringLevel={0.5}
            isPaused={false}
            isProcessing={false}
            onPause={jest.fn()}
            onResume={jest.fn()}
            onStop={jest.fn()}
            onCancel={jest.fn()}
          />
        </ThemeProvider>,
      );
      trees.push(tree);
    });

    // Check status hint when active and duration < min duration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = tree!.root as any;
    const texts = root.findAllByType("Text");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusTextBefore = texts.find((t: any) =>
      String(t.props.children).includes("Speak naturally. Minimum"),
    );
    expect(statusTextBefore).toBeDefined();
    expect(statusTextBefore!.props.children).toContain(
      `${MIN_RECORDING_DURATION_SEC} seconds to save.`,
    );

    // Check stop-button opacity < 1 before threshold
    const stopButtons = root.findAllByProps({
      accessibilityLabel: "Stop and save recording",
    });
    expect(stopButtons.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stopButtonStyle = (stopButtons[0] as any).props.style;
    // Flatten array of styles if it's an array
    const flattenedStopStyle = Array.isArray(stopButtonStyle)
      ? Object.assign({}, ...stopButtonStyle)
      : stopButtonStyle;
    expect(flattenedStopStyle.opacity).toBe(0.45);

    // Check status hint when paused and duration < min duration
    let pausedTree: ReactTestRenderer;
    void act(() => {
      pausedTree = renderer.create(
        <ThemeProvider>
          <RecordingModal
            visible
            durationSec={MIN_RECORDING_DURATION_SEC - 1}
            meteringLevel={0.5}
            isPaused={true}
            isProcessing={false}
            onPause={jest.fn()}
            onResume={jest.fn()}
            onStop={jest.fn()}
            onCancel={jest.fn()}
          />
        </ThemeProvider>,
      );
      trees.push(pausedTree);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pausedRoot = pausedTree!.root as any;
    const pausedTexts = pausedRoot.findAllByType("Text");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pausedStatusText = pausedTexts.find((t: any) =>
      String(t.props.children).includes("Recording paused"),
    );
    expect(pausedStatusText).toBeDefined();
    expect(pausedStatusText!.props.children).toContain(
      `< ${MIN_RECORDING_DURATION_SEC}s`,
    );
  });
});
