import logger from '../logger';

const log = logger('upstream-client');

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1500;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly body: string | null,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const buildUrl = (baseUrl: string, path: string, params?: Record<string, string | number | undefined | null>): string => {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(trimmedBase + trimmedPath);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

export const fetchUpstream = async <T>(
  path: string,
  params?: Record<string, string | number | undefined | null>,
): Promise<T> => {
  const baseUrl = process.env.UPSTREAM_INDEXER_BASE_URL;
  const apiKey = process.env.UPSTREAM_INDEXER_API_KEY;
  if (!baseUrl) throw new Error('UPSTREAM_INDEXER_BASE_URL is not set');
  if (!apiKey) throw new Error('UPSTREAM_INDEXER_API_KEY is not set');

  const url = buildUrl(baseUrl, path, params);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          accept: 'application/json',
        },
      });

      if (response.status === 429) {
        log.logWarn(`upstream 429 on ${path}, sleeping ${RATE_LIMIT_COOLDOWN_MS}ms`, { attempt });
        await sleep(RATE_LIMIT_COOLDOWN_MS);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => null);
        throw new UpstreamError(`upstream ${response.status} on ${path}`, response.status, body);
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        log.logWarn(`upstream fetch ${path} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS}ms`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  log.logError(`upstream fetch ${path} exhausted ${MAX_ATTEMPTS} attempts`, lastError);
  throw lastError instanceof Error ? lastError : new Error(`upstream fetch ${path} failed`);
};

export { UpstreamError };
