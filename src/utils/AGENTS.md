# src/utils/

Small, pure functions shared between UI and worker. No side effects, no imports from `@/db` / `@/services`, no React.

## Files

| File | Exports | Used by |
|------|---------|---------|
| `cn.ts` | `cn(...inputs)` — `clsx` + `tailwind-merge` | Every component with conditional classes |
| `format-amount.ts` | `formatNative(amount, decimals)` — bigint/string → decimal string | Worker stats jobs, transfer detail page |
| `format-time.ts` | `formatRelativeTime(value)`, `formatIsoUtc(value)` — `date-fns` wrappers with null-safe input | (currently worker batch outputs; the UI still uses `formatDistanceToNow` from `date-fns` directly inside row components) |

## `cn` convention

```ts
import { cn } from "@/utils/cn";

<div className={cn(
  "rounded-md border border-bgSt",
  hoverable && "hover:bg-bgHover",
  active && "text-highlight",
  className,                            // always last, lets callers override
)} />
```

Rules:

- **Always end with the `className` prop** so callers can override anything earlier in the call. `tailwind-merge` resolves conflicts in source order, last-wins.
- Use `false`, `undefined`, and `null` as the "skip this class" value — `cn` (via `clsx`) drops falsy entries.
- Do not concatenate Tailwind classes with template literals when more than one condition is in play. Conflict resolution between `text-white/50` and `text-highlight` only works through `twMerge`.

Do not duplicate the `cn` import path — the alias is always `@/utils/cn`. There is no `lib/utils.ts` shadcn-style copy.

## `formatNative`

```ts
formatNative("1500000", 6)       // "1.5"
formatNative(1_500_000n, 6)      // "1.5"
formatNative(null, 6)            // null
formatNative("abc", 6)           // null  — guarded; never throws
formatNative("100", 0)           // "100"
formatNative("-1500000", 6)      // "-1.5"
```

This was originally written for the db-worker batch output (where Postgres `NUMERIC(80, 0)` arrives as `string`/`bigint`). The UI imports it for the transfer detail page's amount field. Key properties:

- **Never coerces to JS `number`.** Amounts can exceed `Number.MAX_SAFE_INTEGER` and IBC transfers do hit those values. The function works on the digit string.
- **Returns `null` on invalid input** instead of `NaN` or a thrown error. Callers render `—` on null, which keeps the "no data" path identical to other nullable fields.
- **Strips trailing zeros after the decimal point** (`"1.500000"` → `"1.5"`) but preserves leading zeros before it (`"0.5"`, not `".5"`).
- **No thousands separator.** If you want grouping (e.g. `1,500.5`), wrap the result with `Intl.NumberFormat` at the call site — `formatNative` is the lossless conversion layer, formatting is the caller's concern.

If you find yourself reaching for `bignumber.js` / `decimal.js` in a component, stop. Either the existing helper is enough, or the new requirement belongs in this file as a new export.

## `formatRelativeTime` / `formatIsoUtc`

Thin wrappers around `date-fns` that accept the union `Date | string | number | null | undefined` and return `string | null` (never throws, never `'Invalid Date'`).

The UI tables currently call `formatDistanceToNow` from `date-fns` directly because the row components need `{ addSuffix: true }`. If three or more components end up duplicating that argument, fold it into `formatRelativeTime` rather than re-importing `date-fns` everywhere.

## What does NOT belong here

- React components or hooks. Anything that imports `react` lives under `src/components/`.
- Service-layer code (DB queries, fetch wrappers). Those go to `src/services/`.
- Domain types. Component DTOs sit next to their row component (see `src/components/AGENTS.md`); service DTOs sit in the service file.
- Validation. Use a runtime check inside the service or route handler — there is no `zod` schema layer here today, and we do not want one without a concrete reason.

## Style

- TypeScript only. `'function declarations'` over `const fn = () => {}` only when hoisting matters — both styles are present and acceptable.
- Two-space indent, double quotes inside TS, single quotes inside JSX. Match the existing file you're editing.
- Pure functions — no `Date.now()` captured at module scope, no `process.env` reads. If a util needs current time, take it as a parameter.
