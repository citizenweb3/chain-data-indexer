/**
 * Provides a NullSink implementation of the Sink interface.
 * This sink discards all input lines and is intended for throughput benchmarking or testing without persisting data.
 */
import { Sink } from './types.js';

/**
 * Null sink implementation.
 * Drops all lines and performs no operations, useful for performance testing and benchmarks.
 *
 * @implements {Sink}
 */
export class NullSink implements Sink {
  /**
   * Initializes the sink.
   * No operation is performed in this implementation.
   *
   * @returns {Promise<void>} A promise that resolves immediately.
   */
  async init(): Promise<void> {}

  /**
   * Writes a line to the sink.
   * In this null implementation, the line is ignored.
   *
   * @param {string} _line - The input line to discard.
   * @returns {Promise<void>} A promise that resolves immediately.
   */
  async write(_line: string): Promise<void> {}

  /**
   * Closes the sink.
   * No operation is performed in this implementation.
   *
   * @returns {Promise<void>} A promise that resolves immediately.
   */
  async close(): Promise<void> {}
}
