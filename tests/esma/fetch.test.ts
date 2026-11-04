import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchEsmaCsv, HtmlResponseError, FetchError, HttpError } from "../../src/esma/fetch.js";
import { ESMA_URLS } from "../../src/esma/constants.js";

describe("ESMA_URLS", () => {
  it("contains EMTWP url", () => {
    expect(ESMA_URLS.EMTWP).toBe(
      "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
    );
  });

  it("contains ARTZZ url", () => {
    expect(ESMA_URLS.ARTZZ).toBe(
      "https://www.esma.europa.eu/sites/default/files/2024-12/ARTZZ.csv",
    );
  });
});

describe("fetchEsmaCsv", () => {
  const CSV_CONTENT = "col1,col2\r\nval1,val2\r\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns buffer on success", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(CSV_CONTENT, {
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8" },
      }),
    );

    const result = await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe(CSV_CONTENT);
  });

  it("includes identifying User-Agent header", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(CSV_CONTENT, {
        status: 200,
        headers: { "content-type": "text/csv" },
      }),
    );

    await fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch });

    const firstCall = mockFetch.mock.calls[0]!;
    const init = firstCall[1] as RequestInit;
    const calledHeaders = init.headers as Record<string, string>;
    expect(calledHeaders["User-Agent"]).toMatch(/StableStatus-ingest/);
    expect(calledHeaders["User-Agent"]).toMatch(/github\.com/);
  });

  it("throws HtmlResponseError when content-type is text/html", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    await expect(
      fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch }),
    ).rejects.toThrow(HtmlResponseError);
  });

  it("throws HtmlResponseError when body starts with <!DOCTYPE", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    await expect(
      fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch }),
    ).rejects.toThrow(HtmlResponseError);
  });

  it("retries on failure and succeeds on third attempt", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        new Response(CSV_CONTENT, {
          status: 200,
          headers: { "content-type": "text/csv" },
        }),
      );

    const result = await fetchEsmaCsv(ESMA_URLS.EMTWP, {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toBeInstanceOf(Buffer);
  });

  it("throws FetchError after exhausting all retries", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("persistent network error"));

    await expect(
      fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 }),
    ).rejects.toThrow(FetchError);
  });

  it("throws HttpError on non-200 HTTP status", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    await expect(
      fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 }),
    ).rejects.toThrow(HttpError);
  });

  it("does not retry on 4xx client error", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    );

    await expect(
      fetchEsmaCsv(ESMA_URLS.EMTWP, { fetch: mockFetch, delayMs: 0 }),
    ).rejects.toThrow(HttpError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx server error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Server Error", { status: 503 }))
      .mockResolvedValueOnce(new Response("Server Error", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(CSV_CONTENT, {
          status: 200,
          headers: { "content-type": "text/csv" },
        }),
      );

    const result = await fetchEsmaCsv(ESMA_URLS.EMTWP, {
      fetch: mockFetch,
      delayMs: 0,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toBeInstanceOf(Buffer);
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
      .mockResolvedValueOnce(
        new Response(CSV_CONTENT, {
          status: 200,
          headers: { "content-type": "text/csv" },
        }),
      );

    await fetchEsmaCsv(ESMA_URLS.EMTWP, {
      fetch: mockFetch,
      sleep: mockSleep,
      delayMs: 10,
    });

    expect(delays).toEqual([10, 20]);
  });
});
