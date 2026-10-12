export const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const BIN_RETENTION_DAYS = BIN_RETENTION_MS / MS_PER_DAY;

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
  // Clamp to the retention window to guard against future deleted_at
  // timestamps (cross-device clock skew)
  return Math.min(BIN_RETENTION_DAYS, Math.ceil(remainingMs / MS_PER_DAY));
}

/**
 * Formats user-facing countdown string for binned entries.
 * E.g. "28 days remaining", "1 day remaining", "Expires today".
 * Null/undefined deleted_at is treated as expired (defensive: binned rows
 * always carry a deleted_at timestamp).
 */
export function formatBinCountdown(
  deletedAt: number | null | undefined,
  now: number = Date.now(),
): string {
  if (deletedAt == null) return "Expires today";
  const days = getBinRemainingDays(deletedAt, now);
  if (days <= 0) return "Expires today";
  if (days === 1) return "1 day remaining";
  return `${days} days remaining`;
}
