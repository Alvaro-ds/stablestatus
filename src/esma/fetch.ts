import {
  USER_AGENT,
  FETCH_MAX_ATTEMPTS,
  FETCH_BASE_DELAY_MS,
} from "./constants.js";

export class HtmlResponseError extends Error {
  constructor(url: string, detail: string) {
    super(`ESMA returned HTML instead of CSV for ${url}: ${detail}`);
    this.name = "HtmlResponseError";
  }
}

export class HttpError extends Error {
  constructor(
    url: string,
    public readonly status: number,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpError";
  }
}

export class FetchError extends Error {
  constructor(
    url: string,
    public readonly attempts: number,
    cause?: unknown,
  ) {
    super(`Failed to fetch ${url} after ${attempts} attempt(s)`);
    this.name = "FetchError";
    if (cause instanceof Error) this.cause = cause;
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
type SleepFn = (ms: number) => Promise<void>;

export interface FetchOptions {
  fetch?: FetchFn;
  sleep?: SleepFn;
  delayMs?: number;
  maxAttempts?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptFetch(url: string, fetchFn: FetchFn): Promise<Buffer> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new HttpError(url, response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new HtmlResponseError(url, `content-type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  const preview = buf.slice(0, 15).toString("ascii");
  if (
    preview.trimStart().startsWith("<!DOCTYPE") ||
    preview.trimStart().startsWith("<html")
  ) {
    throw new HtmlResponseError(url, "body starts with HTML tag");
  }

  return buf;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HtmlResponseError) return false;
  if (err instanceof HttpError) return err.status >= 500;
  return true;
}

export async function fetchEsmaCsv(
  url: string,
  options: FetchOptions = {},
): Promise<Buffer> {
  const fetchFn = options.fetch ?? (globalThis.fetch as FetchFn);
  const sleepFn = options.sleep ?? defaultSleep;
  const baseDelay = options.delayMs ?? FETCH_BASE_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? FETCH_MAX_ATTEMPTS;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await attemptFetch(url, fetchFn);
    } catch (err) {
      if (!isRetryable(err)) throw err;

      lastError = err;

      if (attempt < maxAttempts - 1) {
        await sleepFn(baseDelay * Math.pow(2, attempt));
      }
    }
  }

  throw new FetchError(url, maxAttempts, lastError);
}
