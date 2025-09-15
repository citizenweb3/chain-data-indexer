/**
 * Factory function for creating different types of Sink implementations
 * based on the provided configuration. Supports stdout, file, postgres,
 * clickhouse and null sinks.
 */
import { Sink, SinkConfig } from './types.js';
import { StdoutSink } from './stdout.js';
import { FileSink } from './file.js';
import { NullSink } from './null.js';
import { PostgresSink } from './postgres.js';
import { ClickhouseSink } from './clickhouse.js';

/**
 * Creates and returns an instance of a Sink implementation according to the
 * given configuration.
 *
 * @param {SinkConfig} cfg - The configuration object specifying the kind of sink and its settings.
 * @returns {Sink} A concrete instance of a Sink corresponding to the specified kind.
 * @throws {Error} Throws an error if the sink kind is not recognized.
 */
export function createSink(cfg: SinkConfig): Sink {
  switch (cfg.kind) {
    case 'stdout':
      return new StdoutSink(cfg);
    case 'file':
      return new FileSink(cfg);
    case 'postgres':
      return new PostgresSink({
        kind: 'postgres',
        pg: cfg.pg ?? {},
        mode: (cfg as any).pgMode ?? 'batch-insert',
        batchSizes: (cfg as any).batchSizes,
      });
    case 'clickhouse':
      return new ClickhouseSink(cfg);
    case 'null':
      return new NullSink();
    default:
      throw new Error(`Unknown sink kind: ${(cfg as any).kind}`);
  }
}
