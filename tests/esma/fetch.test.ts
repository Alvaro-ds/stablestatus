import { describe, it, expect, vi, beforeEach } from "vitest";

import { FetchError, fetchEsmaCsv, HtmlResponseError, HttpError } from "../../src/esma/fetch.js";
import { ESMA_URLS } from "../../src/esma/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CSV_CONTENT = "col1,col2\r\nval1,val2\r\n";

function csvResponse(body = CSV_CONTENT) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// ESMA_URLS — smoke test to catch accidental URL changes
// ---------------------------------------------------------------------------

describe("ESMA_URLS", () => {
  it("contains EMTWP url", () => {
    expect(ESMA_URLS.EMTWP).toBe(
      "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv"
    );
  });

  it("contains ARTZZ url", () => {
    expect(ESMA_URLS.ARTZZ).toBe(
      "https://www.esma.europa.eu/sites/default/files/2024-12/ARTZZ.csv"
    );
  });
});

// ---------------------------------------------------------------------------
// fetchEsmaCsv
// ---------------------------------------------------------------------------

describe("fetchEsmaCsv", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- Happy path ---

  it("returns buffer on success", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(csvResponse());

    const result = await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe(CSV_CONTENT);
  });

  it("includes identifying User-Agent header", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(csvResponse());

    await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch });

    const firstCall = mockFetch.mock.calls[0]!;
    const init = firstCall[1] as RequestInit;
    const calledHeaders = init.headers as Record<string, string>;
    expect(calledHeaders["User-Agent"]).toMatch(/StableStatus-ingest/);
    expect(calledHeaders["User-Agent"]).toMatch(/github\.com/);
  });

  // --- HTML detection ---

  it("throws HtmlResponseError when content-type is text/html", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );

    await expect(fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch })).rejects.toThrow(
      HtmlResponseError
    );
  });

  it("throws HtmlResponseError when body starts with <!DOCTYPE", async () => {
    // ESMA maintenance pages sometimes arrive as application/octet-stream but contain HTML.
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })
    );

    await expect(fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch })).rejects.toThrow(
      HtmlResponseError
    );
  });

  it("throws HtmlResponseError for text/html content-type even when body is not HTML", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(CSV_CONTENT, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );

    await expect(fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch })).rejects.toThrow(
      HtmlResponseError
    );
  });

  it("detects HTML body case-insensitively", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("<!doctype html><html></html>", {
        status: 200,
        headers: { "content-type": "text/csv" },
      })
    );

    await expect(fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch })).rejects.toThrow(
      HtmlResponseError
    );
  });

  // --- HTTP errors ---

  it("throws HttpError on non-200 HTTP status", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));

    await expect(fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 })).rejects.toThrow(
      HttpError
    );
  });

  it("does not retry on 4xx client error", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));

    await expect(fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 })).rejects.toThrow(
      HttpError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // --- Retry behaviour ---

  it("retries on failure and succeeds on third attempt", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(csvResponse());

    const result = await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toBeInstanceOf(Buffer);
  });

  it("retries on 5xx server error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Server Error", { status: 503 }))
      .mockResolvedValueOnce(new Response("Server Error", { status: 503 }))
      .mockResolvedValueOnce(csvResponse());

    const result = await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toBeInstanceOf(Buffer);
  });

  it("retries on 429 Too Many Requests", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }))
      .mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }))
      .mockResolvedValueOnce(csvResponse());

    const result = await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toBeInstanceOf(Buffer);
  });

  it("throws FetchError after exhausting all retries", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("persistent network error"));

    await expect(fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 })).rejects.toThrow(
      FetchError
    );
  });

  it("throws FetchError when fetch times out", async () => {
    // The mock never resolves; it listens for the AbortSignal and rejects with
    // TimeoutError, mimicking what the native fetch does on AbortSignal.timeout().
    const mockFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Timeout", "TimeoutError"));
        });
      });
    });

    await expect(
      fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, timeoutMs: 1, delayMs: 0, maxAttempts: 1 })
    ).rejects.toThrow(FetchError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff with correct absolute delays", async () => {
    const delays: number[] = [];
    const mockSleep = vi.fn((ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    });
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce(csvResponse());

    await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, sleep: mockSleep, delayMs: 10 });

    // baseDelay * 2^0 = 10, baseDelay * 2^1 = 20
    expect(delays).toEqual([10, 20]);
  });
});
