# src/app/

Next.js 16 app router. Routes are RSC by default and pull data directly from `@/services/*` (the same modules `src/app/api/v1/*/route.ts` uses). The UI never makes an HTTP call to its own `/api/*` endpoints.

> **Reminder from `/AGENTS.md`:** this is Next.js 16 — `searchParams` and `params` are **`Promise<...>`** in route handlers and pages. They are not POJOs. Always `await` before reading. Read `node_modules/next/dist/docs/` before assuming any other convention from older Next versions still applies.

## Pages

| Route | File | Notes |
|-------|------|-------|
| `/` | `page.tsx` | One-line `redirect('/dashboard')` |
| `/dashboard` | `dashboard/page.tsx` | Stats, big chart, channels table (paginated) |
| `/channels/[channel]` | `channels/[channel]/page.tsx` | Per-channel stats + recent packets, regex-validated channel id |
| `/transfers` | `transfers/page.tsx` | Keyset-cursor list, filter inputs in querystring |
| `/transfers/[port]/[channel]/[sequence]` | `transfers/[port]/[channel]/[sequence]/page.tsx` | Single-packet detail; `sequence` parsed as bigint |
| `/docs` | `docs/page.tsx` | API documentation stub |

## API routes

| Route | File | Backed by |
|-------|------|-----------|
| `/api/openapi.json` | `api/openapi.json/route.ts` | Static spec |
| `/api/v1/health` | `api/v1/health/route.ts` | Live DB ping |
| `/api/v1/stats` | `api/v1/stats/route.ts` | `getStats()` |
| `/api/v1/channels` | `api/v1/channels/route.ts` | `listChannels()` |
| `/api/v1/timeseries` | `api/v1/timeseries/route.ts` | `getTimeseries()` |
| `/api/v1/transfers` | `api/v1/transfers/route.ts` | `listTransfers()` |
| `/api/v1/transfers/[port]/[channel]/[sequence]` | nested `route.ts` | `getTransfer()` |

The route handlers are thin: parse-validate-call-service. Server business logic lives in `src/services/*`; do not add SQL or Prisma to a `route.ts` file.

## RSC data fetching policy

**Pages import services directly. No HTTP-hop.**

```ts
// dashboard/page.tsx — correct
import { getStats } from "@/services/stats-service";
const stats = await getStats({ direction });
```

```ts
// WRONG — never do this in SSR
const stats = await fetch("http://localhost:3000/api/v1/stats").then(r => r.json());
```

Why direct import:

- One Postgres round-trip instead of (RSC → HTTP → route handler → service → DB). The HTTP-hop is what `/api/*` exists for — external consumers, not our own pages.
- `Promise.all([...])` parallelises service calls into a single waterfall step. The dashboard fans out 5 service calls in one `await Promise.all`.
- No localhost URL guessing, no `process.env.NEXT_PUBLIC_API_URL` plumbing, no auth duplication.

## `force-dynamic` on every page

Every page exports:

```ts
export const dynamic = "force-dynamic";
```

Reasons:

- Pages read live mirror state. Caching at the route level would serve stale data after the worker writes a new batch.
- `searchParams` already opt routes out of static rendering in Next 16; the explicit `force-dynamic` makes the intent visible and survives accidental edits that remove `searchParams`.
- ISR / on-demand revalidation is not in scope for the MVP — when we want it we'll add `revalidate` per page deliberately.

Per-fetch caching (`fetch(..., { cache: 'force-cache', next: { revalidate: N } })`) is not used because we don't `fetch` — we call services. If a service ever needs caching, do it inside the service (memoise the Prisma call), not at the page boundary.

## URL state (the validatorinfo pattern)

All UI state that should survive reload, sharing, and back/forward navigation lives in `searchParams`. There is no Redux / Zustand / Context state at the page level. The recognised parameters across the app:

| Param | Pages | Values | Default |
|-------|-------|--------|---------|
| `period` | `/dashboard`, `/channels/[channel]` | `24h` \| `7d` \| `30d` | `7d` |
| `direction` | `/dashboard`, `/channels/[channel]`, `/transfers` | `outgoing` \| `incoming` \| `both` | `both` |
| `sort` | `/dashboard` | `transfers` \| `volume_atom` \| `last_activity` | `transfers` |
| `order` | `/dashboard` | `asc` \| `desc` | `desc` |
| `p` | `/dashboard` | int ≥ 1 | `1` |
| `channel` | `/transfers` | `channel-\d+` | (none) |
| `denom` | `/transfers` | string | (none) |
| `status` | `/transfers` | `sent` \| `received` \| `acknowledged` \| `timeout` \| `failed` | (none) |
| `limit` | `/transfers` | 1..100 | `20` |
| `beforeHeight`, `beforeSequence`, `beforeChannel`, `beforePort` | `/transfers` | keyset cursor tuple | (none) |

Each page narrows untrusted strings via a small type guard (see `isPeriod` / `isDirection` / `isStatus` in the existing pages) before passing them to services. Untrusted values fall back to the default — they do **not** `notFound()`.

## When to `notFound()` vs default fallback

- **Path params** with structural rules → `notFound()`. Example: `channel-${num}` regex check on `/channels/[channel]`; `BigInt(sequence)` parse on the transfer detail page.
- **Service returns null/empty** for an existing-shape path param → `notFound()`. Example: `getTransfer(...)` returns `null` for a well-formed but absent sequence.
- **Query params** that fail validation → silently fall back to the default. Bad `?period=xx` should not 404 the dashboard; it should just render `7d`.

This mirrors validatorinfo and matches user mental models — typos in the URL bar shouldn't blow up a working page.

## Keyset pagination on `/transfers`

`/transfers` does **not** use numbered pagination. The service returns a `cursor` object whose four fields encode the tail of the page; the next page is requested by mounting those four fields back into the querystring as `beforeHeight`, `beforeSequence`, `beforeChannel`, `beforePort`.

The page renders two `next/link` anchors:

- **Older ›** — built from `result.cursor`. Hidden when the cursor is `null` (last page).
- **Reset** — current filters minus the cursor params. Shown only when at least one `before*` param is present (`hasCursor`).

Why keyset instead of `?p=2`:

- Total counts on `ibc_packets` are expensive at scale; keyset pages stay O(limit) regardless of depth.
- New transfers land at the head of the table during a session — offset-based pagination would shift rows under the user.

Filter parameters (`limit`, `direction`, `status`, `channel`, `denom`) are preserved across both links via a shared `filtersSearch` URLSearchParams built once at the top of the render.

## Nullable rendering — channel + transfer detail

The mirror has nullable columns by design. Render rules:

- `ChannelDto.success_rate_30d: number | null` — when null, render `—` with `text-white/40`; otherwise multiply by 100 and use the success-rate colour ramp (`text-secondary` ≥ 0.95, `text-highlight` ≥ 0.8, `text-red` below).
- `ChannelDto.last_activity: string | null` — when null, render `—`; otherwise `formatDistanceToNow(date, { addSuffix: true })` from `date-fns`.
- Every `string | null` field on the transfer detail page (`port_id_dst`, `denom`, `amount`, all `tx_hash_*`, all `height_*`, `event_time`, `event_height`, `relayer`, `memo`, timeout fields) — render `—` via the local `formatField` helper.
- `amount` + `denom` is the only paired nullable: render `—` if **either** is null, never `null uatom` or `1000 null`.

Do not collapse this convention to empty string — the dash makes "no data" visually distinct from "loading" (which we never show because pages stream HTML).

## globals.css — Tailwind v4

`src/app/globals.css` is a Tailwind v4 file. Conventions you must follow:

- **There is no `tailwind.config.ts`.** Tailwind v4 deprecates the JS config in favour of CSS-first config via the `@theme` block. Do not add a `tailwind.config.ts` — it will be silently ignored and you'll confuse the next agent.
- Custom colours live inside `@theme { … }` as `--color-*` variables. Tailwind v4 auto-generates the `bg-*`, `text-*`, `border-*`, `from-*`, etc. utilities. Naming follows Tailwind's own (`--color-highlight` → `bg-highlight`, `text-highlight`).
- Font variables come in via `next/font/google` in `layout.tsx` (`Handjet`, `Inter`). They're exposed as `--font-handjet` / `--font-sfpro` and bridged into Tailwind via the `@theme inline { … }` block. The `inline` modifier is required because the values are runtime CSS vars, not literals.
- Inter is exposed as `--font-sfpro` (utility class `font-sfpro`) intentionally — the project name predates the font switch and renaming the var would touch every component. Do not "fix" it.
- Two layered text-shadow utilities (`.text-shadowed`, `.text-black-shadowed`) are declared under `@layer utilities`. Add additional one-off utilities to that block, not as global CSS rules outside `@layer`.

## Layout

`src/app/layout.tsx` owns:

- `<html className="dark ...">` — the `dark` class is hard-coded; we have no light theme.
- Font variable wiring (do not call `Handjet({ … })` / `Inter({ … })` anywhere else).
- Default `<body>` colour and the flex column shell that lets pages own their `<main>` width.

If you need a header / footer chrome, add it to `layout.tsx`. Per-page `<main>` already has `mx-auto max-w-6xl px-6 py-12` — do not re-wrap children in a second container.

## Testing pages locally

```
yarn dev                    # Next.js dev on :3000
DATABASE_URL=… yarn worker  # sibling process — fills the mirror
```

Pages render against whatever the worker has populated. To test the empty state, point `DATABASE_URL` at a fresh schema (`prisma migrate deploy`) and skip the worker. Empty queries return `[]` / `0` everywhere — the empty-state strings live in the table components, not the pages.
