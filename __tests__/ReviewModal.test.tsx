import React from "react";
import renderer, { act, ReactTestRenderer } from "react-test-renderer";
import { ReviewModal } from "../src/components/ReviewModal";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { ToastProvider } from "../src/components/common/Toast";
import { JournalEntry } from "../src/db/schema";

jest.mock("../src/services/audio/AudioPlaybackService", () => ({
  audioPlaybackService: {
    addListener: jest.fn(() => jest.fn()),
    stop: jest.fn(),
  },
}));

describe("ReviewModal", () => {
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

  const renderModal = (entry: JournalEntry | null) => {
    let tree: ReactTestRenderer;
    void act(() => {
      tree = renderer.create(
        <ThemeProvider>
          <ToastProvider>
            <ReviewModal
              visible
              entry={entry}
              onSave={jest.fn()}
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
      removedShort: "Backed up",
      forbiddenText: "Safely backed up in Google Drive",
    },
    {
      name: "local-only",
      entry: baseEntry,
      expectedLabel: "On device",
      removedShort: "Pending backup",
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
      expectedLabel: "Cloud only",
      removedShort: "Tap to download",
      forbiddenText: "Tap to stream or download",
    },
  ])(
    "renders label-only status row for $name status",
    ({ expectedLabel, removedShort, forbiddenText, entry }) => {
      const tree = renderModal(entry);
      // The local react-test-renderer declaration does not expose
      // findAllByType; cast root to access it for test introspection.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const texts = (tree.root as any).findAllByType("Text");
      const renderedText = texts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((t: any) => String(t.props.children))
        .join(" ");

      expect(renderedText).toContain(expectedLabel);
      expect(renderedText).not.toContain(removedShort);
      expect(renderedText).not.toContain(forbiddenText);
    },
  );
});
