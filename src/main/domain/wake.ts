// "Wake everyone": one press carries on every character that is only waiting
// for a go — in every town. PURE (no Electron, no lanes), so
// scripts/check-wake.mjs can run it.
//
// Two kinds of "only needs a go":
//   limit   — parked on Claude's usage limit. It resumes by itself at the reset
//             time; Maksym presses earlier because he switched account.
//   checkin — paused to check in (the step cap, or the app was closed mid-job)
//             and offering "Keep cooking".
// Never woken from here: a character with a question or an approval open (it
// needs an answer, not a go) and a burned one (an error wants a look first).
//
// A try on a character that is still limited re-reads its whole conversation
// just to fail again. So limit holds go ONE first (the scout): the rest are
// released only when the scout got an answer from Claude; when the limit is
// still on, everyone else stays parked and nothing more is spent.

import type { WakeSign } from "../../shared/ipc";

export type StuckKind = "limit" | "checkin";
export interface LaneNow { town: string; id: string; working: boolean; paused: boolean; burned: boolean; asking: boolean; limitedUntil: number }
export interface Stuck { town: string; id: string; kind: StuckKind }

/** Who only needs a go, in the order given (towns, then the street). */
export function stuckLanes(lanes: LaneNow[]): Stuck[] {
  const out: Stuck[] = [];
  for (const l of lanes) {
    if (!l.paused || l.working || l.burned || l.asking) continue;
    out.push({ town: l.town, id: l.id, kind: l.limitedUntil > 0 ? "limit" : "checkin" });
  }
  return out;
}

/** One press: check-ins go at once; of the limit holds the first goes as the
 *  scout and the rest wait for its verdict. */
export function wakePlan(stuck: Stuck[]): { go: Stuck[]; scout: Stuck | null; wait: Stuck[] } {
  const limit = stuck.filter((s) => s.kind === "limit");
  return { go: stuck.filter((s) => s.kind === "checkin"), scout: limit[0] ?? null, wait: limit.slice(1) };
}

/** How long a scout may stay silent before the next one is tried instead. A
 *  resume re-reads the whole conversation first (17 s measured on 2026-11-24). */
export const SCOUT_PATIENCE_MS = 3 * 60_000;
/** A scout that is neither working nor limited this soon after the press has
 *  simply not started yet — not "gone". */
export const SCOUT_START_GRACE_MS = 20_000;

/** through — Claude answered the scout (it said something that is not the limit
 *            message, or called a tool): release the rest.
 *  still   — the scout was parked on the limit again: everyone else stays parked.
 *  gone    — the scout was scrapped, cancelled or stayed silent too long: it
 *            proved nothing, try the next one.
 *  waiting — no verdict yet. */
export type ScoutVerdict = "through" | "still" | "gone" | "waiting";
export function scoutVerdict(s: { working: boolean; limitedUntil: number; spoke: boolean }, sinceMs: number): ScoutVerdict {
  if (s.limitedUntil > 0) return "still";
  if (s.spoke) return "through";
  if (!s.working && sinceMs >= SCOUT_START_GRACE_MS) return "gone";
  if (sinceMs >= SCOUT_PATIENCE_MS) return "gone";
  return "waiting";
}

/** The top-bar button as drawn, or null when nobody is stuck (hidden). */
export function wakeSign(stuck: Stuck[], trying: boolean): WakeSign | null {
  const limit = stuck.filter((s) => s.kind === "limit").length;
  const checkin = stuck.length - limit;
  if (!stuck.length && !trying) return null;
  if (trying) {
    return { count: stuck.length, limit, checkin, trying, label: "⏳ trying one…", title: `Trying one character first — ${limit ? `${limit} more wait${limit === 1 ? "s" : ""} for the answer` : "the rest are already going"}. If Claude's limit is still on, the others stay parked and nothing more is spent.` };
  }
  const parts: string[] = [];
  if (limit) parts.push(`${limit} parked on Claude's limit`);
  if (checkin) parts.push(`${checkin} waiting for "keep cooking"`);
  return {
    count: stuck.length, limit, checkin, trying,
    label: `⏰ Wake ${stuck.length === 1 ? "1" : `all ${stuck.length}`}`,
    title: `${parts.join(", ")} — across every town. One press carries them all on.${limit ? " On the limit, one tries first; the rest follow only if it gets through." : ""}`,
  };
}
