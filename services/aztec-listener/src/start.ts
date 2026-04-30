import { startPoller } from "./svcs/poller/index.js";
import { startHealthServer } from "./health.js";
import { startMetricsSampler } from "./metrics/sampler.js";

// eslint-disable-next-line @typescript-eslint/require-await
export const start = async () => {
  startHealthServer();
  startMetricsSampler();
  await startPoller();
};
