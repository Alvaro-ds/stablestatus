import type { Runner, Trigger } from "../model/run.js";

export interface RunContext {
  runner: Runner;
  trigger?: Trigger;
  runId: string | null;
}

/** Derives who ran the ingest from the GitHub Actions environment variables. */
export function detectRunContext(env: NodeJS.ProcessEnv = process.env): RunContext {
  if (env["GITHUB_ACTIONS"] !== "true") {
    return { runner: "local", trigger: "manual", runId: null };
  }
  const event = env["GITHUB_EVENT_NAME"];
  const runId = env["GITHUB_RUN_ID"] ?? null;
  if (event === "schedule" || event === "workflow_dispatch") {
    return { runner: "github-actions", trigger: event, runId };
  }
  return { runner: "github-actions", runId };
}
