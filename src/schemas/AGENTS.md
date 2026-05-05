# Schemas

Zod request schemas for path params and query strings. Used inside route handlers via `safeParse`.

## Files

| File | Schemas |
|---|---|
| `pagination.ts` | `BlocksQuerySchema`, `TxsQuerySchema`, `HeightParamSchema`, `HashParamSchema` |
| `blocks.ts` | block-specific schemas (if any) |
| `txs.ts` | tx-specific schemas |
| `common.ts` | shared primitives |

## Patterns

### uint64 height

```ts
z.string().max(20).regex(/^\d+$/).transform((s) => BigInt(s))
```
- `.max(20)` is **non-negotiable** — guards against ZOD-DoS (`BigInt('9'.repeat(10000))` allocates).
- `.regex(/^\d+$/)` rejects negatives, hex, scientific notation.
- Transform yields `BigInt` for direct passing to `postgres` template.

### Tx hash

```ts
z.string().length(64).regex(/^[A-Fa-f0-9]{64}$/).transform((h) => h.toUpperCase())
```
DB stores hashes uppercase.

### Limit

```ts
z.coerce.number().int().min(1).max(100).default(50)
```

## Rules

- All path params and query strings MUST go through a schema. Never trust `req.url`/`params` directly.
- Always call `safeParse` (not `parse`) and return `errorResponse('invalid_params', 400, error.flatten().fieldErrors)` on failure.
- Bound any `BigInt(string)` transform with `.max(20)` — this is the ZOD-DoS guard.
- Use `z.coerce` for query strings (always strings on the wire).

## OpenAPI

Schemas registered for OpenAPI live in `src/lib/openapi.ts`. They are separate from request schemas — request schemas decode input, OpenAPI schemas describe the response wire format.
