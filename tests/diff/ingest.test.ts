import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runIngest } from "../../src/cli/ingest.js";
import { ESMA_URLS } from "../../src/esma/constants.js";

const BASE_CSV = join(import.meta.dirname, "..", "fixtures", "esma", "EMTWP_2026-10-30.csv");
const WITHDRAWAL_CSV = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "esma",
  "variants",
  "withdrawal.csv"
);
const FUTURE_WITHDRAWAL_CSV = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "esma",
  "variants",
  "future_withdrawal.csv"
);

const NOW = new Date("2026-11-07T12:00:00Z");

// ---------------------------------------------------------------------------
// Setup: isolated temp directory per test
// ---------------------------------------------------------------------------

let tmpDir: string;
let dataDir: string;
let changelogPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "stablestatus-test-"));
  dataDir = join(tmpDir, "data");
  changelogPath = join(tmpDir, "CHANGELOG-data.md");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function opts(csvPath: string, date = "2026-11-07", now = NOW) {
  return {
    fromFile: csvPath,
    fetchedAt: "2026-10-30T05:00:00Z",
    date,
    dataDir,
    changelogPath,
    now,
    log: () => {},
  };
}

function readJsonLines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
}

// ---------------------------------------------------------------------------
// First run: baseline
// ---------------------------------------------------------------------------

describe("runIngest — baseline", () => {
  it("produces a single baseline event on first run", async () => {
    const result = await runIngest(opts(BASE_CSV));
    expect(result.skipped).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.kind).toBe("baseline");
  });

  it("writes issuers.json, whitepapers.json, meta.json", async () => {
    await runIngest(opts(BASE_CSV));
    expect(existsSync(join(dataDir, "current", "issuers.json"))).toBe(true);
    expect(existsSync(join(dataDir, "current", "whitepapers.json"))).toBe(true);
    expect(existsSync(join(dataDir, "current", "meta.json"))).toBe(true);
  });

  it("writes changes.jsonl with one baseline line", async () => {
    await runIngest(opts(BASE_CSV));
    const lines = readJsonLines(join(dataDir, "changes.jsonl"));
    expect(lines).toHaveLength(1);
    expect((lines[0] as { kind: string }).kind).toBe("baseline");
  });

  it("writes CHANGELOG-data.md", async () => {
    await runIngest(opts(BASE_CSV));
    expect(existsSync(changelogPath)).toBe(true);
    const content = readFileSync(changelogPath, "utf8");
    expect(content).toContain("# StableStatus Data Changelog");
    expect(content).toContain("baseline");
  });
});

// ---------------------------------------------------------------------------
// Idempotency (same CSV, same now → no events)
// ---------------------------------------------------------------------------

describe("runIngest — idempotency", () => {
  it("second run with same file and same now produces no events", async () => {
    await runIngest(opts(BASE_CSV));
    const result2 = await runIngest(opts(BASE_CSV));
    expect(result2.skipped).toBe(true);
    expect(result2.reason).toBe("no_events");
  });

  it("changes.jsonl is not extended on a no-events run", async () => {
    await runIngest(opts(BASE_CSV));
    const linesAfterFirst = readJsonLines(join(dataDir, "changes.jsonl")).length;
    await runIngest(opts(BASE_CSV));
    const linesAfterSecond = readJsonLines(join(dataDir, "changes.jsonl")).length;
    expect(linesAfterSecond).toBe(linesAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Future withdrawal: same CSV hash, different now → status_changed detected
// ---------------------------------------------------------------------------

describe("runIngest — future withdrawal (hash-idempotency regression)", () => {
  it("same CSV but later now detects withdrawal when end date passes", async () => {
    // Run 1: future_withdrawal CSV with now BEFORE the end date (2026-10-15)
    // The row has ac_authorisationEndDate = "15/10/2026" → authorised at now=2026-10-01
    await runIngest(opts(BASE_CSV, "2026-10-01", new Date("2026-10-01T12:00:00Z")));
    await runIngest(opts(FUTURE_WITHDRAWAL_CSV, "2026-10-01", new Date("2026-10-01T12:00:00Z")));

    // Run 2: same CSV, same hash — but now is AFTER end date → withdrawn
    const result = await runIngest(
      opts(FUTURE_WITHDRAWAL_CSV, "2026-11-01", new Date("2026-11-01T12:00:00Z"))
    );

    expect(result.skipped).toBe(false);
    const withdrawals = result.events.filter(
      (e) => e.kind === "status_changed" && (e as { to?: unknown }).to === "withdrawn"
    );
    expect(withdrawals.length).toBeGreaterThan(0);
    expect(withdrawals[0]!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Withdrawal scenario
// ---------------------------------------------------------------------------

describe("runIngest — withdrawal", () => {
  it("after baseline, withdrawal run emits critical events", async () => {
    await runIngest(opts(BASE_CSV, "2026-11-07"));
    const result = await runIngest(opts(WITHDRAWAL_CSV, "2026-11-08"));
    expect(result.skipped).toBe(false);
    const critical = result.events.filter((e) => e.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
  });

  it("changes.jsonl is append-only across runs", async () => {
    await runIngest(opts(BASE_CSV, "2026-11-07"));
    await runIngest(opts(WITHDRAWAL_CSV, "2026-11-08"));
    const lines = readJsonLines(join(dataDir, "changes.jsonl"));
    expect((lines[0] as { kind: string }).kind).toBe("baseline");
    expect(lines.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Append-only guarantee
// ---------------------------------------------------------------------------

describe("runIngest — append-only changes.jsonl", () => {
  it("events accumulate across multiple runs and old lines are never deleted", async () => {
    const ISSUER_ADDED_CSV = join(
      import.meta.dirname,
      "..",
      "fixtures",
      "esma",
      "variants",
      "issuer_added.csv"
    );

    await runIngest(opts(BASE_CSV, "2026-11-06"));
    const afterRun1 = readJsonLines(join(dataDir, "changes.jsonl")).length;

    await runIngest(opts(ISSUER_ADDED_CSV, "2026-11-07"));
    const afterRun2 = readJsonLines(join(dataDir, "changes.jsonl")).length;

    expect(afterRun2).toBeGreaterThan(afterRun1);
    const lines = readJsonLines(join(dataDir, "changes.jsonl"));
    expect((lines[0] as { kind: string }).kind).toBe("baseline");
  });
});

// ---------------------------------------------------------------------------
// Error handling: invalid date
// ---------------------------------------------------------------------------

describe("runIngest — validation", () => {
  it("throws on invalid date format", async () => {
    await expect(runIngest({ ...opts(BASE_CSV), date: "07-11-2026" })).rejects.toThrow(
      "Invalid date format"
    );
  });

  it("throws when --from-file is set but fetchedAt is missing", async () => {
    const o = opts(BASE_CSV);
    const withoutFetchedAt = {
      fromFile: o.fromFile,
      date: o.date,
      dataDir: o.dataDir,
      changelogPath: o.changelogPath,
      now: o.now,
      log: o.log,
    };
    await expect(runIngest(withoutFetchedAt)).rejects.toThrow("--fetched-at");
  });

  it("throws when --from-file path is inside data directory", async () => {
    const insideData = join(dataDir, "raw", "2026-10-30", "EMTWP.csv");
    await expect(runIngest({ ...opts(BASE_CSV), fromFile: insideData })).rejects.toThrow(
      "--from-file path must not be inside the data directory"
    );
  });
});

// ---------------------------------------------------------------------------
// Provenance: retrieval field in meta.json
// ---------------------------------------------------------------------------

describe("runIngest — provenance", () => {
  it("file-based run stores retrieval=file and correct fetchedAt in meta.json", async () => {
    await runIngest(opts(BASE_CSV));
    const meta = JSON.parse(readFileSync(join(dataDir, "current", "meta.json"), "utf8")) as {
      sources: Array<{ retrieval: string; fetchedAt: string }>;
    };
    expect(meta.sources[0]?.retrieval).toBe("file");
    expect(meta.sources[0]?.fetchedAt).toBe("2026-10-30T05:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// Manifest always written (paso 3)
// ---------------------------------------------------------------------------

describe("runIngest — manifest always written", () => {
  it("writes manifest.json even when there are no structural changes (second run)", async () => {
    await runIngest(opts(BASE_CSV, "2026-11-06"));
    // Second run: same CSV, same now → no events, but manifest must still be written.
    await runIngest(opts(BASE_CSV, "2026-11-07"));
    const manifestPath = join(dataDir, "raw", "2026-11-07", "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
  });

  it("writes manifest.json on first run (baseline)", async () => {
    await runIngest(opts(BASE_CSV, "2026-11-07"));
    const manifestPath = join(dataDir, "raw", "2026-11-07", "manifest.json");
    expect(existsSync(manifestPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Consistency check: current/ and changes.jsonl must coexist (paso 3)
// ---------------------------------------------------------------------------

describe("runIngest — state consistency check", () => {
  it("throws when current/ exists but changes.jsonl is missing", async () => {
    // Create a valid first run.
    await runIngest(opts(BASE_CSV, "2026-11-07"));
    // Manually delete changes.jsonl to simulate inconsistency.
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(dataDir, "changes.jsonl"));
    await expect(runIngest(opts(BASE_CSV, "2026-11-08"))).rejects.toThrow("Inconsistent state");
  });
});

// ---------------------------------------------------------------------------
// Helpers for HTTP-mode tests (injectable fetch)
// ---------------------------------------------------------------------------

const ARTZZ_HEADER = Buffer.from(
  "ae_competentAuthority,ae_homeMemberState,ae_lei_name,ae_lei,ae_lei_cou_code," +
    "ae_commercial_name,ae_address,ae_website,ac_authorisationNotificationDate," +
    "ac_authorisationEndDate,ae_credit_institution,wp_url,wp_authorisationNotificationDate," +
    "wp_url_cou,wp_comments,wp_lastupdate\r\n"
);

const ARTZZ_WITH_ROW = Buffer.from(
  "ae_competentAuthority,ae_homeMemberState,ae_lei_name,ae_lei,ae_lei_cou_code," +
    "ae_commercial_name,ae_address,ae_website,ac_authorisationNotificationDate," +
    "ac_authorisationEndDate,ae_credit_institution,wp_url,wp_authorisationNotificationDate," +
    "wp_url_cou,wp_comments,wp_lastupdate\r\n" +
    "AMF,FR,Test ART SA,TESTARTISSUER0000001,FR,TestART,,https://test.example.com," +
    "01/01/2026,,no,https://test.example.com/wp,01/01/2026,FR,,\r\n"
);

function httpOpts(fetchFn: (url: string) => Promise<Buffer>) {
  return {
    dataDir,
    changelogPath,
    fetch: fetchFn,
    log: () => {},
  };
}

// ---------------------------------------------------------------------------
// Corrupted state: meta.json with invalid JSON throws and writes nothing
// ---------------------------------------------------------------------------

describe("runIngest — corrupted previous state", () => {
  it("throws when meta.json is invalid JSON and does not write manifest", async () => {
    await runIngest(opts(BASE_CSV, "2026-11-06"));
    writeFileSync(join(dataDir, "current", "meta.json"), "{not valid json", "utf8");

    await expect(runIngest(opts(BASE_CSV, "2026-11-07"))).rejects.toThrow("zod validation");

    // No manifest for 2026-11-07 — loadPreviousState threw before Step 6.
    expect(existsSync(join(dataDir, "raw", "2026-11-07", "manifest.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ARTZZ signal: one row → art_register_non_empty critical
// ---------------------------------------------------------------------------

describe("runIngest — ARTZZ signal", () => {
  it("emits art_register_non_empty (critical) when ARTZZ has a data row", async () => {
    const emtwpBuf = readFileSync(BASE_CSV);
    const result = await runIngest(
      httpOpts(async (url) => (url === ESMA_URLS.ARTZZ ? ARTZZ_WITH_ROW : emtwpBuf))
    );
    const ev = result.events.find((e) => e.kind === "art_register_non_empty");
    expect(ev).toBeDefined();
    expect(ev?.severity).toBe("critical");
  });

  it("does not emit art_register_non_empty when ARTZZ is header-only", async () => {
    const emtwpBuf = readFileSync(BASE_CSV);
    const result = await runIngest(
      httpOpts(async (url) => (url === ESMA_URLS.ARTZZ ? ARTZZ_HEADER : emtwpBuf))
    );
    expect(result.events.some((e) => e.kind === "art_register_non_empty")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real-time now: HTTP mode uses new Date() — fake timers trigger withdrawal
// ---------------------------------------------------------------------------

describe("runIngest — real-time now (HTTP mode)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects withdrawal when end date passes, using new Date() from fake timers", async () => {
    // Baseline before the withdrawal date (future_withdrawal.csv has end=15/10/2026).
    await runIngest(opts(BASE_CSV, "2026-10-01", new Date("2026-10-01T12:00:00Z")));
    await runIngest(opts(FUTURE_WITHDRAWAL_CSV, "2026-10-01", new Date("2026-10-01T12:00:00Z")));

    // Fake time to after the end date — HTTP mode will use new Date() for now.
    vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });

    const withdrawalBuf = readFileSync(FUTURE_WITHDRAWAL_CSV);
    const result = await runIngest(
      httpOpts(async (url) => (url === ESMA_URLS.ARTZZ ? ARTZZ_HEADER : withdrawalBuf))
    );

    expect(result.skipped).toBe(false);
    const withdrawals = result.events.filter(
      (e) => e.kind === "status_changed" && (e as { to?: unknown }).to === "withdrawn"
    );
    expect(withdrawals.length).toBeGreaterThan(0);
    expect(withdrawals[0]!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Run summary: data/last-run.json
// ---------------------------------------------------------------------------

describe("runIngest — last-run.json", () => {
  interface LastRun {
    at: string;
    status: string;
    events: number;
    critical: number;
    emtwpSha256: string;
    artzzSha256: string | null;
  }

  function readLastRun(): LastRun {
    return JSON.parse(readFileSync(join(dataDir, "last-run.json"), "utf8")) as LastRun;
  }

  it("writes a summary with zero events on a no-change run", async () => {
    await runIngest(opts(BASE_CSV));
    await runIngest(opts(BASE_CSV));
    const summary = readLastRun();
    expect(summary).toMatchObject({ status: "ok", events: 0, critical: 0, artzzSha256: null });
    expect(summary.emtwpSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof summary.at).toBe("string");
  });

  it("counts events and critical events, with both hashes in HTTP mode", async () => {
    await runIngest(opts(BASE_CSV));
    const withdrawalBuf = readFileSync(WITHDRAWAL_CSV);
    const result = await runIngest(
      httpOpts(async (url) => (url === ESMA_URLS.ARTZZ ? ARTZZ_HEADER : withdrawalBuf))
    );
    const summary = readLastRun();
    expect(summary.events).toBe(result.events.length);
    expect(summary.critical).toBe(result.events.filter((e) => e.severity === "critical").length);
    expect(summary.critical).toBeGreaterThan(0);
    expect(summary.artzzSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
