'use client';

import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';

let registered = false;

export async function ensureChartRegistered() {
  if (registered) return;
  Chart.register(
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Filler,
  );
  if (typeof window !== 'undefined') {
    const zoomPlugin = (await import('chartjs-plugin-zoom')).default;
    Chart.register(zoomPlugin);
  }
  registered = true;
}

export type ChartVariant = 'full' | 'card';
export type ChartMetric = 'transfers' | 'volume_atom' | 'volume_native' | 'volume_usd';

const HIGHLIGHT = '#4FB848';
const HIGHLIGHT_FAINT = 'rgba(79, 184, 72, 0.06)';
const GRID = 'rgba(62, 62, 62, 0.5)';
const TICK = 'rgba(255, 255, 255, 0.55)';

export function formatMetricValue(value: number, metric: ChartMetric) {
  if (metric === 'transfers') {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (metric === 'volume_usd') {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function buildOptions(variant: ChartVariant, metric: ChartMetric): ChartOptions<'line'> {
  const isCard = variant === 'card';

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: !isCard,
        backgroundColor: '#1e1e1e',
        borderColor: '#3e3e3e',
        borderWidth: 1,
        titleColor: HIGHLIGHT,
        bodyColor: '#ffffff',
        titleFont: { family: 'var(--font-sfpro)', size: 11, weight: 600 },
        bodyFont: { family: 'var(--font-handjet)', size: 14 },
        padding: 8,
        displayColors: false,
        callbacks: {
          label: (ctx) => formatMetricValue(ctx.parsed.y ?? 0, metric),
        },
      },
      zoom: isCard
        ? { pan: { enabled: false }, zoom: { wheel: { enabled: false } } }
        : {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
            },
          },
    },
    scales: {
      x: {
        display: !isCard,
        grid: { display: !isCard, color: GRID },
        ticks: {
          color: TICK,
          font: { family: 'var(--font-sfpro)', size: 11 },
          maxRotation: 0,
          autoSkipPadding: 16,
        },
      },
      y: {
        display: !isCard,
        beginAtZero: true,
        grid: { display: !isCard, color: GRID },
        ticks: {
          color: TICK,
          font: { family: 'var(--font-handjet)', size: 11 },
          callback: (value) => formatMetricValue(Number(value), metric),
        },
      },
    },
    elements: {
      point: { radius: 0, hoverRadius: isCard ? 0 : 3 },
      line: { borderWidth: isCard ? 1.5 : 2, tension: 0.25 },
    },
  };
}

export function buildGradient(
  ctx: CanvasRenderingContext2D,
  chartArea: { top: number; bottom: number },
) {
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, 'rgba(79, 184, 72, 0.35)');
  gradient.addColorStop(1, HIGHLIGHT_FAINT);
  return gradient;
}

export const CHART_COLOR = HIGHLIGHT;
