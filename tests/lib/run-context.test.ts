import { describe, it, expect } from "vitest";

import { detectRunContext } from "../../src/lib/run-context.js";

describe("detectRunContext", () => {
  it("returns local/manual with no run id outside GitHub Actions", () => {
    expect(detectRunContext({ GITHUB_RUN_ID: "999" })).toEqual({
      runner: "local",
      trigger: "manual",
      runId: null,
    });
  });

  it("maps a scheduled GitHub Actions run", () => {
    expect(
      detectRunContext({
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_RUN_ID: "42",
      })
    ).toEqual({ runner: "github-actions", trigger: "schedule", runId: "42" });
  });

  it("maps a workflow_dispatch run", () => {
    expect(
      detectRunContext({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch" })
    ).toEqual({ runner: "github-actions", trigger: "workflow_dispatch", runId: null });
  });

  it("leaves trigger undefined for any other GitHub event", () => {
    expect(detectRunContext({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push" })).toEqual({
      runner: "github-actions",
      runId: null,
    });
  });
});
