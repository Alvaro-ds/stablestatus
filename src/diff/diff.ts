import type { NormalizeResult } from "../normalize/index.js";
import type { RegisterStatus } from "../model/index.js";
import type { ChangeEvent, Severity } from "../model/change-event.js";

export interface DiffContext {
  at: string;
  snapshotSha256: string;
}

function statusToSeverity(status: RegisterStatus): Severity {
  if (status === "withdrawn" || status === "delisted") return "critical";
  if (status === "authorisation_date_missing") return "warning";
  return "info";
}

const SKIP_ISSUER = new Set(["lei", "displayName", "registerStatus", "provenance"]);
const SKIP_WP = new Set(["wpKey", "lei", "registerStatus", "provenance", "quality"]);

function diffFields(
  entity: "issuer" | "whitepaper",
  key: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  ctx: DiffContext,
  events: ChangeEvent[]
): void {
  const skip = entity === "issuer" ? SKIP_ISSUER : SKIP_WP;
  const fields = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const field of fields) {
    if (skip.has(field)) continue;
    if (JSON.stringify(prev[field]) !== JSON.stringify(next[field])) {
      events.push({
        at: ctx.at,
        entity,
        key,
        kind: "field_changed",
        field,
        from: prev[field],
        to: next[field],
        severity: "info",
        snapshotSha256: ctx.snapshotSha256,
      });
    }
  }
}

export function diffNormalized(
  prev: NormalizeResult | null,
  next: NormalizeResult,
  ctx: DiffContext
): ChangeEvent[] {
  if (prev === null) {
    return [
      {
        at: ctx.at,
        entity: "system",
        key: "baseline",
        kind: "baseline",
        severity: "info",
        snapshotSha256: ctx.snapshotSha256,
      },
    ];
  }

  const events: ChangeEvent[] = [];

  // --- Issuer diff ---
  const prevIssuers = new Map(prev.issuers.map((i) => [i.lei, i]));
  const nextIssuers = new Map(next.issuers.map((i) => [i.lei, i]));

  for (const [lei, prevIssuer] of prevIssuers) {
    const nextIssuer = nextIssuers.get(lei);
    if (!nextIssuer) {
      events.push({
        at: ctx.at,
        entity: "issuer",
        key: lei,
        kind: "issuer_delisted",
        severity: "critical",
        snapshotSha256: ctx.snapshotSha256,
      });
    } else {
      if (prevIssuer.registerStatus !== nextIssuer.registerStatus) {
        events.push({
          at: ctx.at,
          entity: "issuer",
          key: lei,
          kind: "status_changed",
          field: "registerStatus",
          from: prevIssuer.registerStatus,
          to: nextIssuer.registerStatus,
          severity: statusToSeverity(nextIssuer.registerStatus),
          snapshotSha256: ctx.snapshotSha256,
        });
      }
      diffFields(
        "issuer",
        lei,
        prevIssuer as unknown as Record<string, unknown>,
        nextIssuer as unknown as Record<string, unknown>,
        ctx,
        events
      );
    }
  }

  for (const lei of nextIssuers.keys()) {
    if (!prevIssuers.has(lei)) {
      events.push({
        at: ctx.at,
        entity: "issuer",
        key: lei,
        kind: "issuer_added",
        severity: "info",
        snapshotSha256: ctx.snapshotSha256,
      });
    }
  }

  // --- Whitepaper diff (per-LEI for replacement detection) ---
  const prevWpByKey = new Map(prev.whitepapers.map((w) => [w.wpKey, w]));
  const nextWpByKey = new Map(next.whitepapers.map((w) => [w.wpKey, w]));

  const prevWpKeysByLei = new Map<string, string[]>();
  const nextWpKeysByLei = new Map<string, string[]>();

  for (const wp of prev.whitepapers) {
    const list = prevWpKeysByLei.get(wp.lei) ?? [];
    list.push(wp.wpKey);
    prevWpKeysByLei.set(wp.lei, list);
  }
  for (const wp of next.whitepapers) {
    const list = nextWpKeysByLei.get(wp.lei) ?? [];
    list.push(wp.wpKey);
    nextWpKeysByLei.set(wp.lei, list);
  }

  const allLeis = new Set([...prevWpKeysByLei.keys(), ...nextWpKeysByLei.keys()]);

  for (const lei of allLeis) {
    const prevKeys = prevWpKeysByLei.get(lei) ?? [];
    const nextKeys = nextWpKeysByLei.get(lei) ?? [];
    const removedKeys = prevKeys.filter((k) => !nextWpByKey.has(k));
    const addedKeys = nextKeys.filter((k) => !prevWpByKey.has(k));

    const pairCount = Math.min(removedKeys.length, addedKeys.length);

    for (let i = 0; i < pairCount; i++) {
      const removedKey = removedKeys[i]!;
      const addedKey = addedKeys[i]!;
      const prevWp = prevWpByKey.get(removedKey)!;
      const newWp = nextWpByKey.get(addedKey)!;
      const replacedSeverity = statusToSeverity(newWp.registerStatus);
      events.push({
        at: ctx.at,
        entity: "whitepaper",
        key: addedKey,
        kind: "whitepaper_replaced",
        field: "wpKey",
        from: { wpKey: removedKey, tickerHint: prevWp.tickerHint },
        to: { wpKey: addedKey, tickerHint: newWp.tickerHint },
        severity: replacedSeverity === "info" ? "warning" : replacedSeverity,
        snapshotSha256: ctx.snapshotSha256,
      });
    }

    for (let i = pairCount; i < removedKeys.length; i++) {
      events.push({
        at: ctx.at,
        entity: "whitepaper",
        key: removedKeys[i]!,
        kind: "whitepaper_delisted",
        severity: "critical",
        snapshotSha256: ctx.snapshotSha256,
      });
    }

    for (let i = pairCount; i < addedKeys.length; i++) {
      const key = addedKeys[i]!;
      const wp = nextWpByKey.get(key)!;
      events.push({
        at: ctx.at,
        entity: "whitepaper",
        key,
        kind: "whitepaper_added",
        severity: statusToSeverity(wp.registerStatus),
        snapshotSha256: ctx.snapshotSha256,
      });
    }
  }

  // --- Field changes for existing whitepapers ---
  for (const [wpKey, prevWp] of prevWpByKey) {
    const nextWp = nextWpByKey.get(wpKey);
    if (!nextWp) continue;

    if (prevWp.registerStatus !== nextWp.registerStatus) {
      events.push({
        at: ctx.at,
        entity: "whitepaper",
        key: wpKey,
        kind: "status_changed",
        field: "registerStatus",
        from: prevWp.registerStatus,
        to: nextWp.registerStatus,
        severity: statusToSeverity(nextWp.registerStatus),
        snapshotSha256: ctx.snapshotSha256,
      });
    }

    diffFields(
      "whitepaper",
      wpKey,
      prevWp as unknown as Record<string, unknown>,
      nextWp as unknown as Record<string, unknown>,
      ctx,
      events
    );
  }

  return events;
}
