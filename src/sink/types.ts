/**
 * Type definitions for sink configuration and sink interface used in the indexing application.
 * Provides configuration options and type contracts for different sink targets such as stdout,
 * file output, PostgreSQL, ClickHouse, or null sink.
 */

/**
 * Enumerates the supported sink types for output.
 * - 'stdout': output to standard output
 * - 'file': output to a file
 * - 'postgres': output to a PostgreSQL database
 * - 'clickhouse': output to a ClickHouse database
 * - 'null': discard output
 */
export type SinkKind = 'stdout' | 'file' | 'postgres' | 'clickhouse' | 'null';

/**
 * Configuration options for a sink that defines how and where the data will be output.
 */
export interface SinkConfig {
  /**
   * The type of sink to use (e.g., "stdout", "file", "postgres", etc.).
   */
  kind: SinkKind;
  /**
   * Number of records to buffer before flushing.
   */
  flushEvery?: number;
  /**
   * Output file path (for kind="file").
   */
  outPath?: string;
  /**
   * Connection string for the sink (e.g., database).
   */
  connectionString?: string;
  /**
   * Table name for database sinks.
   */
  table?: string;
  /**
   * Batch size configuration for various data types.
   */
  batchSizes?: {
    /**
     * Number of blocks per batch.
     */
    blocks?: number;
    /**
     * Number of transactions per batch.
     */
    txs?: number;
    /**
     * Number of messages per batch.
     */
    msgs?: number;
    /**
     * Number of events per batch.
     */
    events?: number;
    /**
     * Number of attributes per batch.
     */
    attrs?: number;
  };
  /**
   * PostgreSQL-specific connection options.
   */
  pg?: {
    /**
     * PostgreSQL connection string.
     */
    connectionString?: string;
    /**
     * PostgreSQL host.
     */
    host?: string;
    /**
     * PostgreSQL port.
     */
    port?: number;
    /**
     * PostgreSQL user.
     */
    user?: string;
    /**
     * PostgreSQL password.
     */
    password?: string;
    /**
     * PostgreSQL database name.
     */
    database?: string;
    /**
     * Use SSL for PostgreSQL connection.
     */
    ssl?: boolean;
    /**
     * Insert mode for PostgreSQL.
     */
    mode?: 'block-atomic' | 'batch-insert';
  };
}

/**
 * Interface for sink implementations which defines lifecycle methods and writing behavior.
 */
export interface Sink {
  /**
   * Initialize the sink before writing any data.
   * @returns A promise that resolves when initialization is complete.
   */
  init(): Promise<void>;
  /**
   * Write a single line or record to the sink.
   * @param line - The data to write.
   * @returns A promise that resolves when the write is complete.
   */
  write(line: any): Promise<void>;
  /**
   * Flush any buffered data to the sink.
   * @returns A promise that resolves when the flush is complete.
   */
  flush?(): Promise<void>;
  /**
   * Close the sink and release any resources.
   * @returns A promise that resolves when the sink is closed.
   */
  close(): Promise<void>;
}
