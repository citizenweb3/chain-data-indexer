# src/components/

React 19 components for the Next.js 16 app router under `src/app/`. The UI is the dashboard surface for the Postgres mirror — it never calls HTTP; every page renders server-side and passes plain DTOs down to these components.

## Categories

| Folder | What lives here | Server / Client |
|--------|-----------------|-----------------|
| `common/table/` | Generic table primitives (`BaseTable`, `BaseTableRow`, `BaseTableCell`, `TableHeaderItem`, `TablePagination`, `TableSortItems`). Ported from validatorinfo, simplified. | Server, except `TableSortItems` (needs `useRouter`). |
| `dashboard/` | Page-level pieces of `/dashboard` and `/channels/[channel]`: `StatsCards`, `ChannelsTable` (+ row), `PeriodTabs`, `DirectionToggle`. | Server containers + client toggles. |
| `charts/` | chart.js 4 wrappers — see `charts/AGENTS.md` for the lazy-register pattern. | Always client. |
| `transfers/` | `TransfersTable` + row, used by `/transfers` and inside the channel detail page. | Server. |
| `ui/` | Tiny dark-mode primitives (`Card` family, `Tab` / `TabGroup`). Not a design system — only what the dashboard actually consumes. | Mixed; `Tab` is client because it owns `onClick`. |

## Library rules

- **No shadcn, no Radix, no Headless UI, no Mantine, no Chakra.** Tailwind v4 + plain `<button>` / `<table>` / `<select>` cover everything we need at this scale. If you reach for a UI lib, talk to team-lead first — the dark theme is hand-tuned and a library will fight it.
- **No `recharts`, no `D3`.** Charts use `chart.js@4` + `react-chartjs-2` + `chartjs-plugin-zoom`. Pattern lives in `charts/`.
- **`date-fns`** for relative timestamps (`formatDistanceToNow`). Do not import `moment` or `dayjs`.
- **`clsx` + `tailwind-merge`** via the `cn()` helper in `@/utils/cn`. Use `cn(...)` everywhere classes are conditional — never string-concatenate Tailwind classes by hand or you will hit class-precedence bugs.

## RSC defaults

Server components are the default. A file is client-only when it does one of:

- Uses `useState` / `useEffect` / `useMemo` / `useRef` / `useReducer`.
- Calls a Next.js client hook (`useRouter`, `usePathname`, `useSearchParams`).
- Attaches an `onClick` / `onChange` / form event handler.
- Imports `react-chartjs-2` (canvas is browser-only).

Everything else stays server-side so the bundle stays small and pages stream HTML. The current client surface is intentionally narrow:

- `components/ui/tabs.tsx`
- `components/dashboard/period-tabs.tsx`
- `components/dashboard/direction-toggle.tsx`
- `components/common/table/table-sort-items.tsx`
- `components/charts/chart-config.ts` + `components/charts/timeseries-line.tsx`

If you add a `'use client'` directive, audit whether the parent could pass already-rendered ReactNodes instead (this is how `StatsCards` injects sparkline charts — see `dashboard/page.tsx`).

## DTOs

DTO types live next to the component that owns the rendering, **not** in a separate `types/` folder. Examples:

- `ChannelDto` is exported from `dashboard/channels-table-row.tsx`.
- `TransferRowDto` is exported from `transfers/transfers-table-row.tsx`.
- `StatsDto` is exported from `dashboard/stats-cards.tsx`.

Pages import the type from the same file they import the component from. This is deliberate: when the DTO shape changes you only have one file to update, and a row component is the natural owner of "what one record looks like."

## Naming

- `kebab-case.tsx` file names. The component itself is `PascalCase` and is the default export.
- Row components live next to their table: `*-table.tsx` + `*-table-row.tsx`.
- Container components (page-shaped) are the default export; sub-components inside the same module are named exports (`Card` default + `CardHeader`, `CardValue`, `CardSubtext` named).

## Theme tokens

Colors come from `src/app/globals.css` `@theme` block. The names live there as `--color-*` (so Tailwind v4 picks them up as utility classes — e.g. `bg-table_row`, `text-highlight`, `border-bgSt`). Do not hard-code hex codes in components — add a token to `globals.css` first.

Two custom fonts are exposed as CSS vars (`--font-handjet` numeric/display, `--font-sfpro` for Inter body text) and surfaced via Tailwind utilities `font-handjet` / `font-sfpro`. They are wired in `src/app/layout.tsx`; do not import `next/font` again in any other file.

## Accessibility

- Tables get real `<thead>` / `<tbody>` / `<th>`. `TableHeaderItem` renders a `<th>` — do not replace it with `<div>`.
- The `Tab` / `TabGroup` pair sets `role="tablist"` / `role="tab"` / `aria-selected`. Reuse them for any new toggle UI instead of styling buttons ad-hoc.
- Interactive sort arrows live inside the `<th>` cell click target — keep the keyboard activation path (button or link) when extending.

## What to read before touching this folder

- `src/app/AGENTS.md` — page conventions, URL state, what the server already does for you.
- `components/common/table/AGENTS.md` — the only non-trivial primitive group.
- `components/charts/AGENTS.md` — chart.js is unusual enough to need its own doc.
