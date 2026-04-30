import type { NextFunction, Request, Response } from "express";
import {
  decHttpInFlight,
  incHttpInFlight,
  observeHttp,
} from "./registry.js";

/**
 * Express middleware that records HTTP-level metrics. Uses the matched route template
 * (`req.route?.path`) to keep label cardinality bounded — never the raw URL.
 */
export const httpMetricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startedAt = process.hrtime.bigint();
  incHttpInFlight();
  let finalized = false;
  const finalize = (recordObserve: boolean) => {
    if (finalized) return;
    finalized = true;
    decHttpInFlight();
    if (!recordObserve) return;
    const route =
      (req.route as { path?: string } | undefined)?.path ??
      (req.baseUrl ? `${req.baseUrl}*` : "unmatched");
    observeHttp(
      typeof route === "string" ? route : "unmatched",
      req.method,
      res.statusCode,
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  };
  res.on("finish", () => finalize(true));
  res.on("close", () => finalize(false));
  next();
};
