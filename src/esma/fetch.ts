import {
  USER_AGENT,
  FETCH_MAX_ATTEMPTS,
  FETCH_BASE_DELAY_MS,
  FETCH_TIMEOUT_MS,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** ESMA responded with HTML instead of CSV (e.g. a maintenance or login page). */
export class HtmlResponseError extends Error {
  constructor(url: string, detail: string) {
    super(`ESMA returned HTML instead of CSV for ${url}: ${detail}`);
    this.name = "HtmlResponseError";
  }
}

/** Server returned a non-2xx HTTP status. */
export class HttpError extends Error {
  constructor(
    url: string,
    public readonly status: number
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpError";
  }
}

/** All retry attempts failed. Wraps the last underlying error as `cause`. */
export class FetchError extends Error {
  constructor(
    url: string,
    public readonly attempts: number,
    cause?: unknown
  ) {
    super(`Failed to fetch ${url} after ${attempts} attempt(s)`);
    this.name = "FetchError";
    if (cause instanceof Error) this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
type SleepFn = (ms: number) => Promise<void>;

/** Override defaults in tests or to tune behaviour without touching constants. */
export interface FetchOptions {
  fetch?: FetchFn;
  sleep?: SleepFn;
  /** Base delay for exponential backoff in ms. Defaults to FETCH_BASE_DELAY_MS. */
  delayMs?: number;
  maxAttempts?: number;
  /** Per-attempt timeout in ms. Resets on each retry. Defaults to FETCH_TIMEOUT_MS. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes a single HTTP request and returns the body as a Buffer.
 * Throws HtmlResponseError if the response looks like a web page rather than a CSV.
 */
async function attemptFetch(url: string, fetchFn: FetchFn, timeoutMs: number): Promise<Buffer> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT },
    // Per-attempt timeout: if ESMA is slow on this attempt we abort and retry.
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new HttpError(url, response.status);
  }

  // Check content-type header first — faster than reading the full body.
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("text/html")) {
    throw new HtmlResponseError(url, `content-type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  // Also inspect the first bytes in case content-type is wrong (e.g. ESMA maintenance pages
  // sometimes come back as application/octet-stream but contain an HTML document).
  const preview = buf.subarray(0, 15).toString("ascii").trimStart().toLowerCase();
  if (preview.startsWith("<!doctype") || preview.startsWith("<html")) {
    throw new HtmlResponseError(url, "body starts with HTML tag");
  }

  return buf;
}

/**
 * Returns false for errors we should not retry:
 *   - HtmlResponseError: a maintenance page won't go away on the next attempt.
 *   - 4xx (except 429): the request itself is wrong; retrying won't help.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof HtmlResponseError) return false;
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Downloads an ESMA CSV file with exponential backoff retries.
 *
 * Retry policy:
 *   - Network errors, timeouts, 5xx, 429 → retried up to maxAttempts.
 *   - 4xx (except 429) and HTML responses → thrown immediately (not retried).
 *
 * Throws FetchError if all attempts are exhausted, wrapping the last error as cause.
 */
export async function fetchEsmaCsv(url: string, options: FetchOptions = {}): Promise<Buffer> {
  const fetchFn = options.fetch ?? (globalThis.fetch as FetchFn);
  const sleepFn = options.sleep ?? defaultSleep;
  const baseDelay = options.delayMs ?? FETCH_BASE_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? FETCH_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await attemptFetch(url, fetchFn, timeoutMs);
    } catch (err) {
      if (!isRetryable(err)) throw err;

      lastError = err;

      if (attempt < maxAttempts - 1) {
        await sleepFn(baseDelay * 2 ** attempt);
      }
    }
  }

  throw new FetchError(url, maxAttempts, lastError);
}
