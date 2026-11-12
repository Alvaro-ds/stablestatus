import {
  FETCH_BASE_DELAY_MS,
  FETCH_MAX_ATTEMPTS,
  FETCH_TIMEOUT_MS,
  USER_AGENT,
} from "../esma/constants.js";
import { FetchError, HttpError } from "../esma/fetch.js";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

/** The response is not what we asked for (e.g. an HTML page instead of a file). Not retried. */
export class UnexpectedContentError extends Error {
  constructor(url: string, contentType: string) {
    super(`Unexpected content-type "${contentType}" from ${url}`);
    this.name = "UnexpectedContentError";
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return !(err instanceof UnexpectedContentError);
}

/**
 * GETs `url` and returns the body bytes. Network errors, timeouts, 5xx and 429 are retried
 * with exponential backoff; any other HTTP error or an unexpected content-type fails at once.
 */
export async function fetchBytes(
  url: string,
  expectContentType: (contentType: string) => boolean,
  options: HttpOptions = {}
): Promise<Buffer> {
  const fetchFn = options.fetch ?? (globalThis.fetch as FetchFn);
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const delayMs = options.delayMs ?? FETCH_BASE_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? FETCH_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new HttpError(url, response.status);
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!expectContentType(contentType)) throw new UnexpectedContentError(url, contentType);
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastError = err;
      if (attempt < maxAttempts - 1) await sleep(delayMs * 2 ** attempt);
    }
  }
  throw new FetchError(url, maxAttempts, lastError);
}
