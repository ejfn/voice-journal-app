import * as FileSystem from "expo-file-system/legacy";

/**
 * Returns the sandboxed directory path for a given year and month.
 * e.g., FileSystem.documentDirectory + "audio/2026/09/"
 */
export const getAudioDirectory = (
  year: number | string,
  month: number | string,
): string => {
  const baseDir =
    FileSystem.documentDirectory ||
    "file:///data/user/0/com.personal.voicejournal/files/";
  const mStr = String(month).padStart(2, "0");
  return `${baseDir}audio/${year}/${mStr}/`;
};

/**
 * Returns the full sandboxed file URI for a given entry.
 * e.g., FileSystem.documentDirectory + "audio/2026/09/{entryId}.m4a"
 */
export const getEntryAudioPath = (
  entryId: string,
  timestamp: number = Date.now(),
): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${getAudioDirectory(year, month)}${entryId}.m4a`;
};

/**
 * Normalizes dB metering (-60dB to 0dB) into a linear amplitude between 0.0 and 1.0.
 */
export const normalizeMetering = (
  meteringDb: number | null | undefined,
): number => {
  if (meteringDb === null || meteringDb === undefined || isNaN(meteringDb)) {
    return 0;
  }
  // Clamp between -60 dB and 0 dB
  const clamped = Math.max(-60, Math.min(0, meteringDb));
  return Number(((clamped + 60) / 60).toFixed(2));
};

/**
 * Formats duration in seconds into human-readable string like "1m 45s" or "0m 45s".
 */
export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const remSecs = s % 60;
  return `${mins}m ${String(remSecs).padStart(2, "0")}s`;
};

/**
 * Formats duration into MM:SS for recording/playback timers (e.g., "01:45").
 */
export const formatTimer = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const remSecs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(remSecs).padStart(2, "0")}`;
};

/**
 * Formats timestamp into 24h or 12h time string (e.g. "19:42").
 */
export const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/**
 * Formats timestamp into date string (e.g. "Saturday, Sep 19").
 */
export const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};
