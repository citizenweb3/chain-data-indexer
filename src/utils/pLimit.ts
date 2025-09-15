/**
 * A minimal promise concurrency limiter for asynchronous tasks.
 * This module exports a function to create a concurrency limiter,
 * allowing a specified number of promises to run simultaneously.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal promise-concurrency limiter (functional)

/**
 * Creates a concurrency limiter for asynchronous tasks.
 *
 * @param concurrency - Maximum number of tasks to run simultaneously.
 * @returns A function that limits the number of concurrently running promises.
 *          Pass a task function that returns a promise to this function to schedule it.
 *
 * @example
 * const limit = pLimit(2);
 * const result = await limit(() => fetchData());
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    active--;
    if (queue.length > 0) {
      const run = queue.shift()!;
      run();
    }
  }

  /**
   * Schedules a promise-returning task to run with concurrency limit.
   *
   * @typeParam T - The type of the promise result.
   * @param task - A function that returns a promise to be executed.
   * @returns A promise that resolves with the result of the provided task.
   */
  return function runLimited<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}
