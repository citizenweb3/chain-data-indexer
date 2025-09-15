/**
 * Creates a delay for the specified number of milliseconds before resolving.
 *
 * @param ms - The number of milliseconds to sleep.
 * @returns Promise that resolves after the specified delay.
 *
 * @example
 * await sleep(1000); // Waits for 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
