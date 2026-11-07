import { describe, it, expect } from "vitest";
import { buildChangelog } from "../../src/diff/changelog.js";
import type { ChangeEvent } from "../../src/model/change-event.js";

function makeEvent(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    at: "2026-11-07T12:00:00Z",
    entity: "whitepaper",
    key: "LEI123:abc123def456",
    kind: "field_changed",
    field: "name",
    severity: "info",
    snapshotSha256: "a".repeat(64),
    ...overrides,
  };
}

describe("buildChangelog — ESMA legal notice", () => {
  it("contains ESMA reuse notice", () => {
    const md = buildChangelog([makeEvent()]);
    expect(md).toContain("ESMA does not endorse this publication");
  });

  it("contains StableStatus disclaimer", () => {
    const md = buildChangelog([makeEvent()]);
    expect(md).toContain("StableStatus provides sourced information, not legal advice");
  });
});

describe("buildChangelog — bullet format", () => {
  it("every event line starts with '- '", () => {
    const events = [
      makeEvent({ severity: "info" }),
      makeEvent({ severity: "warning", kind: "whitepaper_replaced" }),
      makeEvent({ severity: "critical", kind: "issuer_delisted" }),
    ];
    const md = buildChangelog(events);
    const eventLines = md.split("\n").filter((l) => l.startsWith("- "));
    expect(eventLines).toHaveLength(events.length);
  });

  it("N events produce N lines starting with '- '", () => {
    const n = 5;
    const events = Array.from({ length: n }, (_, i) =>
      makeEvent({ at: `2026-11-0${i + 1}T12:00:00Z` })
    );
    const md = buildChangelog(events);
    const listLines = md.split("\n").filter((l) => l.startsWith("- "));
    expect(listLines).toHaveLength(n);
  });

  it("critical event line starts with '- 🔴'", () => {
    const md = buildChangelog([makeEvent({ severity: "critical", kind: "issuer_delisted" })]);
    const line = md.split("\n").find((l) => l.includes("issuer_delisted"));
    expect(line).toBeDefined();
    expect(line).toMatch(/^- 🔴/);
  });

  it("warning event line starts with '- ⚠️'", () => {
    const md = buildChangelog([makeEvent({ severity: "warning", kind: "whitepaper_replaced" })]);
    const line = md.split("\n").find((l) => l.includes("whitepaper_replaced"));
    expect(line).toBeDefined();
    expect(line).toMatch(/^- ⚠️/);
  });

  it("info event line starts with '- ' followed by date (no icon)", () => {
    const md = buildChangelog([makeEvent({ severity: "info" })]);
    const line = md.split("\n").find((l) => l.includes("field_changed"));
    expect(line).toBeDefined();
    expect(line).toMatch(/^- 2026-/);
  });
});

describe("buildChangelog — value escaping", () => {
  it("replaces backticks in from/to values with single quotes", () => {
    const md = buildChangelog([makeEvent({ from: "val`ue", to: "new`val" })]);
    const line = md.split("\n").find((l) => l.includes("field_changed"))!;
    expect(line).toContain("val'ue");
    expect(line).toContain("new'val");
  });

  it("removes angle brackets from from/to values", () => {
    const md = buildChangelog([makeEvent({ from: "<script>", to: "safe" })]);
    const line = md.split("\n").find((l) => l.includes("field_changed"))!;
    expect(line).not.toContain("<script>");
    expect(line).toContain("script");
  });

  it("does not break the line when from/to value contains a newline", () => {
    // JSON.stringify escapes \n to \\n, so the markdown line stays intact.
    const md = buildChangelog([makeEvent({ from: "line1\nline2", to: "ok" })]);
    // The whole changelog must not have extra blank lines caused by this value.
    const lines = md.split("\n");
    const changeLine = lines.find((l) => l.includes("field_changed"))!;
    expect(changeLine).toBeDefined();
    // No actual newline inside the escaped value on the same line.
    expect(changeLine.includes("\n")).toBe(false);
  });

  it("truncates values longer than 200 chars", () => {
    const longVal = "x".repeat(250);
    const md = buildChangelog([makeEvent({ from: longVal })]);
    const line = md.split("\n").find((l) => l.includes("field_changed"))!;
    expect(line).toContain("...");
    // The raw value should not appear in full
    expect(line).not.toContain("x".repeat(250));
  });
});
