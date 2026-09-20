import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import { RecordingModal } from "../src/components/RecordingModal";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { MIN_RECORDING_DURATION_SEC } from "../src/services/audio/AudioRecordingService";

describe("RecordingModal", () => {
  const findCancelButtons = (tree: ReactTestRenderer) =>
    tree.root.findAllByProps({ testID: "discard-recording-button" });

  const renderModal = (durationSec: number) =>
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
          onCancel={jest.fn()}
        />
      </ThemeProvider>,
    );

  it("shows the cancel button before the minimum recording duration is reached", () => {
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderModal(MIN_RECORDING_DURATION_SEC - 1);
    });

    expect(findCancelButtons(tree!).length).toBeGreaterThan(0);
  });

  it("hides the cancel button once the minimum recording duration is reached", () => {
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderModal(MIN_RECORDING_DURATION_SEC);
    });

    expect(findCancelButtons(tree!)).toHaveLength(0);
  });
});
