export type ApiErrorCode =
  | "bad_request"
  | "not_found"
  | "network_disabled"
  | "indexer_unavailable"
  | "indexer_timeout"
  | "indexer_error"
  | "parse_error";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  network_disabled: 400,
  indexer_unavailable: 503,
  indexer_timeout: 504,
  indexer_error: 502,
  parse_error: 502,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonOk(body: unknown, headers: Record<string, string> = NO_STORE): Response {
  return Response.json(body, { headers });
}

export function jsonError(error: unknown): Response {
  const apiError =
    error instanceof ApiError ? error : new ApiError("indexer_error", "unexpected server error");
  return Response.json(
    { code: apiError.code, message: apiError.message },
    { status: STATUS_BY_CODE[apiError.code], headers: NO_STORE },
  );
}
