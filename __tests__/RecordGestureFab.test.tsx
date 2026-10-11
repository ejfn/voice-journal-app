import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import { RecordGestureFab } from "../src/components/RecordGestureFab";
import { ThemeProvider } from "../src/theme/ThemeContext";

type Handler = (...args: unknown[]) => unknown;

interface TestNode {
  props: {
    testID?: string;
    children?: React.ReactNode;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    disabled?: boolean;
    onPress?: Handler;
    onPressIn?: Handler;
    onPressOut?: Handler;
    [key: string]: unknown;
  };
}

describe("RecordGestureFab", () => {
  const findByTestId = (tree: ReactTestRenderer, testID: string): TestNode => {
    const nodes = tree.root.findAllByProps({ testID }) as TestNode[];
    if (!nodes.length) {
      throw new Error(`Node with testID "${testID}" not found`);
    }
    return nodes[0];
  };

  const renderComponent = (onStartRecording = jest.fn(), disabled = false) =>
    renderer.create(
      <ThemeProvider>
        <RecordGestureFab
          onStartRecording={onStartRecording}
          disabled={disabled}
        />
      </ThemeProvider>,
    );

  it("renders microphone button with proper accessibility attributes", () => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = renderComponent();
    });

    const micButton = findByTestId(tree!, "mic-button");
    expect(micButton).toBeDefined();
    expect(micButton.props.accessibilityLabel).toBe("New Voice Recording");
    expect(micButton.props.accessibilityRole).toBe("button");
  });

  it("triggers onStartRecording when pressed", () => {
    const onStartRecording = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording);
    });

    const micButton = findByTestId(tree!, "mic-button");
    act(() => {
      micButton.props.onPress?.();
    });

    expect(onStartRecording).toHaveBeenCalledTimes(1);
  });

  it("does not trigger onStartRecording when disabled", () => {
    const onStartRecording = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording, true);
    });

    const micButton = findByTestId(tree!, "mic-button");
    act(() => {
      micButton.props.onPress?.();
    });

    expect(onStartRecording).not.toHaveBeenCalled();
  });

  it("handles pressIn and pressOut feedback animations without throwing", () => {
    const onStartRecording = jest.fn();
    let tree: ReactTestRenderer;

    act(() => {
      tree = renderComponent(onStartRecording);
    });

    const micButton = findByTestId(tree!, "mic-button");
    act(() => {
      micButton.props.onPressIn?.();
    });

    act(() => {
      micButton.props.onPressOut?.();
    });

    expect(micButton).toBeDefined();
  });
});
