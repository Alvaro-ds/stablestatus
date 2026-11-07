import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEsmaCsv } from "../../src/esma/parse.js";
import { computeSha256 } from "../../src/esma/store.js";
import { normalizeEmtwp } from "../../src/normalize/index.js";
import { diffNormalized } from "../../src/diff/diff.js";
import type { NormalizeResult } from "../../src/normalize/index.js";
import type { SourceSnapshot } from "../../src/model/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "esma");
const BASE = join(FIXTURES, "EMTWP_2026-10-30.csv");
const VARIANTS = join(FIXTURES, "variants");

const NOW = new Date("2026-11-07T00:00:00Z");
const DATE = "2026-11-07";
const CTX = { at: "2026-11-07T12:00:00Z", snapshotSha256: "a".repeat(64) };

function normalize(csvPath: string): NormalizeResult {
  const buf = readFileSync(csvPath);
  const parseResult = parseEsmaCsv(buf, "EMTWP");
  const snapshot: SourceSnapshot = {
    url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
    fetchedAt: "2026-11-07T12:00:00Z",
    sha256: computeSha256(buf),
    sizeBytes: buf.length,
    rowCount: parseResult.rows.length,
    retrieval: "file",
  };
  return normalizeEmtwp(parseResult, snapshot, DATE, NOW);
}

const baseResult = normalize(BASE);

// ---------------------------------------------------------------------------
// Baseline (first run — no previous state)
// ---------------------------------------------------------------------------

describe("diffNormalized — baseline", () => {
  it("returns a single baseline event when prev is null", () => {
    const events = diffNormalized(null, baseResult, CTX);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("baseline");
    expect(events[0]!.entity).toBe("system");
    expect(events[0]!.key).toBe("baseline");
    expect(events[0]!.severity).toBe("info");
  });

  it("baseline event carries the snapshotSha256", () => {
    const events = diffNormalized(null, baseResult, CTX);
    expect(events[0]!.snapshotSha256).toBe(CTX.snapshotSha256);
  });
});

// ---------------------------------------------------------------------------
// Idempotency (same input → no events)
// ---------------------------------------------------------------------------

describe("diffNormalized — idempotency", () => {
  it("returns 0 events when prev and next are identical (provenance ignored)", () => {
    // Build next with different provenance (different fetchedAt / snapshotSha256)
    const buf = readFileSync(BASE);
    const parseResult = parseEsmaCsv(buf, "EMTWP");
    const differentSnapshot: SourceSnapshot = {
      url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
      fetchedAt: "2026-11-08T06:00:00Z",
      sha256: "b".repeat(64),
      sizeBytes: buf.length,
      rowCount: parseResult.rows.length,
      retrieval: "file",
    };
    const nextResult = normalizeEmtwp(parseResult, differentSnapshot, DATE, NOW);
    const events = diffNormalized(baseResult, nextResult, CTX);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Withdrawal (status_changed → withdrawn, severity critical)
// ---------------------------------------------------------------------------

describe("diffNormalized — withdrawal", () => {
  it("emits at least one status_changed event with to=withdrawn", () => {
    const next = normalize(join(VARIANTS, "withdrawal.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const changed = events.filter((e) => e.kind === "status_changed" && e.to === "withdrawn");
    expect(changed.length).toBeGreaterThan(0);
  });

  it("all withdrawn status_changed events have severity critical", () => {
    const next = normalize(join(VARIANTS, "withdrawal.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const changed = events.filter((e) => e.kind === "status_changed" && e.to === "withdrawn");
    changed.forEach((e) => expect(e.severity).toBe("critical"));
  });

  it("no issuer_delisted events", () => {
    const next = normalize(join(VARIANTS, "withdrawal.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    expect(events.filter((e) => e.kind === "issuer_delisted")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Whitepaper delisted (whitepaper_delisted, severity critical)
// ---------------------------------------------------------------------------

describe("diffNormalized — whitepaper_delisted", () => {
  it("emits exactly 1 whitepaper_delisted event", () => {
    const next = normalize(join(VARIANTS, "whitepaper_delisted.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    expect(events.filter((e) => e.kind === "whitepaper_delisted")).toHaveLength(1);
  });

  it("whitepaper_delisted event has severity critical", () => {
    const next = normalize(join(VARIANTS, "whitepaper_delisted.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const ev = events.find((e) => e.kind === "whitepaper_delisted");
    expect(ev?.severity).toBe("critical");
  });

  it("no whitepaper_replaced events", () => {
    const next = normalize(join(VARIANTS, "whitepaper_delisted.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    expect(events.filter((e) => e.kind === "whitepaper_replaced")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Whitepaper replaced (same LEI, new wpKey)
// ---------------------------------------------------------------------------

describe("diffNormalized — whitepaper_replaced", () => {
  it("emits exactly 1 whitepaper_replaced event", () => {
    const next = normalize(join(VARIANTS, "whitepaper_replaced.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    expect(events.filter((e) => e.kind === "whitepaper_replaced")).toHaveLength(1);
  });

  it("no whitepaper_delisted or whitepaper_added events", () => {
    const next = normalize(join(VARIANTS, "whitepaper_replaced.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    expect(events.filter((e) => e.kind === "whitepaper_delisted")).toHaveLength(0);
    expect(events.filter((e) => e.kind === "whitepaper_added")).toHaveLength(0);
  });

  it("whitepaper_replaced event has field=wpKey and from/to objects with wpKey+tickerHint", () => {
    const next = normalize(join(VARIANTS, "whitepaper_replaced.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const ev = events.find((e) => e.kind === "whitepaper_replaced");
    expect(ev?.field).toBe("wpKey");
    const from = ev?.from as { wpKey: string; tickerHint: string | null };
    const to = ev?.to as { wpKey: string; tickerHint: string | null };
    expect(typeof from.wpKey).toBe("string");
    expect(typeof to.wpKey).toBe("string");
    expect(from.wpKey).not.toBe(to.wpKey);
    expect("tickerHint" in from).toBe(true);
    expect("tickerHint" in to).toBe(true);
  });

  it("whitepaper_replaced severity is at least warning (never info)", () => {
    const next = normalize(join(VARIANTS, "whitepaper_replaced.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const ev = events.find((e) => e.kind === "whitepaper_replaced");
    expect(ev?.severity).not.toBe("info");
  });
});

// ---------------------------------------------------------------------------
// Field changed (DTI added → field_changed on dtis)
// ---------------------------------------------------------------------------

describe("diffNormalized — field_changed", () => {
  it("emits at least one field_changed event for dtis", () => {
    const next = normalize(join(VARIANTS, "field_changed.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const changed = events.filter((e) => e.kind === "field_changed" && e.field === "dtis");
    expect(changed.length).toBeGreaterThan(0);
  });

  it("field_changed dtis event has severity info", () => {
    const next = normalize(join(VARIANTS, "field_changed.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const ev = events.find((e) => e.kind === "field_changed" && e.field === "dtis");
    expect(ev?.severity).toBe("info");
  });

  it("no issuer_added, issuer_delisted, whitepaper_added, whitepaper_delisted events", () => {
    const next = normalize(join(VARIANTS, "field_changed.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const unexpected = [
      "issuer_added",
      "issuer_delisted",
      "whitepaper_added",
      "whitepaper_delisted",
    ];
    for (const kind of unexpected) {
      expect(events.filter((e) => e.kind === kind)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Issuer added
// ---------------------------------------------------------------------------

describe("diffNormalized — issuer_added", () => {
  it("emits 1 issuer_added event", () => {
    const next = normalize(join(VARIANTS, "issuer_added.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    expect(events.filter((e) => e.kind === "issuer_added")).toHaveLength(1);
  });

  it("also emits 1 whitepaper_added for the new issuer's whitepaper", () => {
    const next = normalize(join(VARIANTS, "issuer_added.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    expect(events.filter((e) => e.kind === "whitepaper_added")).toHaveLength(1);
  });

  it("issuer_added event key is the new LEI", () => {
    const next = normalize(join(VARIANTS, "issuer_added.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const ev = events.find((e) => e.kind === "issuer_added");
    expect(ev?.key).toBe("TESTADDEDISSUER00001");
  });
});

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

describe("diffNormalized — severity rules", () => {
  it("issuer_delisted is always critical", () => {
    // Build a next state missing one issuer entirely
    const prevWithExtra: NormalizeResult = {
      ...baseResult,
      issuers: [
        ...baseResult.issuers,
        {
          ...baseResult.issuers[0]!,
          lei: "EXTRAISSUER000000001",
          registerStatus: "authorised",
        },
      ],
    };
    const events = diffNormalized(prevWithExtra, baseResult, CTX);
    const ev = events.find((e) => e.kind === "issuer_delisted");
    expect(ev?.severity).toBe("critical");
  });

  it("whitepaper_delisted is always critical", () => {
    const next = normalize(join(VARIANTS, "whitepaper_delisted.csv"));
    const events = diffNormalized(baseResult, next, CTX);
    const ev = events.find((e) => e.kind === "whitepaper_delisted");
    expect(ev?.severity).toBe("critical");
  });
});
