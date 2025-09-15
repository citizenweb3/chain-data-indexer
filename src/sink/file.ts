/**
 * @module FileSink
 * Implements a sink that appends NDJSON lines into a file.
 */
// src/sink/file.ts
import fs from 'node:fs';
import { Sink, SinkConfig } from './types.js';
import path from 'node:path';
import { getLogger } from '../utils/logger.ts';

const log = getLogger('sink/file');

/**
 * FileSink is a sink implementation that writes NDJSON lines to a file.
 * It buffers lines in memory and flushes them to the file after a configurable number of lines.
 */
export class FileSink implements Sink {
  private buf: string[] = [];
  private flushEvery: number;
  private outPath: string;
  private stream!: fs.WriteStream;

  /**
   * Constructs a new FileSink.
   * @param {SinkConfig} cfg - Configuration object. Expects `outPath` (string) for output file path, and optional `flushEvery` (number) for flush frequency.
   */
  constructor(cfg: SinkConfig) {
    if (!cfg.outPath) {
      log.error('FileSink requires outPath');
      throw new Error('FileSink requires outPath');
    }
    this.outPath = cfg.outPath;
    this.flushEvery = Math.max(1, cfg.flushEvery ?? 100);
  }

  /**
   * Initializes the sink: creates directories as needed and opens a write stream to the file.
   * @returns {Promise<void>}
   */
  async init(): Promise<void> {
    log.info(`Initializing FileSink with path: ${this.outPath}`);
    await fs.promises.mkdir(path.dirname(this.outPath), { recursive: true });
    this.stream = fs.createWriteStream(this.outPath, { flags: 'a' });
    await new Promise<void>((resolve) => this.stream.once('open', () => resolve()));
    log.info('FileSink initialized and stream opened');
  }

  /**
   * Adds a line to the buffer and flushes to file if the buffer reaches the flush threshold.
   * @param {string} line - String line to write.
   * @returns {Promise<void>}
   */
  async write(line: string): Promise<void> {
    log.info('Writing line to FileSink buffer');
    this.buf.push(line);
    if (this.buf.length >= this.flushEvery) {
      const chunk = this.buf.join('\n') + '\n';
      this.buf.length = 0;
      log.info(`Flushing buffer of size ${this.flushEvery} to file`);
      if (!this.stream.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          this.stream.once('drain', () => resolve());
          this.stream.once('error', (e) => reject(e));
        });
      }
    }
  }

  /**
   * Flushes any buffered lines to the file.
   * @returns {Promise<void>}
   */
  async flush(): Promise<void> {
    if (this.buf.length === 0) {
      log.info('Flush called but buffer is empty, nothing to do');
      return;
    }
    log.info(`Flushing buffer of size ${this.buf.length} to file`);
    const chunk = this.buf.join('\n') + '\n';
    this.buf.length = 0;
    if (!this.stream.write(chunk)) {
      await new Promise<void>((resolve, reject) => {
        this.stream.once('drain', () => resolve());
        this.stream.once('error', (e) => reject(e));
      });
    }
  }

  /**
   * Flushes remaining lines and closes the file stream.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    log.info('Closing FileSink');
    await this.flush();
    await new Promise<void>((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.once('error', (e) => reject(e));
    });
    log.info('FileSink closed');
  }
}
