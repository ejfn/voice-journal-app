export const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Calculates remaining days in the Recycle Bin before 30-day auto-purge.
 * Returns 0 if expired or expiring within 0 days.
 */
export function getBinRemainingDays(
  deletedAt: number,
  now: number = Date.now(),
): number {
  const elapsed = now - deletedAt;
  const remainingMs = BIN_RETENTION_MS - elapsed;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

/**
 * Formats user-facing countdown string for binned entries.
 * E.g. "28 days remaining", "1 day remaining", "Expires today".
 */
export function formatBinCountdown(
  deletedAt: number,
  now: number = Date.now(),
): string {
  const days = getBinRemainingDays(deletedAt, now);
  if (days <= 0) return "Expires today";
  if (days === 1) return "1 day remaining";
  return `${days} days remaining`;
}
