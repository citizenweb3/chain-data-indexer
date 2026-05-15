import { ZodError, ZodType } from 'zod';

export type ApiErrorCode = 'invalid_params' | 'not_found' | 'internal_error';

const jsonHeaders = (cacheControl: string): HeadersInit => ({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': cacheControl,
});

export const errorResponse = (
  code: ApiErrorCode,
  status: number,
  details?: unknown,
): Response => {
  const body = details === undefined ? { error: code } : { error: code, details };
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders('no-store'),
  });
};

export const okJson = (payload: unknown, cacheControl: string): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: jsonHeaders(cacheControl),
  });

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

const flattenZodError = (err: ZodError): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_';
    (out[path] ??= []).push(issue.message);
  }
  return out;
};

export const parseSearchParams = <T>(
  schema: ZodType<T>,
  request: Request,
): ParseResult<T> => {
  const url = new URL(request.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) raw[k] = v;
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: errorResponse('invalid_params', 400, flattenZodError(result.error)) };
  }
  return { ok: true, data: result.data };
};

export const parseRouteParams = <T>(schema: ZodType<T>, raw: unknown): ParseResult<T> => {
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: errorResponse('invalid_params', 400, flattenZodError(result.error)) };
  }
  return { ok: true, data: result.data };
};
