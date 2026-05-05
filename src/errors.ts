export type ApiErrorCode = 'invalid_params' | 'unauthorized' | 'not_found' | 'internal_error';

export function errorResponse(code: ApiErrorCode, status: number, details?: unknown) {
  const body: Record<string, unknown> = { error: code };
  if (details !== undefined) body['details'] = details;
  return Response.json(body, { status });
}
