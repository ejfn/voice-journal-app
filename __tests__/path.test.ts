import {
  formatDate,
  formatDuration,
  formatTime,
  formatTimer,
  getAudioDirectory,
  getEntryAudioPath,
  normalizeMetering,
} from "../src/utils/paths";

describe("Path & Audio Utilities", () => {
  it("generates correct hierarchical audio directory path", () => {
    const dir = getAudioDirectory(2026, 9);
    expect(dir).toContain("audio/2026/09/");

    const dirWithPaddedMonth = getAudioDirectory("2026", "09");
    expect(dirWithPaddedMonth).toContain("audio/2026/09/");
  });

  it("generates sandboxed audio path for an entry", () => {
    // 2026-09-19T10:00:00Z timestamp
    const timestamp = new Date("2026-09-19T10:00:00Z").getTime();
    const entryPath = getEntryAudioPath("test-entry-uuid", timestamp);

    expect(entryPath).toContain("audio/2026/09/test-entry-uuid.m4a");
  });

  it("normalizes metering dB values to 0.0 - 1.0 range", () => {
    expect(normalizeMetering(0)).toBe(1.0);
    expect(normalizeMetering(-60)).toBe(0.0);
    expect(normalizeMetering(-30)).toBe(0.5);
    expect(normalizeMetering(-120)).toBe(0.0); // clamped
    expect(normalizeMetering(10)).toBe(1.0); // clamped
    expect(normalizeMetering(null)).toBe(0.0);
    expect(normalizeMetering(undefined)).toBe(0.0);
  });

  it("formats duration into readable string", () => {
    expect(formatDuration(105)).toBe("1m 45s");
    expect(formatDuration(45)).toBe("0m 45s");
    expect(formatDuration(0)).toBe("0m 00s");
    expect(formatDuration(3600)).toBe("60m 00s");
  });

  it("formats timer MM:SS", () => {
    expect(formatTimer(105)).toBe("01:45");
    expect(formatTimer(5)).toBe("00:05");
    expect(formatTimer(0)).toBe("00:00");
  });

  it("formats time and date", () => {
    const timestamp = new Date(2026, 8, 19, 14, 30).getTime();
    const timeStr = formatTime(timestamp);
    expect(timeStr).toMatch(/\d{2}:\d{2}/);

    const dateStr = formatDate(timestamp);
    expect(dateStr).toContain("Sep 19");
  });
});
