"use client";

import type { ChartData } from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  CHART_COLOR,
  buildGradient,
  buildOptions,
  ensureChartRegistered,
  type ChartMetric,
  type ChartVariant,
} from "@/components/charts/chart-config";
import { cn } from "@/utils/cn";

export interface TimeseriesPoint {
  date: string;
  value: string | number;
}

interface TimeseriesLineProps {
  data: TimeseriesPoint[];
  metric: ChartMetric;
  variant?: ChartVariant;
  className?: string;
}

const formatDateLabel = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hasTime = iso.includes("T");
  if (hasTime) {
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
};

export default function TimeseriesLine({
  data,
  metric,
  variant = "full",
  className,
}: TimeseriesLineProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ensureChartRegistered().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = useMemo<ChartData<"line">>(() => {
    const labels = data.map((p) => formatDateLabel(p.date));
    const values = data.map((p) =>
      typeof p.value === "string" ? Number(p.value) : p.value,
    );
    return {
      labels,
      datasets: [
        {
          data: values,
          borderColor: CHART_COLOR,
          backgroundColor: (ctx) => {
            const { ctx: canvas, chartArea } = ctx.chart;
            if (!chartArea) return "rgba(79, 184, 72, 0.15)";
            return buildGradient(canvas, chartArea);
          },
          fill: true,
          pointBackgroundColor: CHART_COLOR,
          pointBorderColor: CHART_COLOR,
        },
      ],
    };
  }, [data]);

  const options = useMemo(
    () => buildOptions(variant, metric),
    [variant, metric],
  );

  return (
    <div
      className={cn(
        "relative w-full",
        variant === "card" ? "h-full" : "h-72",
        className,
      )}
    >
      {ready && <Line data={chartData} options={options} />}
    </div>
  );
}
