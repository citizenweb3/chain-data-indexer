# src/schemas/

Zod 4 contract-first schemas. Every public API request/response goes through one of these. They are the single source of truth for shape, validation, and OpenAPI documentation.

## Files

| File | Purpose |
|------|---------|
| `common.ts` | Shared primitives — `DirectionEnum`, `PacketDirectionEnum`, `PeriodEnum`, `PacketStatusEnum`, `PortSchema`, `ChannelSchema`, `BigIntStringSchema`, `IsoDateCoerceSchema`, `IsoDateStringSchema`, `DenomSchema`, `ErrorResponseSchema` |
| `ibc-aggregation.ts` | Shared aggregate coverage quality/counts and source freshness contracts |
| `stats.ts` | `/api/v1/stats` query + response |
| `channels.ts` | `/api/v1/channels` query + response (`ChannelsSortEnum`, `SortOrderEnum`) |
| `assets.ts` | `/api/v1/assets` query + response (`AssetsSortEnum`) |
| `timeseries.ts` | `/api/v1/timeseries` query + response (`TimeseriesMetricEnum`, `TimeseriesBucketEnum`) |
| `transfers.ts` | `/api/v1/transfers` list query, route params, list/detail responses, cursor |

## Critical rule: import `z` from `@/lib/openapi-zod`, NOT from `'zod'`

```ts
// CORRECT
import { z } from '@/lib/openapi-zod';

// WRONG — breaks .openapi() and silently degrades to a different zod instance
import { z } from 'zod';
```

Why: `@asteasolutions/zod-to-openapi` 8.5.0 patches Zod at module load via `extendZodWithOpenApi(z)`. Turbopack will happily resolve `'zod'` to a separate module copy depending on the import graph (RSC server, route handler, OpenAPI generator), so a schema that calls `.openapi('Foo')` on an unpatched copy throws `z.string().openapi is not a function`. Centralizing through `@/lib/openapi-zod` (where the patch is applied once) guarantees every schema sees the same instance.

If you ever see `*.openapi is not a function` or schemas show up as inline `$ref`-less objects in `/api/openapi.json`, this is the cause.

## Contract-first pattern

Each schema file follows the same shape:

1. Define the schema with `z.object({...})`.
2. Derive the TypeScript type via `z.infer`:
   ```ts
   export const StatsQuerySchema = z.object({ direction: DirectionEnum.default('both') });
   export type StatsQuery = z.infer<typeof StatsQuerySchema>;
   ```
3. Route handlers consume `parseSearchParams(StatsQuerySchema, request)` from `@/lib/api-helpers`.
4. `src/lib/openapi.ts` registers the schema by name for the OpenAPI doc.

No manual TS types for API payloads. If you find yourself writing `type Foo = {...}` for an API DTO, the Zod schema is the source of truth — derive instead.

## `common.ts` conventions

- **Enums use `z.enum([...])`** not string literal unions. Gives a runtime guard and shows up as `enum` in OpenAPI.
- **`BigIntStringSchema`** validates `^\d+$` and transforms the parsed string to a `bigint`. We never expose JS `number` for chain heights / sequences (precision loss above 2^53). Wire format is **always** a decimal string.
- **`IsoDateCoerceSchema`** accepts `YYYY-MM-DD`, refines that it round-trips through `Date.toISOString()` (catches `2025-02-30` etc.), and transforms to `Date` at UTC midnight. Use this for date-range filters; do not accept full ISO timestamps from clients for daily-bucket endpoints.
- **`IsoDateStringSchema`** is the wire-side counterpart — validates the `YYYY-MM-DD` form **without** transforming. Use this in response schemas (timeseries buckets) so the JSON output is a stable string the frontend can pass through `Date` parsing once.
- **`PacketDirectionEnum`** (`outgoing | incoming`) is the strict two-value variant for per-packet fields. `DirectionEnum` (`outgoing | incoming | both`) is the query-side variant — `both` is a filter aggregator and must never reach a stored row.
- **`PortSchema` / `ChannelSchema`** have explicit length caps and regex (`^channel-\d+$`). Treat these as defense-in-depth against malformed input before the SQL builder ever sees the value.
- **`ErrorResponseSchema`** mirrors what `errorResponse()` in `@/lib/api-helpers` actually emits. If you add a new `ApiErrorCode`, update both.

## Cross-schema rules

- Wire BigInt / Decimal values are always strings in responses. Look at `IbcTransferDtoSchema` — every numeric chain value (`event_height`, `sequence`, `amount`, `timeout_ts`, etc.) is `z.string()` or `z.string().nullable()`. Do not change this — the entire DB layer hands back `bigint` / `Prisma.Decimal` for a reason and the service layer is responsible for `.toString()` / `.toFixed(0)`.
- Periods (`24h | 7d | 30d`) are object keys in stats/channels responses, not enum-stringly indexed maps. This shape is intentional for frontend consumers.

## Cursor / keyset schemas

`TransfersListQuerySchema` uses a 4-tuple cursor (`before_height`, `before_sequence`, `before_channel`, `before_port`). The `.superRefine` enforces all-or-nothing: passing any one without the rest is a 400. Do not loosen this — the corresponding SQL comparison `(event_height, sequence, channel_id_src, port_id_src) < (...)` is undefined with mismatched cardinality.

## Adding a new endpoint

1. Create `src/schemas/<name>.ts` importing `z` from `@/lib/openapi-zod`.
2. Export `<Name>QuerySchema`, `<Name>ResponseSchema`, types via `z.infer`.
3. Register in `src/lib/openapi.ts` (`registry.register(...)` for response, `registerPath(...)` for the route).
4. Write the service in `src/services/`. Write the route handler in `src/app/api/v1/<name>/route.ts`.
5. Confirm the schema appears in `/api/openapi.json` and renders in `/docs` (Scalar UI).
