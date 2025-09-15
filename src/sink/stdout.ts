// src/sink/stdout.ts
/**
 * Sink implementation that writes buffered lines to standard output (stdout).
 */
import { Sink, SinkConfig } from './types.js';

/**
 * A sink that buffers lines and writes them to standard output in batches.
 */
export class StdoutSink implements Sink {
  private buf: string[] = [];
  private flushEvery: number;

  /**
   * Constructs a new StdoutSink.
   * @param cfg Optional configuration object.
   */
  constructor(cfg?: SinkConfig) {
    this.flushEvery = Math.max(1, cfg?.flushEvery ?? 1);
  }

  /**
   * Performs any initialization tasks; currently a no-op.
   */
  async init(): Promise<void> {}

  /**
   * Buffers a line and flushes if the buffer reaches the configured size.
   * @param line The line to write.
   */
  async write(line: string): Promise<void> {
    this.buf.push(line);
    if (this.buf.length >= this.flushEvery) {
      const chunk = this.buf.join('\n') + '\n';
      this.buf.length = 0;
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
    }
  }

  /**
   * Forces flushing the buffer to stdout.
   */
  async flush(): Promise<void> {
    if (this.buf.length === 0) return;
    const chunk = this.buf.join('\n') + '\n';
    this.buf.length = 0;
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Flushes any remaining buffered data and closes the sink.
   */
  async close(): Promise<void> {
    await this.flush?.();
  }
}
