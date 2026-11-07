import { createReadStream } from "node:fs";
import { writeFileSync, renameSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { ChangeEvent } from "../model/change-event.js";

const DISCLAIMER =
  "\n---\n*Data sourced from ESMA's Interim MiCA Register. StableStatus provides information with sources, not legal advice.*";

export function buildChangelog(events: ChangeEvent[]): string {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));

  const lines: string[] = ["# StableStatus Data Changelog", ""];

  for (const ev of sorted) {
    const icon = ev.severity === "critical" ? "🔴" : ev.severity === "warning" ? "⚠️" : "•";
    const dateStr = ev.at.slice(0, 10);
    let desc = `**${ev.kind}** [${ev.entity}] \`${ev.key}\``;
    if (ev.field !== undefined) desc += ` field=\`${ev.field}\``;
    if (ev.from !== undefined) desc += ` from=\`${JSON.stringify(ev.from)}\``;
    if (ev.to !== undefined) desc += ` to=\`${JSON.stringify(ev.to)}\``;
    lines.push(`- ${icon} ${dateStr} ${desc} _(${ev.severity})_`);
  }

  lines.push(DISCLAIMER);
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
