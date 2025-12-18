import { startPoller } from "./svcs/poller/index.js";
import { startHealthServer } from "./health.js";

// eslint-disable-next-line @typescript-eslint/require-await
export const start = async () => {
  startHealthServer();
  await startPoller();
};
