import { createReadStream } from "node:fs";
import { writeFileSync, renameSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { ChangeEvent } from "../model/change-event.js";

const ESMA_NOTICE =
  "\n---\n" +
  "This document has been drafted using material downloaded from ESMA's website. " +
  "ESMA does not endorse this publication and is not liable for its content. " +
  "StableStatus provides sourced information, not legal advice.";

function escapeValue(value: unknown): string {
  let s = JSON.stringify(value);
  // Remove backticks (break out of inline code), angle brackets (HTML injection),
  // and control characters (newlines, carriage returns).
  s = s
    .replace(/`/g, "'")
    .replace(/[<>]/g, "")
    .replace(/[\r\n]/g, " ");
  if (s.length > 200) s = s.slice(0, 197) + "...";
  return s;
}

function escapeMessage(message: string): string {
  const s = message
    .replace(/`/g, "'")
    .replace(/[<>]/g, "")
    .replace(/[\r\n]+/g, " ");
  return s.length > 500 ? s.slice(0, 497) + "..." : s;
}

export function buildChangelog(events: ChangeEvent[]): string {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));

  const lines: string[] = ["# StableStatus Data Changelog", ""];

  for (const ev of sorted) {
    const icon = ev.severity === "critical" ? "🔴 " : ev.severity === "warning" ? "⚠️ " : "";
    const dateStr = ev.at.slice(0, 10);
    let desc = `**${ev.kind}** [${ev.entity}] \`${ev.key}\``;
    if (ev.message !== undefined) {
      desc += ` ${escapeMessage(ev.message)}`;
    } else {
      if (ev.field !== undefined) desc += ` field=\`${ev.field}\``;
      if (ev.from !== undefined) desc += ` from=\`${escapeValue(ev.from)}\``;
      if (ev.to !== undefined) desc += ` to=\`${escapeValue(ev.to)}\``;
    }
    lines.push(`- ${icon}${dateStr} ${desc} _(${ev.severity})_`);
  }

  lines.push(ESMA_NOTICE);
  return lines.join("\n");
}

export async function regenerateChangelog(
  changelogPath: string,
  eventsPath: string
): Promise<void> {
  if (!existsSync(eventsPath)) return;

  const events: ChangeEvent[] = [];
  const rl = createInterface({
    input: createReadStream(eventsPath, "utf8"),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) events.push(JSON.parse(trimmed) as ChangeEvent);
  }

  if (events.length === 0) return;

  const content = buildChangelog(events);
  const tmp = `${changelogPath}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, changelogPath);
}
