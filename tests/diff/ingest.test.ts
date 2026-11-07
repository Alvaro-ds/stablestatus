import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runIngest } from "../../src/cli/ingest.js";

const BASE_CSV = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "esma",
  "EMTWP_2026-10-30.csv"
);
const WITHDRAWAL_CSV = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "esma",
  "variants",
  "withdrawal.csv"
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

function opts(csvPath: string, date = "2026-11-07") {
  return {
    fromFile: csvPath,
    date,
    dataDir,
    changelogPath,
    now: NOW,
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
// Idempotency
// ---------------------------------------------------------------------------

describe("runIngest — idempotency", () => {
  it("second run with same file is skipped (same hash)", async () => {
    await runIngest(opts(BASE_CSV));
    const result2 = await runIngest(opts(BASE_CSV));
    expect(result2.skipped).toBe(true);
    expect(result2.reason).toBe("same_hash");
  });

  it("changes.jsonl is not extended on a skipped run", async () => {
    await runIngest(opts(BASE_CSV));
    const linesAfterFirst = readJsonLines(join(dataDir, "changes.jsonl")).length;
    await runIngest(opts(BASE_CSV));
    const linesAfterSecond = readJsonLines(join(dataDir, "changes.jsonl")).length;
    expect(linesAfterSecond).toBe(linesAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Withdrawal scenario
// ---------------------------------------------------------------------------

describe("runIngest — withdrawal", () => {
  it("after baseline, withdrawal run emits critical status_changed events", async () => {
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
    // First event must be the original baseline
    expect((lines[0] as { kind: string }).kind).toBe("baseline");
    // Total lines > 1
    expect(lines.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Append-only guarantee
// ---------------------------------------------------------------------------

describe("runIngest — append-only changes.jsonl", () => {
  it("events accumulate across multiple runs and old lines are never deleted", async () => {
    const WITHDRAWAL_CSV2 = join(
      import.meta.dirname,
      "..",
      "fixtures",
      "esma",
      "variants",
      "issuer_added.csv"
    );

    await runIngest(opts(BASE_CSV, "2026-11-06"));
    const afterRun1 = readJsonLines(join(dataDir, "changes.jsonl")).length;

    await runIngest(opts(WITHDRAWAL_CSV2, "2026-11-07"));
    const afterRun2 = readJsonLines(join(dataDir, "changes.jsonl")).length;

    expect(afterRun2).toBeGreaterThan(afterRun1);

    // The baseline event from run 1 must still be line 1
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
});
