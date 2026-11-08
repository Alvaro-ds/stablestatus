import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseEsmaCsv } from "../esma/parse.js";
import { computeSha256 } from "../esma/store.js";
import { ESMA_URLS } from "../esma/constants.js";
import { dedupeRows } from "../normalize/dedupe.js";
import { ManifestSchema, MetaSchema, RunRecordSchema } from "../model/index.js";
import type { Manifest, RunRecord } from "../model/index.js";

const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_STREAK = 7;

interface Counts {
  issuers: number;
  whitepapers: number;
}

export interface GateReport {
  streak: number;
  todayPending: boolean;
  missing: string[];
  /** Manual, local or unlabelled runs: informational only, never counted. */
  otherRuns: Array<Pick<RunRecord, "at" | "runner" | "trigger">>;
  counts: { match: boolean; expected: Counts | null; actual: Counts | null };
  ok: boolean;
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function loadManifests(rawDir: string): Map<string, Manifest> {
  const manifests = new Map<string, Manifest>();
  if (!existsSync(rawDir)) return manifests;
  for (const dir of readdirSync(rawDir).filter((d) => DATE_DIR_RE.test(d))) {
    const path = join(rawDir, dir, "manifest.json");
    if (existsSync(path)) {
      manifests.set(dir, ManifestSchema.parse(JSON.parse(readFileSync(path, "utf8"))));
    }
  }
  return manifests;
}

function loadRuns(dataDir: string): RunRecord[] {
  const path = join(dataDir, "runs.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line !== "")
    .map(({ line, n }) => {
      try {
        return RunRecordSchema.parse(JSON.parse(line));
      } catch (err) {
        throw new Error(
          `runs.jsonl line ${n} is invalid: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
}

function isScheduled(run: RunRecord): boolean {
  return run.runner === "github-actions" && run.trigger === "schedule";
}

function countsFromLatestEmtwp(rawDir: string, manifests: Map<string, Manifest>): Counts | null {
  const latest = [...manifests.keys()].sort().at(-1);
  if (latest === undefined) return null;
  const sha = manifests.get(latest)!.files.find((f) => f.url === ESMA_URLS.EMTWP)?.sha256;
  const dirs = readdirSync(rawDir)
    .filter((d) => DATE_DIR_RE.test(d) && d <= latest)
    .sort()
    .reverse();
  for (const dir of dirs) {
    const path = join(rawDir, dir, "EMTWP.csv");
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    if (computeSha256(buf) !== sha) continue;
    const rows = dedupeRows(parseEsmaCsv(buf, "EMTWP").rows);
    return {
      issuers: new Set(rows.map((r) => r.fields["ae_lei"])).size,
      whitepapers: rows.length,
    };
  }
  return null;
}

function countsFromMeta(dataDir: string): Counts | null {
  const path = join(dataDir, "current", "meta.json");
  if (!existsSync(path)) return null;
  const meta = MetaSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return { issuers: meta.issuerCount, whitepapers: meta.whitepaperCount };
}

export function checkGate(dataDir: string, today: string): GateReport {
  const rawDir = join(dataDir, "raw");
  const manifests = loadManifests(rawDir);
  const runs = loadRuns(dataDir);
  const scheduledDays = new Set(runs.filter(isScheduled).map((r) => r.at.slice(0, 10)));
  const otherRuns = runs
    .filter((r) => !isScheduled(r))
    .map(({ at, runner, trigger }) => ({ at, runner, trigger }));

  const todayPending = !scheduledDays.has(today);
  const lastDay = todayPending ? previousDay(today) : today;
  let streak = 0;
  for (let d = lastDay; scheduledDays.has(d); d = previousDay(d)) streak++;

  const missing: string[] = [];
  const first = [...scheduledDays].sort()[0];
  if (first !== undefined) {
    for (let d = lastDay; d > first; d = previousDay(d)) {
      if (!scheduledDays.has(d)) missing.push(d);
    }
  }
  missing.sort();

  const expected = countsFromLatestEmtwp(rawDir, manifests);
  const actual = countsFromMeta(dataDir);
  const match =
    expected !== null &&
    actual !== null &&
    expected.issuers === actual.issuers &&
    expected.whitepapers === actual.whitepapers;

  return {
    streak,
    todayPending,
    missing,
    otherRuns,
    counts: { match, expected, actual },
    ok: streak >= REQUIRED_STREAK && match,
  };
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const today = new Date().toISOString().slice(0, 10);
  try {
    const report = checkGate(join(projectRoot, "data"), today);
    console.log(`Consecutive scheduled days up to ${today}: ${report.streak}/${REQUIRED_STREAK}`);
    if (report.todayPending) console.log(`Today (${today}): pending`);
    console.log(`Missing days: ${report.missing.length ? report.missing.join(", ") : "none"}`);
    console.log("Other runs (informational, not counted):");
    for (const r of report.otherRuns) {
      console.log(`  ${r.at} ${r.runner ?? "unknown"}/${r.trigger ?? "unknown"}`);
    }
    if (report.otherRuns.length === 0) console.log("  none");
    const { expected, actual, match } = report.counts;
    console.log(
      `Counts (EMTWP deduped vs meta.json): ${JSON.stringify(expected)} vs ${JSON.stringify(actual)} → ${match ? "match" : "MISMATCH"}`
    );
    console.log(report.ok ? "Gate: PASSED" : "Gate: NOT PASSED");
    process.exit(report.ok ? 0 : 1);
  } catch (err: unknown) {
    console.error("Fatal error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
