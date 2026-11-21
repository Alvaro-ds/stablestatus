import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson, chainEntry, computeState, verifyChain } from "../../src/integrity/chain.js";

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const OLD_LINES = [
  '{"at":"2026-11-07T05:00:00.000Z","runId":null,"emtwpSha256":"aa","artzzSha256":null,"events":3,"critical":0}',
  '{"at":"2026-11-08T05:00:00.000Z","runId":null,"emtwpSha256":"aa","artzzSha256":null,"events":0,"critical":0}',
];

function run(day: number) {
  return { at: `2026-11-1${day}T05:00:00.000Z`, runId: null, events: day, critical: 0 };
}

/** Appends n chained runs to `lines`, all against the same `files`. */
async function buildChain(lines: string[], n: number, files: Record<string, Uint8Array>) {
  const out = [...lines];
  for (let i = 0; i < n; i++) {
    const text = out.map((l) => l + "\n").join("");
    const entry = await chainEntry(enc(text), run(i), files);
    out.push(JSON.stringify(entry));
  }
  return out;
}

const FILES = {
  "data/current/issuers.json": enc("[]"),
  "data/changes.jsonl": enc('{"a":1}\n'),
};

describe("canonicalJson", () => {
  it("sorts keys recursively and has no whitespace (RFC 8785)", () => {
    expect(canonicalJson({ b: 1, a: [{ d: null, c: "x" }], é: true })).toBe(
      '{"a":[{"c":"x","d":null}],"b":1,"é":true}'
    );
  });
});

describe("computeState", () => {
  it("hashes each file and the canonical list sorted by path", async () => {
    const { stateFiles, stateSha256 } = await computeState(FILES);
    expect(stateFiles).toEqual([
      { path: "data/changes.jsonl", sha256: sha('{"a":1}\n') },
      { path: "data/current/issuers.json", sha256: sha("[]") },
    ]);
    expect(stateSha256).toBe(sha(canonicalJson(stateFiles)));
  });
});

describe("verifyChain", () => {
  it("accepts a correct chain of 3 lines and checks the state", async () => {
    const lines = await buildChain([], 3, FILES);
    expect(await verifyChain(lines, FILES)).toEqual({ ok: true });
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[0]?.["chainGenesis"]).toBe(true);
    expect(parsed[0]?.["prevEntrySha256"]).toBe(sha(""));
    expect(parsed[1]?.["prevEntrySha256"]).toBe(parsed[0]?.["entrySha256"]);
    expect(parsed[1]?.["chainGenesis"]).toBeUndefined();
  });

  it("fails on the line that was edited by hand", async () => {
    const lines = await buildChain([], 3, FILES);
    lines[1] = lines[1]!.replace('"events":1', '"events":9');
    expect(await verifyChain(lines, FILES)).toMatchObject({ ok: false, line: 2 });
  });

  it("fails when a key is added, even one the schema would strip", async () => {
    const lines = await buildChain([], 2, FILES);
    lines[1] = lines[1]!.replace("{", '{"extra":1,');
    expect(await verifyChain(lines)).toMatchObject({ ok: false, line: 2 });
  });

  it("fails on the next link when a line is deleted", async () => {
    const lines = await buildChain([], 3, FILES);
    lines.splice(1, 1);
    expect(await verifyChain(lines, FILES)).toMatchObject({ ok: false, line: 2 });
  });

  it("anchors old unchained lines in the genesis", async () => {
    const lines = await buildChain(OLD_LINES, 2, FILES);
    const genesis = JSON.parse(lines[2]!) as Record<string, unknown>;
    expect(genesis["chainGenesis"]).toBe(true);
    expect(genesis["prevEntrySha256"]).toBe(sha(OLD_LINES.map((l) => l + "\n").join("")));
    expect(await verifyChain(lines, FILES)).toEqual({ ok: true });

    const tampered = [...lines];
    tampered[0] = tampered[0]!.replace('"events":3', '"events":4');
    expect(await verifyChain(tampered)).toMatchObject({ ok: false, line: 3 });
  });

  it("accepts old lines alone, before the chain starts", async () => {
    expect(await verifyChain(OLD_LINES, FILES)).toEqual({ ok: true });
  });

  it("rejects an unchained line after the chain started", async () => {
    const lines = await buildChain(OLD_LINES, 1, FILES);
    lines.push(OLD_LINES[1]!);
    expect(await verifyChain(lines)).toMatchObject({ ok: false, line: 4 });
  });

  it("rejects a second genesis", async () => {
    const lines = await buildChain([], 1, FILES);
    const fake = await chainEntry(enc(lines.map((l) => l + "\n").join("")), run(5), FILES);
    lines.push(JSON.stringify({ ...fake, chainGenesis: true }));
    expect(await verifyChain(lines)).toMatchObject({ ok: false, line: 2 });
  });

  it("fails stateSha256 when a current file changed after the last run", async () => {
    const lines = await buildChain([], 3, FILES);
    const files = { ...FILES, "data/current/issuers.json": enc('[{"lei":"X"}]') };
    const result = await verifyChain(lines, files);
    expect(result).toMatchObject({ ok: false, line: 3 });
    expect(result.ok ? "" : result.reason).toContain("data/current/issuers.json");
  });

  it("fails stateSha256 when a file appears that the last run did not list", async () => {
    const lines = await buildChain([], 1, FILES);
    const files = { ...FILES, "data/current/new.json": enc("{}") };
    const result = await verifyChain(lines, files);
    expect(result.ok ? "" : result.reason).toContain("data/current/new.json");
  });

  it("reports invalid JSON with its line", async () => {
    expect(await verifyChain([OLD_LINES[0]!, "{oops"])).toMatchObject({ ok: false, line: 2 });
  });
});
