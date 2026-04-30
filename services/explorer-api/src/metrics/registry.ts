import {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  createRegistry,
  startNodeDefaultMetrics,
} from "@chicmoz-pkg/metrics-server";

export const PREFIX = "aztec_api";
export const metrics: MetricsRegistry = createRegistry(PREFIX);
startNodeDefaultMetrics(metrics);

const r = metrics.registry;

// ---- HTTP ----
const httpRequests = new Counter({
  name: `${PREFIX}_http_requests_total`,
  help: "HTTP requests served by route template, method and status class (2xx/3xx/4xx/5xx)",
  labelNames: ["route", "method", "status"] as const,
  registers: [r],
});
const httpDuration = new Histogram({
  name: `${PREFIX}_http_request_duration_seconds`,
  help: "HTTP request handling time by route template and method",
  labelNames: ["route", "method"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [r],
});
const httpInFlight = new Gauge({
  name: `${PREFIX}_http_in_flight_requests`,
  help: "Currently in-flight HTTP requests",
  registers: [r],
});

const statusClass = (code: number): string => {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  if (code >= 200) return "2xx";
  return "other";
};

export const observeHttp = (
  route: string,
  method: string,
  statusCode: number,
  durationSec: number,
) => {
  httpRequests.inc({ route, method, status: statusClass(statusCode) });
  httpDuration.observe({ route, method }, durationSec);
};
export const incHttpInFlight = () => httpInFlight.inc();
export const decHttpInFlight = () => httpInFlight.dec();

// ---- Message bus consumer ----
const busConsumed = new Counter({
  name: `${PREFIX}_message_bus_consumed_total`,
  help: "Messages consumed from Kafka by topic and status",
  labelNames: ["topic", "status"] as const,
  registers: [r],
});
const busConsumeDuration = new Histogram({
  name: `${PREFIX}_message_bus_consume_duration_seconds`,
  help: "Time spent processing a single message",
  labelNames: ["topic"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [r],
});
export const observeBusConsume = (
  topic: string,
  status: "ok" | "error",
  durationSec: number,
) => {
  busConsumed.inc({ topic, status });
  busConsumeDuration.observe({ topic }, durationSec);
};
