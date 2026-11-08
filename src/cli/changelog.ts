import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { regenerateChangelog } from "../diff/changelog.js";

const PROJECT_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

regenerateChangelog(
  join(PROJECT_ROOT, "CHANGELOG-data.md"),
  join(PROJECT_ROOT, "data", "changes.jsonl")
).catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
