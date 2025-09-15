// src/utils/time.ts
// Human-friendly duration formatting.

/**
 * Formats a duration given in seconds into a human-friendly string, e.g., "1d 2h 3m 4s".
 * Returns "—" for negative or invalid input.
 *
 * @param {number} totalSeconds - The total duration in seconds.
 * @returns {string} The formatted duration string.
 */
export function formatDuration(totalSeconds: number): string {
    if (!isFinite(totalSeconds) || totalSeconds < 0) return '—';
    const s = Math.floor(totalSeconds);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours || parts.length) parts.push(`${hours}h`);
    if (mins || parts.length) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}