import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import { RecordingModal } from "../src/components/RecordingModal";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { MIN_RECORDING_DURATION_SEC } from "../src/services/audio/AudioRecordingService";

describe("RecordingModal", () => {
  const findCancelButtons = (tree: ReactTestRenderer) =>
    tree.root.findAllByProps({ testID: "discard-recording-button" });

  const renderModal = (durationSec: number, onCancel = jest.fn()) =>
    renderer.create(
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
});
