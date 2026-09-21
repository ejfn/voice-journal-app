import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import { ReviewModal } from "../src/components/ReviewModal";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { ToastProvider } from "../src/components/common/Toast";
import { JournalEntry } from "../src/db/schema";
import { audioPlaybackService } from "../src/services/audio/AudioPlaybackService";

jest.mock("../src/services/audio/AudioPlaybackService", () => ({
  audioPlaybackService: {
    addListener: jest.fn(() => jest.fn()),
    stop: jest.fn(),
    pause: jest.fn(),
    play: jest.fn(),
    seekTo: jest.fn(),
    skip: jest.fn(),
  },
}));

describe("ReviewModal", () => {
  const flattenText = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map(flattenText).join("");
    }

    if (value && typeof value === "object" && "props" in value) {
      const props = (value as { props?: { children?: unknown } }).props;
      return flattenText(props?.children);
    }

    return "";
  };

  const baseEntry: JournalEntry = {
    id: "test-entry-1",
    title: "Test Voice Note",
    summary: "A test entry",
    transcript: "Test speech",
    tags: ["test"],
    duration_sec: 10,
    source_type: "recorded",
    local_audio_path: "file:///mock/test.m4a",
    drive_audio_file_id: null,
    drive_sidecar_file_id: null,
    is_audio_cached: 1,
    created_at: 1000,
    updated_at: 1000,
    drive_synced_at: null,
    last_accessed_at: 1000,
  };

  const renderModal = (
    entry: JournalEntry | null,
    onSave: (updatedEntry: JournalEntry) => void = jest.fn(),
  ) => {
    let tree: ReactTestRenderer;
    void act(() => {
      tree = renderer.create(
        <ThemeProvider>
          <ToastProvider>
            <ReviewModal
              visible
              entry={entry}
              onSave={onSave}
              onDelete={jest.fn()}
              onClose={jest.fn()}
            />
          </ToastProvider>
        </ThemeProvider>,
      );
    });
    return tree!;
  };

  it.each([
    {
      name: "synced",
      entry: {
        ...baseEntry,
        drive_audio_file_id: "audio-file-123",
        drive_sidecar_file_id: "sidecar-file-456",
        drive_synced_at: 2000,
        updated_at: 1500,
      } as JournalEntry,
      expectedLabel: "Synced",
      expectedDescription: "Backed up",
      forbiddenText: "Safely backed up in Google Drive",
    },
    {
      name: "local-only",
      entry: baseEntry,
      expectedLabel: "Local",
      expectedDescription: "Pending backup",
      forbiddenText: "Stored on device only",
    },
    {
      name: "cloud-only",
      entry: {
        ...baseEntry,
        drive_audio_file_id: "audio-file-123",
        drive_sidecar_file_id: "sidecar-file-456",
        drive_synced_at: 2000,
        is_audio_cached: 0,
        local_audio_path: null,
      } as JournalEntry,
      expectedLabel: "Cloud",
      expectedDescription: "Tap play to download",
      forbiddenText: "Tap to stream or download",
    },
  ])(
    "renders status row with short description for $name status",
    ({ expectedLabel, expectedDescription, forbiddenText, entry }) => {
      const tree = renderModal(entry);
      const renderedText = tree.root
        .findAll(() => true)
        .map((node) => flattenText(node.props.children))
        .join(" ");

      expect(renderedText).toContain(expectedLabel);
      expect(renderedText).toContain(expectedDescription);
      expect(renderedText).not.toContain(forbiddenText);
    },
  );

  it("renders playback controls with ±10s skip buttons and triggers skip", () => {
    const tree = renderModal(baseEntry);

    const rewindNodes = tree.root.findAllByProps({
      testID: "playback-rewind-10",
    }) as { props: { onPress: () => void } }[];
    const forwardNodes = tree.root.findAllByProps({
      testID: "playback-forward-10",
    }) as { props: { onPress: () => void } }[];

    expect(rewindNodes.length).toBeGreaterThan(0);
    expect(forwardNodes.length).toBeGreaterThan(0);

    void act(() => {
      rewindNodes[0].props.onPress();
    });
    expect(audioPlaybackService.skip).toHaveBeenCalledWith(-10);

    void act(() => {
      forwardNodes[0].props.onPress();
    });
    expect(audioPlaybackService.skip).toHaveBeenCalledWith(10);
  });

  it("preserves dirty fields and updates untouched fields on same-entry refresh", async () => {
    const onSave = jest.fn();
    const tree = renderModal(baseEntry, onSave);
    const textInputs = tree.root.findAllByProps({
      placeholder: "Headline...",
    }) as { props: { onChangeText: (value: string) => void } }[];
    const addTagInputs = tree.root.findAllByProps({
      placeholder: "Add new tag...",
    }) as {
      props: {
        onChangeText: (value: string) => void;
        onSubmitEditing: () => void;
      };
    }[];
    const removeLegacyTagButtons = tree.root.findAllByProps({
      accessibilityLabel: "Remove tag test",
    }) as { props: { onPress: () => void } }[];

    void act(() => {
      textInputs[0].props.onChangeText("Manual title");
    });
    void act(() => {
      addTagInputs[0].props.onChangeText("manual");
    });
    void act(() => {
      addTagInputs[0].props.onSubmitEditing();
    });
    void act(() => {
      removeLegacyTagButtons[0].props.onPress();
    });

    void act(() => {
      tree.update(
        <ThemeProvider>
          <ToastProvider>
            <ReviewModal
              visible
              entry={{
                ...baseEntry,
                title: "AI title",
                summary: "AI summary",
                transcript: "AI transcript",
                tags: ["test", "ai", "fresh"],
                transcription_status: "completed",
              }}
              onSave={onSave}
              onDelete={jest.fn()}
              onClose={jest.fn()}
            />
          </ToastProvider>
        </ThemeProvider>,
      );
    });

    const backButtons = tree.root.findAllByProps({
      accessibilityLabel: "Back",
    }) as { props: { onPress: () => void } }[];
    await act(async () => {
      await backButtons[0].props.onPress();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Manual title",
        summary: "AI summary",
        transcript: "AI transcript",
        tags: ["manual"],
      }),
    );
  });

  it("resets dirty fields when switching to a different entry id", async () => {
    const onSave = jest.fn();
    const tree = renderModal(baseEntry, onSave);
    const textInputs = tree.root.findAllByProps({
      placeholder: "Headline...",
    }) as { props: { onChangeText: (value: string) => void } }[];

    void act(() => {
      textInputs[0].props.onChangeText("Manual title");
    });

    const secondEntry: JournalEntry = {
      ...baseEntry,
      id: "test-entry-2",
      title: "Second title",
      summary: "Second summary",
      transcript: "Second transcript",
      tags: ["second"],
      updated_at: 2000,
    };

    void act(() => {
      tree.update(
        <ThemeProvider>
          <ToastProvider>
            <ReviewModal
              visible
              entry={secondEntry}
              onSave={onSave}
              onDelete={jest.fn()}
              onClose={jest.fn()}
            />
          </ToastProvider>
        </ThemeProvider>,
      );
    });

    const updatedTextInputs = tree.root.findAllByProps({
      placeholder: "Headline...",
    }) as {
      props: { onChangeText: (value: string) => void; onBlur: () => void };
    }[];

    await act(async () => {
      updatedTextInputs[0].props.onChangeText("Second title edited");
      updatedTextInputs[0].props.onBlur();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "test-entry-2",
        title: "Second title edited",
        summary: "Second summary",
        transcript: "Second transcript",
        tags: ["second"],
      }),
    );
  });

  it("auto-saves when title, summary, or transcript are edited after debounce", async () => {
    jest.useFakeTimers();
    try {
      const onSave = jest.fn();
      const tree = renderModal(baseEntry, onSave);
      const textInputs = tree.root.findAllByProps({
        placeholder: "Headline...",
      }) as { props: { onChangeText: (value: string) => void } }[];

      void act(() => {
        textInputs[0].props.onChangeText("Auto saved title");
      });

      expect(onSave).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(650);
        await Promise.resolve();
      });

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: baseEntry.id,
          title: "Auto saved title",
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
