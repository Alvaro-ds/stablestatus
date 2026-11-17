/**
 * Integrity chain for data/runs.jsonl (ADR 0005).
 * Self-contained: depends only on Web Crypto, so the website can copy this file as is.
 */

export interface StateFile {
  path: string;
  sha256: string;
}

export type VerifyResult = { ok: true } | { ok: false; line: number; reason: string };

type Entry = Record<string, unknown>;

/** RFC 8785 (JCS) canonical JSON: keys sorted by UTF-16 code units, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hashes each published file and the canonical list of (path, sha256) sorted by path. */
export async function computeState(
  files: Record<string, Uint8Array>
): Promise<{ stateFiles: StateFile[]; stateSha256: string }> {
  const paths = Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const stateFiles = await Promise.all(
    paths.map(async (path) => ({ path, sha256: await sha256Hex(files[path]!) }))
  );
  return { stateFiles, stateSha256: await sha256Hex(canonicalJson(stateFiles)) };
}

/** sha256 of the canonical entry without its own entrySha256. */
export async function entryHash(entry: Entry): Promise<string> {
  const rest = { ...entry };
  delete rest["entrySha256"];
  return sha256Hex(canonicalJson(rest));
}

/** Splits runs.jsonl text into lines, without the final empty line. */
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Returns `run` with the chain and state fields, ready to append to runs.jsonl. */
export async function chainEntry(
  runsBytes: Uint8Array,
  run: Entry,
  files: Record<string, Uint8Array>
): Promise<Entry> {
  const lines = splitLines(new TextDecoder().decode(runsBytes));
  let prev: string | undefined;
  for (const line of lines) {
    const hash = (JSON.parse(line) as Entry)["entrySha256"];
    if (typeof hash === "string") prev = hash;
  }
  const link =
    prev === undefined
      ? { prevEntrySha256: await sha256Hex(runsBytes), chainGenesis: true }
      : { prevEntrySha256: prev };
  const entry: Entry = { ...run, ...link, ...(await computeState(files)) };
  return { ...entry, entrySha256: await entryHash(entry) };
}

function describeStateDiff(stored: unknown, actual: StateFile[]): string {
  const before = new Map(
    Array.isArray(stored) ? (stored as StateFile[]).map((f) => [f.path, f.sha256]) : []
  );
  const after = new Map(actual.map((f) => [f.path, f.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((p) => before.get(p) !== after.get(p))
    .sort();
  return `stateSha256 does not match the current files (${changed.join(", ") || "stateFiles"})`;
}

/**
 * Verifies the chain in runs.jsonl lines (1-based line numbers in errors) and, with
 * `files`, the last chained line's stateSha256 against the current published files.
 */
export async function verifyChain(
  lines: string[],
  files?: Record<string, Uint8Array>
): Promise<VerifyResult> {
  let prev: string | undefined;
  let last: Entry | undefined;
  let prefix = "";
  for (const [i, line] of lines.entries()) {
    const fail = (reason: string): VerifyResult => ({ ok: false, line: i + 1, reason });
    let entry: Entry;
    try {
      entry = JSON.parse(line) as Entry;
    } catch {
      return fail("invalid JSON");
    }
    if (entry["entrySha256"] === undefined) {
      if (prev !== undefined) return fail("unchained line after the chain started");
      prefix += line + "\n";
      continue;
    }
    const genesis = prev === undefined;
    if (genesis !== (entry["chainGenesis"] === true)) {
      return fail(
        genesis ? "first chained line is not marked chainGenesis" : "unexpected chainGenesis"
      );
    }
    const expectedPrev = genesis ? await sha256Hex(prefix) : prev;
    if (entry["prevEntrySha256"] !== expectedPrev) return fail("prevEntrySha256 does not match");
    if (entry["entrySha256"] !== (await entryHash(entry)))
      return fail("entrySha256 does not match");
    if (entry["stateSha256"] !== (await sha256Hex(canonicalJson(entry["stateFiles"])))) {
      return fail("stateSha256 does not match stateFiles");
    }
    prev = entry["entrySha256"] as string;
    last = entry;
  }
  if (files && last) {
    const state = await computeState(files);
    if (state.stateSha256 !== last["stateSha256"]) {
      return {
        ok: false,
        line: lines.length,
        reason: describeStateDiff(last["stateFiles"], state.stateFiles),
      };
    }
  }
  return { ok: true };
}
