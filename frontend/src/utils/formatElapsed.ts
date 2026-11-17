const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
/** Below this, seconds keep one decimal ("4.2s"). */
const DECIMAL_SECONDS_BELOW = 10;

/**
 * A wall-clock duration for display: "4.2s", "42s", "2min 14s", "1h 5min".
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < DECIMAL_SECONDS_BELOW) return `${(Math.round(seconds * 10) / 10).toString()}s`;
  const total = Math.round(seconds);
  if (total < SECONDS_PER_MINUTE) return `${total}s`;
  if (total < SECONDS_PER_HOUR) {
    const min = Math.floor(total / SECONDS_PER_MINUTE);
    const sec = total % SECONDS_PER_MINUTE;
    return sec ? `${min}min ${sec}s` : `${min}min`;
  }
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const min = Math.round((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return min ? `${hours}h ${min}min` : `${hours}h`;
}
