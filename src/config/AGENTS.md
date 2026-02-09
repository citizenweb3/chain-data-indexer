# Config Module

**Purpose:** Load, parse, validate, and print application configuration from CLI arguments, environment variables, and `.env` files.

## Key Files

| File | Description |
|------|-------------|
| `schema.ts` | Zod validation schema for runtime config validation |
| `argv.ts` | CLI argument parser (extracts `--key=value` and `--flag` args) |
| `dotenv.ts` | `.env` file loader using `dotenv` package |
| `parsers.ts` | Type coercion helpers: `asPositiveInt`, `asBool`, `asLogLevel`, `asPgMode` |
| `validate.ts` | Validates raw config object against Zod schema |
| `printer.ts` | Pretty-prints final config to console (masks passwords) |

## Dependencies

- `zod` — Runtime schema validation
- `dotenv` — Environment file loading
- `../types.js` — `Config`, `ArgMap`, `LogLevel` types

## Used By

- `src/config.ts` — Main config builder that aggregates all sources
- `src/index.ts` — Entry point calls `getConfig()` and `printConfig()`

## Structure

```
src/config/
├── schema.ts       # Zod schema: ConfigSchema, PgConfigSchema
├── argv.ts         # parseArgv() → ArgMap
├── dotenv.ts       # loadDotEnvIfPresent()
├── parsers.ts      # Type coercion functions
├── validate.ts     # validateConfig(raw) → Config
└── printer.ts      # printConfig(cfg)
```

## Configuration Schema (`schema.ts`)

```typescript
ConfigSchema = z.object({
  rpcUrl: z.string().url(),
  from: z.number().int().positive().optional(),
  to: z.number().int().positive().optional(),
  shards: z.number().int().min(1),
  shardId: z.number().int().min(0),
  concurrency: z.number().int().min(1),
  timeoutMs: z.number().int().min(1),
  rps: z.number().int().min(1),
  retries: z.number().int().min(0),
  backoffMs: z.number().int().min(0),
  backoffJitter: z.number().min(0).max(1),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'trace', 'silent']),
  caseMode: z.enum(['snake', 'camel']),
  sinkKind: z.enum(['stdout', 'postgres']),  // Note: sink factory also supports 'file', 'clickhouse', 'null'
  // ... additional fields
  pg: PgConfigSchema,  // Nested Postgres config
}).refine(...)
```

## Key Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RPC_URL` | string | `http://127.0.0.1:26657` | CometBFT RPC endpoint |
| `FROM` | number | — | Starting block height |
| `TO` | number | — | Ending block height (`latest` = resolve from RPC) |
| `RESUME` | boolean | `false` | Resume from last DB progress |
| `FOLLOW` | boolean | `false` | Follow new blocks after backfill |
| `SINK` | string | `stdout` | Output backend: `stdout`, `postgres` (validated); also `file`, `clickhouse`, `null` (factory-supported) |
| `CONCURRENCY` | number | `48` | Max in-flight requests |
| `RPS` | number | `150` | Requests per second limit |
| `LOG_LEVEL` | string | `info` | Logging verbosity |
| `PG_HOST` | string | — | PostgreSQL host |
| `PG_PORT` | number | `5432` | PostgreSQL port |
| `PG_USER` | string | — | PostgreSQL user |
| `PG_PASS` | string | — | PostgreSQL password |
| `PG_DB` | string | — | PostgreSQL database |
| `PG_PROGRESS_ID` | string | `default` | Progress tracking identifier |

## Common Patterns

### 1. Parsing Priority
```typescript
// CLI args > Environment variables > Defaults
const value = args['key'] ?? process.env.KEY ?? defaultValue;
```

### 2. Type Coercion (`parsers.ts`)
```typescript
asPositiveInt('concurrency', value);  // Throws if not positive integer
asBool('resume', value, false);       // Coerces to boolean with default
asLogLevel(value);                    // Validates log level enum
```

### 3. Validation with Custom Refinements
```typescript
ConfigSchema.refine(
  (c) => !(c.from !== undefined && c.to !== undefined && c.to < c.from),
  { message: 'to must be >= from', path: ['to'] }
)
```

### 4. Config Printing
```typescript
printConfig(cfg);
// Output: [config] rpcUrl=https://... from=1000000 to=2000000 sink=postgres ...
// Passwords are masked with ***
```

## Adding New Config Options

1. Add to `types.d.ts` → `Config` type
2. Add Zod validation in `schema.ts`
3. Add parser/coercion in `parsers.ts` if needed
4. Add extraction logic in `src/config.ts`
5. Document in `.env.example`
