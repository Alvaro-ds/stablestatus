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
  it("bullet line does not start with '- •'", () => {
    const md = buildChangelog([makeEvent()]);
    expect(md).not.toMatch(/^- •/m);
  });

  it("critical event line starts with 🔴 (no leading dash)", () => {
    const md = buildChangelog([makeEvent({ severity: "critical", kind: "issuer_delisted" })]);
    const line = md.split("\n").find((l) => l.includes("issuer_delisted"));
    expect(line).toBeDefined();
    expect(line!.trimStart()).toMatch(/^🔴/);
  });

  it("info event line starts with • (no leading dash)", () => {
    const md = buildChangelog([makeEvent()]);
    const line = md.split("\n").find((l) => l.includes("field_changed"));
    expect(line).toBeDefined();
    expect(line!.trimStart()).toMatch(/^•/);
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
