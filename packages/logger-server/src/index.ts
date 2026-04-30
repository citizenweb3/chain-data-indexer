import autoBind from "auto-bind";
import winston from "winston";

const resolveFormat = (): winston.Logform.Format => {
  const fmt = (process.env.LOG_FORMAT ?? "pretty").toLowerCase();
  if (fmt === "json") {
    return winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf((info) => {
        const { timestamp, level, label, message, ...rest } = info as Record<
          string,
          unknown
        > & { timestamp?: string; level: string; label?: string };
        const payload: Record<string, unknown> = {
          ts: timestamp,
          level,
          label,
        };
        if (Array.isArray(message) && message.length === 1) {
          const only = message[0];
          if (typeof only === "string") {
            payload.message = only;
          } else if (only && typeof only === "object") {
            const { msg, message: m2, ...md } = only as Record<string, unknown>;
            payload.message = (msg ?? m2 ?? "") as unknown;
            if (Object.keys(md).length > 0) payload.metadata = md;
          } else {
            payload.message = only;
          }
        } else {
          payload.message = message;
        }
        if (Object.keys(rest).length > 0) {
          payload.metadata = { ...(payload.metadata as object | undefined), ...rest };
        }
        return JSON.stringify(payload);
      }),
    );
  }
  return winston.format.cli();
};

export class Logger {
  #logger: winston.Logger;

  constructor(name: string) {
    autoBind(this);
    this.#logger = winston.createLogger({
      format: resolveFormat(),
      transports: [new winston.transports.Console()],
      defaultMeta: { label: name },
    });
  }

  debug(...data: unknown[]) {
    // TODO: we need to disable debug logs in production
    this.#logger.debug(data);
  }

  info(...data: unknown[]) {
    this.#logger.info(data);
  }

  error(...data: unknown[]) {
    this.#logger.error(data);
  }

  warn(...data: unknown[]) {
    this.#logger.warn(data);
  }
}
