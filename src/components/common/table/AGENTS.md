# components/common/table/

Tiny set of table primitives ported from the validatorinfo project and simplified for this app. Used by `ChannelsTable` and `TransfersTable`. There is no `DataGrid` / `Tanstack Table` here — pages compose `<BaseTable>` + `<thead>` + `<TableHeaderItem>` directly.

## Files

| File | Renders | Client? |
|------|---------|---------|
| `base-table.tsx` | `<table>` with `border-separate border-spacing-y-2` so rows get vertical gap | server |
| `base-table-row.tsx` | `<tr>` with the dark hover background (`bg-table_row` → `bg-table_header`) | server |
| `base-table-cell.tsx` | `<td>` with the hover-lift effect (scale-y, layered shadow); `hoverable={false}` disables it for non-clickable cells | server |
| `table-header-item.tsx` | `<th>` — renders either a custom child or a `<TableSortItems>` clickable label | server |
| `table-sort-items.tsx` | The actual sort arrow + label; flips `?sort=` / `?order=` via `router.push` | **client** (`'use client'`) |
| `table-pagination.tsx` | Numeric pagination row driven by `currentSearch` + `pageParam` props | server |

## Sorting (validatorinfo parity)

`TableHeaderItem label="Transfers" field="transfers" defaultSelected />` makes the cell sort-able. The actual click handler (`TableSortItems`) writes `sort` / `order` to the URL via `useRouter().push(... , { scroll: false })`.

Conventions inherited from validatorinfo:
- Sort key is read from `?sort=<field>`.
- Order is read from `?order=asc|desc`, default `asc`.
- `defaultSelected` means: "treat this column as the active sort when the URL has no `sort=`". When the user clicks the default column the first time, we flip to `desc` (descending is usually what you want for "most transfers"), matching the original behaviour.
- The arrow is `▲` / `▼` when active, `↕` when sortable but inactive, hidden when no `field` is passed.

The page-level RSC reads `?sort=` / `?order=` from `searchParams` and passes them to the service call. The client component only writes to the URL — it never reads server state.

## Pagination — `currentSearch` is a prop, NOT a header

This is the **single most important difference** from validatorinfo. The original project pulled the current querystring out of an `x-current-search` middleware header so deep components could synthesize page links without prop-drilling. We deliberately **do not** do that here.

```tsx
<TablePagination
  pageLength={pageLength}
  currentSearch={currentSearch}   // string | URLSearchParams, REQUIRED
  pageParam="p"                   // optional, defaults to "p"
/>
```

Why prop-based instead of middleware:

- This app has no `middleware.ts`. Adding one to ship a single header is overkill, and middleware runs on every request including `/api/*` and static assets.
- Next 16 RSC pages already have `searchParams` available. Building the `URLSearchParams` once in the page (see `src/app/dashboard/page.tsx`) and passing it down is one line.
- Tests/storybook can construct a `URLSearchParams` literal without mocking a request.

`currentSearch` accepts both `string` (raw querystring) and `URLSearchParams` — the pagination component normalises via `new URLSearchParams(currentSearch.toString() ?? '')`. It also reads the current page from the same querystring via `sp.get(pageParam)`.

## Page link rendering rules

`TablePagination` builds a window around the current page. Read `table-pagination.tsx` for the exact rules — summarised:

- `‹` previous-page button when not on page 1.
- Page 1 link, ellipsis, `current - 1`, **current** (highlighted, no link), `current + 1`, ellipsis, last page.
- `›` next-page button when not on last.
- If `pageLength < 2` we render a spacer `<div className="h-8" />` instead of nothing — this prevents the table from jumping when going from "no pagination needed" to "pagination shown" between renders.
- `hideLastPage` skips the trailing "last" link for cursor-based UIs that don't know total pages (currently unused — `/transfers` uses the Older/Reset Link pair instead of `TablePagination`).

## Adding a new column

1. Add a `<TableHeaderItem label="…" field="…" />` to the `<thead>` row.
2. Add the matching `<BaseTableCell>` inside the row component.
3. Extend the DTO and the service query if the data is new.

Do **not**:
- Add `<div role="table">` constructs — keep semantic HTML.
- Wrap the table in a horizontal scroller before checking it actually overflows; the dashboard width is fixed at `max-w-6xl` so most tables fit.
- Read `useSearchParams` inside a row component to pick a sort indicator. The header is the only place sort UI lives.
