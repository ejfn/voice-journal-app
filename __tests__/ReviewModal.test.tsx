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

  it("renders a concise sync-status label without the long description", () => {
    const syncedEntry: JournalEntry = {
      ...baseEntry,
      drive_audio_file_id: "audio-file-123",
      drive_sidecar_file_id: "sidecar-file-456",
      drive_synced_at: 2000,
      updated_at: 1500,
    };

    const tree = renderModal(syncedEntry);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const root = tree.root as any;
    const texts = root.findAllByType("Text");
    const statusText = texts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => String(t.props.children) === "Synced",
    );

    expect(statusText).toBeDefined();
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      texts.some((t: any) =>
        String(t.props.children).includes("Safely backed up in Google Drive"),
      ),
    ).toBe(false);
  });

  it.each([
    {
      name: "local-only",
      entry: baseEntry,
      expectedLabel: "On device",
      forbiddenText: "Pending cloud backup",
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
      forbiddenText: "Tap to stream or download",
    },
  ])(
    "renders concise label for $name status",
    ({ expectedLabel, forbiddenText, entry }) => {
      const tree = renderModal(entry);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const root = tree.root as any;
      const texts = root.findAllByType("Text");

      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        texts.some((t: any) => String(t.props.children) === expectedLabel),
      ).toBe(true);
      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        texts.some((t: any) =>
          String(t.props.children).includes(forbiddenText),
        ),
      ).toBe(false);
    },
  );
});
