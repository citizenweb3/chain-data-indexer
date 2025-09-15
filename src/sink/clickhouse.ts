/**
 * Provides a sink implementation for ClickHouse database.
 * This is a placeholder for a future HTTP JSONEachRow streaming sink.
 */
import { Sink, SinkConfig } from './types.js';

/**
 * ClickhouseSink is a Sink implementation for writing data to ClickHouse.
 * Currently not implemented.
 */
export class ClickhouseSink implements Sink {
  // TODO: implement HTTP JSONEachRow streaming
  /**
   * Creates a new ClickhouseSink instance.
   * @param _cfg Configuration object for the sink.
   */
  constructor(_cfg: SinkConfig) {}
  /**
   * Initializes the Clickhouse sink.
   * @throws Error Always throws because not implemented.
   */
  async init(): Promise<void> {
    throw new Error('ClickhouseSink not implemented yet');
  }
  /**
   * Writes a line to Clickhouse.
   * @param _line The string line to be written.
   * @throws Error Always throws because not implemented.
   */
  async write(_line: string): Promise<void> {
    throw new Error('ClickhouseSink not implemented yet');
  }
  /**
   * Closes the Clickhouse sink.
   * Currently a no-op.
   */
  async close(): Promise<void> {
    /* noop */
  }
}
