# components/charts/

All charts are `chart.js@4` + `react-chartjs-2` + `chartjs-plugin-zoom`. Every file here is `'use client'` — `chart.js` touches `window` / `document` at import time, so it cannot run during RSC render.

## Files

| File | Purpose |
|------|---------|
| `chart-config.ts` | Lazy `Chart.register(...)` singleton; theme colours; `buildOptions(variant, metric)`; `buildGradient(ctx, chartArea)`; metric value formatter |
| `timeseries-line.tsx` | The only chart component the app currently uses — line + filled gradient, two variants (`full` / `card`) |

## Why chart.js (not recharts / D3)

- **react-chartjs-2** is a thin wrapper — we own the canvas configuration, not the abstraction.
- We need wheel/pinch zoom on the 30-day line. `chartjs-plugin-zoom` is one import; recharts has no equivalent without third-party glue.
- Bundle size: chart.js is loaded only via the client component, so it lives outside the RSC payload entirely. We control which controllers are registered (`LineController` + `LineElement` + `PointElement` + `CategoryScale` + `LinearScale` + `Tooltip` + `Filler`), which keeps the runtime cost down to what we use.

Do **not** replace chart.js with recharts, D3, ECharts, Visx, Nivo, or anything else without team-lead sign-off.

## The `ensureChartRegistered` pattern

```ts
let registered = false;

export async function ensureChartRegistered() {
  if (registered) return;
  Chart.register(LineController, LineElement, /* … */);
  if (typeof window !== "undefined") {
    const zoomPlugin = (await import("chartjs-plugin-zoom")).default;
    Chart.register(zoomPlugin);
  }
  registered = true;
}
```

Two reasons this exists:

1. **`Chart.register` must run exactly once.** Calling it twice silently overwrites previous controllers and is a known source of "scale is not registered" errors after hot reload. The module-level `registered` flag handles that — Next dev server can re-mount the module without re-registering.
2. **`chartjs-plugin-zoom` cannot be statically imported.** It binds wheel listeners at module-eval time and dies in any non-browser environment (including the RSC tree-shake step). The dynamic `await import('chartjs-plugin-zoom')` inside the `typeof window !== 'undefined'` guard is the only safe way to load it.

`TimeseriesLine` calls `ensureChartRegistered()` inside `useEffect`, gates the `<Line>` render behind a `ready` state, and shows nothing until registration completes. The `cancelled` flag prevents a `setState` after unmount during fast navigations.

## Null-safety in tooltips

Tooltip callbacks must coalesce `ctx.parsed.y` because chart.js types it as `number | null` (`null` happens during animations and when a datum is intentionally absent):

```ts
label: (ctx) => formatMetricValue(ctx.parsed.y ?? 0, metric),
```

Forget the `?? 0` and you'll see `NaN` rendered for the millisecond a transition is in flight. This is exactly the kind of thing the strict TS config catches at build time — don't `as number` your way past it.

## Variants — `full` vs `card`

Same component, two presets controlled by the `variant` prop:

| Concern | `full` | `card` |
|---------|--------|--------|
| Axes | shown | hidden |
| Grid | shown | hidden |
| Tooltip | enabled | disabled (sparkline) |
| Zoom plugin | wheel + pinch + pan | disabled |
| Point hover radius | 3px | 0 (no hover) |
| Line width | 2px | 1.5px |
| Container height | `h-72` | `h-full` (parent decides) |

Sparklines in `StatsCards` use `variant="card"` and live inside an `h-12` wrapper. The big dashboard chart uses `variant="full"` and renders inside an `h-72` div.

When you add a new chart type, mirror this two-variant pattern unless the design says otherwise — it keeps the bundle and the API surface small.

## Adding a new metric

`ChartMetric` in `chart-config.ts` is the source of truth. To add a metric:

1. Extend the `ChartMetric` union.
2. Extend `formatMetricValue` with the correct number format (decimals, `$` prefix, etc.).
3. Pass the new value as the `metric` prop.

The current metric set includes chain-scoped `volume_native` plus deprecated `volume_atom`. `AsyncTimeseries` may request `volume_native` only with a non-null chain and server-renders the summarized coverage disclosure below full charts. The client chart still receives only `date`/`value`; do not push freshness or coverage state into Chart.js.

The Y-axis tick callback automatically picks up the new format because it calls back into `formatMetricValue`. Do not duplicate formatting logic at the call site — fix the formatter.

## Adding a new chart type

If you genuinely need a bar/area/scatter:

1. Add the controller to the `Chart.register(...)` call inside `ensureChartRegistered`.
2. Add a sibling component (e.g. `daily-bar.tsx`) — do not stretch `TimeseriesLine` to do bars.
3. Reuse `CHART_COLOR`, `buildGradient`, and the `variant` discriminator pattern.

## What not to add

- `useChart` / `useChartInstance` custom hooks — `react-chartjs-2` already covers our needs.
- Animation timelines — `animation: false` is intentional; transitions on 30 points cause jank on weaker devices and we have nothing to animate semantically.
- `Chart.register(...registerables)` — that pulls in every controller, every element, every scale. We register only what we use.
