import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import * as ReactNative from "react-native";
import {
  RecordGestureFab,
  HOLD_THRESHOLD_MS,
} from "../src/components/RecordGestureFab";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { lightColors, darkColors } from "../src/theme/colors";

type Handler = (...args: unknown[]) => unknown;

interface TestNode {
  props: {
    testID?: string;
    children?: React.ReactNode;
    accessibilityLabel?: string;
    onResponderGrant?: Handler;
    onResponderMove?: Handler;
    onResponderRelease?: Handler;
    onResponderTerminate?: Handler;
    onStartShouldSetResponder?: () => boolean;
    onAccessibilityAction?: Handler;
    onPress?: Handler;
    [key: string]: unknown;
  };
  parent?: TestNode;
}

describe("RecordGestureFab", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const findByTestId = (tree: ReactTestRenderer, testID: string): TestNode => {
    const nodes = tree.root.findAllByProps({ testID }) as TestNode[];
    if (!nodes.length) {
      throw new Error(`Node with testID "${testID}" not found`);
    }
    return nodes[0];
  };

  const flattenStyles = (style: unknown): Record<string, unknown> => {
    if (!style) return {};
    if (Array.isArray(style)) {
      return style.reduce(
        (acc: Record<string, unknown>, s: unknown) => ({
          ...acc,
          ...flattenStyles(s),
        }),
        {},
      );
    }
    if (typeof style === "object") {
      return style as Record<string, unknown>;
    }
    return {};
  };

  const createSyntheticEvent = (timestamp = 1000) => ({
    nativeEvent: {
      timestamp,
      touches: [],
      changedTouches: [],
      identifier: "1",
      locationX: 34,
      locationY: 34,
      pageX: 100,
      pageY: 500,
      target: "mic-button",
    },
    touchHistory: {
      touchBank: [
        {
          touchActive: true,
          startPageX: 100,
          startPageY: 500,
          startTimeStamp: timestamp,
          currentPageX: 100,
          currentPageY: 500,
          currentTimeStamp: timestamp,
          previousPageX: 100,
          previousPageY: 500,
          previousTimeStamp: timestamp,
        },
      ],
      mostRecentTimeStamp: timestamp,
    },
  });

  const renderComponent = (
    onStartRecording = jest.fn(),
    onImportAudio = jest.fn(),
    disabled = false,
  ) =>
    renderer.create(
      <ThemeProvider>
        <RecordGestureFab
          onStartRecording={onStartRecording}
          onImportAudio={onImportAudio}
          disabled={disabled}
        />
      </ThemeProvider>,
    );

  it("renders mic button and hides import button by default", () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = renderComponent();
    });

    const micButton = findByTestId(tree!, "mic-button");
    expect(micButton).toBeDefined();
    expect(micButton.props.accessibilityLabel).toBe("New Voice Recording");

    const importContainer = findByTestId(tree!, "record-gesture-fab-container");
    expect(importContainer).toBeDefined();
  });

  it("triggers onStartRecording on short tap with minimal displacement", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    // Touch down at t = 1000
    act(() => {
      micButton.props.onResponderGrant?.(createSyntheticEvent(1000));
    });

    // Release at t = 1100 (< 260ms threshold)
    act(() => {
      micButton.props.onResponderRelease?.({
        ...createSyntheticEvent(1100),
      });
    });

    expect(onStartRecording).toHaveBeenCalledTimes(1);
    expect(onImportAudio).not.toHaveBeenCalled();
  });

  it("reveals import button upon holding past threshold", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    act(() => {
      micButton.props.onResponderGrant?.(createSyntheticEvent(1000));
    });

    // Advance time past hold threshold
    act(() => {
      jest.advanceTimersByTime(HOLD_THRESHOLD_MS + 20);
    });

    const tooltip = findByTestId(tree!, "import-tooltip");
    expect(tooltip).toBeDefined();
    const importButton = findByTestId(tree!, "import-button");
    expect(importButton).toBeDefined();

    // Release in place without sliding - should dismiss without triggering recording or import
    act(() => {
      micButton.props.onResponderRelease?.(createSyntheticEvent(1500));
    });

    expect(onStartRecording).not.toHaveBeenCalled();
    expect(onImportAudio).not.toHaveBeenCalled();
  });

  it("triggers onImportAudio when sliding up to target and releasing", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    // Touch down at t = 1000
    act(() => {
      micButton.props.onResponderGrant?.(createSyntheticEvent(1000));
    });

    // Advance time past hold threshold
    act(() => {
      jest.advanceTimersByTime(HOLD_THRESHOLD_MS + 20);
    });

    // Slide up into target area (dy = -75, dx = 0)
    act(() => {
      micButton.props.onResponderMove?.({
        nativeEvent: {
          timestamp: 1300,
          pageX: 100,
          pageY: 425,
        },
        touchHistory: {
          touchBank: [
            {
              touchActive: true,
              startPageX: 100,
              startPageY: 500,
              startTimeStamp: 1000,
              currentPageX: 100,
              currentPageY: 425,
              currentTimeStamp: 1300,
              previousPageX: 100,
              previousPageY: 500,
              previousTimeStamp: 1000,
            },
          ],
          mostRecentTimeStamp: 1300,
        },
      });
    });

    // Target button should be visually highlighted with active primary background and tooltip
    const tooltipTextNode = findByTestId(tree!, "import-tooltip-text");
    expect(tooltipTextNode.props.children).toBe("Release to Import");
    const importButton = findByTestId(tree!, "import-button");
    const hoveredStyle = flattenStyles(importButton.props.style);
    expect(hoveredStyle.backgroundColor).toBe(darkColors.primary);

    // Release finger on target
    act(() => {
      micButton.props.onResponderRelease?.({
        nativeEvent: {
          timestamp: 1400,
          pageX: 100,
          pageY: 425,
        },
        touchHistory: {
          touchBank: [
            {
              touchActive: false,
              startPageX: 100,
              startPageY: 500,
              startTimeStamp: 1000,
              currentPageX: 100,
              currentPageY: 425,
              currentTimeStamp: 1400,
              previousPageX: 100,
              previousPageY: 425,
              previousTimeStamp: 1300,
            },
          ],
          mostRecentTimeStamp: 1400,
        },
      });
    });

    expect(onImportAudio).toHaveBeenCalledTimes(1);
    expect(onStartRecording).not.toHaveBeenCalled();
  });

  it("cancels when dragging away sideways from the target", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    // Touch down at t = 1000
    act(() => {
      micButton.props.onResponderGrant?.(createSyntheticEvent(1000));
    });

    // Advance time past hold threshold
    act(() => {
      jest.advanceTimersByTime(HOLD_THRESHOLD_MS + 20);
    });

    // Slide up first
    act(() => {
      micButton.props.onResponderMove?.({
        nativeEvent: {
          timestamp: 1300,
          pageX: 100,
          pageY: 425,
        },
        touchHistory: {
          touchBank: [
            {
              touchActive: true,
              startPageX: 100,
              startPageY: 500,
              startTimeStamp: 1000,
              currentPageX: 100,
              currentPageY: 425,
              currentTimeStamp: 1300,
              previousPageX: 100,
              previousPageY: 500,
              previousTimeStamp: 1000,
            },
          ],
          mostRecentTimeStamp: 1300,
        },
      });
    });

    // Then drag far sideways (dx = 80)
    act(() => {
      micButton.props.onResponderMove?.({
        nativeEvent: {
          timestamp: 1350,
          pageX: 180,
          pageY: 425,
        },
        touchHistory: {
          touchBank: [
            {
              touchActive: true,
              startPageX: 100,
              startPageY: 500,
              startTimeStamp: 1000,
              currentPageX: 180,
              currentPageY: 425,
              currentTimeStamp: 1350,
              previousPageX: 100,
              previousPageY: 425,
              previousTimeStamp: 1300,
            },
          ],
          mostRecentTimeStamp: 1350,
        },
      });
    });

    // When dragging away, tooltip reverts to "Slide to Import" and button returns to surface
    const tooltipTextNode = findByTestId(tree!, "import-tooltip-text");
    expect(tooltipTextNode.props.children).toBe("Slide to Import");
    const importButton = findByTestId(tree!, "import-button");
    const unhoveredStyle = flattenStyles(importButton.props.style);
    expect(unhoveredStyle.backgroundColor).toBe(darkColors.surface);

    // Release finger outside target
    act(() => {
      micButton.props.onResponderRelease?.({
        nativeEvent: {
          timestamp: 1400,
          pageX: 180,
          pageY: 425,
        },
        touchHistory: {
          touchBank: [
            {
              touchActive: false,
              startPageX: 100,
              startPageY: 500,
              startTimeStamp: 1000,
              currentPageX: 180,
              currentPageY: 425,
              currentTimeStamp: 1400,
              previousPageX: 180,
              previousPageY: 425,
              previousTimeStamp: 1350,
            },
          ],
          mostRecentTimeStamp: 1400,
        },
      });
    });

    expect(onImportAudio).not.toHaveBeenCalled();
    expect(onStartRecording).not.toHaveBeenCalled();
  });

  it("reveals import target on early slide up and triggers import", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    // Touch down at t = 1000
    act(() => {
      micButton.props.onResponderGrant?.(createSyntheticEvent(1000));
    });

    // Move up before HOLD_THRESHOLD_MS (dy = -50 at t = 1100)
    act(() => {
      micButton.props.onResponderMove?.({
        nativeEvent: {
          timestamp: 1100,
          pageX: 100,
          pageY: 450,
        },
        touchHistory: {
          touchBank: [
            {
              touchActive: true,
              startPageX: 100,
              startPageY: 500,
              startTimeStamp: 1000,
              currentPageX: 100,
              currentPageY: 450,
              currentTimeStamp: 1100,
              previousPageX: 100,
              previousPageY: 500,
              previousTimeStamp: 1000,
            },
          ],
          mostRecentTimeStamp: 1100,
        },
      });
    });

    // Release on target
    act(() => {
      micButton.props.onResponderRelease?.({
        nativeEvent: {
          timestamp: 1200,
          pageX: 100,
          pageY: 450,
        },
        touchHistory: {
          touchBank: [
            {
              touchActive: false,
              startPageX: 100,
              startPageY: 500,
              startTimeStamp: 1000,
              currentPageX: 100,
              currentPageY: 450,
              currentTimeStamp: 1200,
              previousPageX: 100,
              previousPageY: 450,
              previousTimeStamp: 1100,
            },
          ],
          mostRecentTimeStamp: 1200,
        },
      });
    });

    expect(onImportAudio).toHaveBeenCalledTimes(1);
    expect(onStartRecording).not.toHaveBeenCalled();
  });

  it("triggers onImportAudio when tapping the revealed import button directly", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    // Hold to reveal
    act(() => {
      micButton.props.onResponderGrant?.(createSyntheticEvent(1000));
      jest.advanceTimersByTime(HOLD_THRESHOLD_MS + 20);
    });

    const importButton = findByTestId(tree!, "import-button");
    act(() => {
      importButton.props.onPress?.();
    });

    expect(onImportAudio).toHaveBeenCalledTimes(1);
  });

  it("handles onPanResponderTerminate cleanly", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    act(() => {
      micButton.props.onResponderGrant?.(createSyntheticEvent(1000));
      jest.advanceTimersByTime(HOLD_THRESHOLD_MS + 20);
      micButton.props.onResponderTerminate?.();
    });

    expect(onStartRecording).not.toHaveBeenCalled();
    expect(onImportAudio).not.toHaveBeenCalled();
  });

  it("does not start gesture when disabled", () => {
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(jest.fn(), jest.fn(), true);
    });

    const micButton = findByTestId(tree!, "mic-button");
    expect(micButton.props.onStartShouldSetResponder?.()).toBe(false);
  });

  it("triggers onAccessibilityAction for record and import", () => {
    const onStartRecording = jest.fn();
    const onImportAudio = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, onImportAudio);
    });

    const micButton = findByTestId(tree!, "mic-button");

    act(() => {
      micButton.props.onAccessibilityAction?.({
        nativeEvent: { actionName: "activate" },
      });
    });
    expect(onStartRecording).toHaveBeenCalledTimes(1);

    act(() => {
      micButton.props.onAccessibilityAction?.({
        nativeEvent: { actionName: "import" },
      });
    });
    expect(onImportAudio).toHaveBeenCalledTimes(1);
  });

  it("uses swapped theme colors (dark on light mode, light on dark mode)", () => {
    // 1. Light mode (default) -> import button uses darkColors
    let lightTree: ReactTestRenderer;
    act(() => {
      lightTree = renderComponent();
    });

    const lightImportButton = findByTestId(lightTree!, "import-button");
    const lightStyle = flattenStyles(lightImportButton.props.style);
    expect(lightStyle.backgroundColor).toBe(darkColors.surface);

    // 2. Dark mode -> import button uses lightColors
    jest.spyOn(ReactNative, "useColorScheme").mockReturnValue("dark");
    let darkTree: ReactTestRenderer;
    act(() => {
      darkTree = renderComponent();
    });

    const darkImportButton = findByTestId(darkTree!, "import-button");
    const darkStyle = flattenStyles(darkImportButton.props.style);
    expect(darkStyle.backgroundColor).toBe(lightColors.surface);
  });
});
