// Small pure helpers behind the lane's "don't waste Maksym's time" guards — kept
// free of Electron/SDK imports so they can be checked with a plain node script
// (scripts/check-guards.mjs). Born from the 25 Aug 2026 day: 33 one-at-a-time
// questions, three usage-limit hits shown as generic burns, nothing visible.

import type { Fuel, Gauge } from "../../shared/ipc";

/** The SDK reports `resetsAt` as a unix timestamp — sometimes seconds, sometimes
 *  ms. Normalise to epoch ms; 0 when absent/unusable. */
export function normalizeResetsAt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

/** Recognise the CLI's usage-limit message in what the character "said", e.g.
 *  "You've hit your session limit · resets 1:40pm (Europe/Kiev)", and read the
 *  reset clock (today, or tomorrow if that time has already passed). The tz in
 *  brackets is ignored — it's the machine's own zone. `resetsAt` is 0 when the
 *  text carries no time. */
export function parseLimitText(text: string, now: number = Date.now()): { resetsAt: number; text: string } | null {
  if (!/(hit|reached) your (session |usage |weekly |daily )?limit|usage limit (reached|exceeded)|out of (usage|quota)/i.test(text)) return null;
  const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let resetsAt = 0;
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h <= 23 && min <= 59) {
      const d = new Date(now);
      d.setHours(h, min, 0, 0);
      if (d.getTime() <= now - 60_000) d.setDate(d.getDate() + 1);
      resetsAt = d.getTime();
    }
  }
  return { resetsAt, text: text.replace(/\s+/g, " ").trim().slice(0, 120) };
}

/** "1:40 PM" — or "1:40 PM tomorrow" when it's past midnight from `now`. */
export function fmtClock(ms: number, now: number = Date.now()): string {
  const d = new Date(ms), n = new Date(now);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === n.toDateString() ? t : `${t} tomorrow`;
}

// Answer choices that don't decide anything — they just acknowledge a report.
// An ask whose EVERY option looks like this is a progress update in disguise.
const ACK_RE = new RegExp(
  "^(" + [
    "i'?ll (check|look|take a look|test|try|review|have a look)",
    "looks? good", "ok(ay)?\\b", "got it", "thanks", "thank you", "take a look", "all good",
    "keep going", "makes sense", "show me", "sounds good", "great\\b", "fine\\b", "noted",
    "check(ed)? it", "i trust it", "move on", "nothing else", "one more thing",
    "still want", "look closer", "carry on", "go ahead", "continue", "understood", "will do",
    "let me (check|look|see|test)", "something('s| is| else)?\\s*(still\\s*)?(not right|wrong|else|needs|off)",
  ].join("|") + ")",
  "i",
);
const LEAD_RE = /^(yes|yeah|yep|no|nope|ok|okay|sure)[,!.\s—–-]*/i;

/** True when every option is a mere acknowledgment ("I'll check it now",
 *  "Looks good, keep going", "Something else needs attention") — i.e. nothing
 *  is being decided. A single real choice ("Yes, restore it") makes it false. */
export function isAckOnly(options: readonly string[]): boolean {
  if (!options || !options.length) return false;
  return options.every((o) => ACK_RE.test(String(o || "").trim().replace(LEAD_RE, "")));
}

// ───────────────────────── Reserve light (Job 1, Orca plan) ─────────────────
// Claude's rate_limit_event stream, folded town-wide. The log says: `allowed`
// never carries a level, `allowed_warning` always does (lowest ever 0.75), and
// `rejected` ends the turn. Below ~75% the app is blind — so this is a reserve
// LIGHT, not a gauge: dark, then amber (<90%), red (≥90%), empty (rejected).


/** The bits of a rate_limit_event the fold needs (an SDK message or a log line). */
export interface FuelEvent {
  /** "five_hour" | "seven_day" (anything else is ignored). */
  type: string;
  /** "allowed" | "allowed_warning" | "rejected". */
  status: string;
  /** Share used 0–1 (or 0–100; normalised). Only allowed_warning carries it. */
  util?: number;
  /** Unix s or ms. */
  resetsAt?: unknown;
  /** Epoch ms of the event (defaults to `now`). */
  at?: number;
}

const RED_AT = 0.9;
const STALE_MS = 10 * 60_000;

function windowKey(type: string): keyof Fuel | null {
  if (type === "five_hour") return "fiveHour";
  if (type === "seven_day") return "sevenDay";
  return null;
}

/** Pure fold: previous Fuel + one event → next Fuel. Returns the SAME object when
 *  nothing changed (so callers can skip a snapshot push). */
export function foldFuel(prev: Fuel, ev: FuelEvent, now: number = Date.now()): Fuel {
  const key = windowKey(ev.type);
  if (!key) return prev;
  const g = prev[key];
  const at = typeof ev.at === "number" && ev.at > 0 ? ev.at : now;
  if (g && at < g.at) return prev; // an older event arriving late — ignore
  const evResets = normalizeResetsAt(ev.resetsAt);
  const resetsAt = evResets || (g?.resetsAt ?? 0);
  let next: Gauge | null = null;
  if (ev.status === "rejected") {
    next = { util: 1, resetsAt, at, level: "empty" };
  } else if (ev.status === "allowed_warning") {
    let util = typeof ev.util === "number" && isFinite(ev.util) ? ev.util : (g?.util ?? null);
    if (util !== null && util > 1) util = util / 100;
    if (util !== null) util = Math.max(0, Math.min(1, util));
    next = { util, resetsAt, at, level: util !== null && util >= RED_AT ? "red" : "amber" };
  } else if (ev.status === "allowed") {
    // A fresh window: the old one has passed, OR Claude handed out a later reset
    // time (on 9 Sep the `allowed` after a `rejected` came 7 min later with a
    // reset 4 h further out — long before the old reset time had passed).
    const fresh = !g || (g.resetsAt > 0 && now > g.resetsAt) || (evResets > 0 && evResets > g.resetsAt);
    if (fresh) next = { util: null, resetsAt, at, level: "dark" };
    else return prev; // mid-window "allowed" says nothing about the level — keep the reading
  } else {
    return prev;
  }
  return { ...prev, [key]: next };
}

/** "1:40 PM" · "1:40 PM tomorrow" · "Mon 3:00 PM" (weekly resets are days away). */
export function fmtWhen(ms: number, now: number = Date.now()): string {
  const d = new Date(ms), n = new Date(now);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === n.toDateString()) return t;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `${t} tomorrow`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
}

/** The sign's words for one window, or null when dark (or the window has since
 *  reset on its own). `label` = "Reserve" (5-hour) / "Weekly reserve". */
export function fuelWord(g: Gauge | null, now: number = Date.now(), label: string = "Reserve"): string | null {
  if (!g || g.level === "dark") return null;
  if (g.resetsAt > 0 && now > g.resetsAt) return null; // the window reset while nobody worked
  const when = g.resetsAt > 0 ? fmtWhen(g.resetsAt, now) : "";
  let s: string;
  if (g.level === "empty") s = when ? `Empty · back at ${when}` : "Empty";
  else {
    const pct = g.util !== null ? `${Math.round(g.util * 100)}% used` : "running low";
    s = `${label} · ${pct}` + (when ? ` · resets ${when}` : "");
  }
  const age = now - g.at;
  if (age > STALE_MS) s += ` · as of ${age < 90 * 60_000 ? `${Math.round(age / 60_000)} min` : `${Math.round(age / 3_600_000)} h`} ago`;
  return s;
}

/** True when the reading is older than 10 min (nobody has worked since). */
export function fuelStale(g: Gauge | null, now: number = Date.now()): boolean {
  return !!g && g.level !== "dark" && now - g.at > STALE_MS;
}

/** Fire the one-line Telegram heads-up? True on the FIRST amber-or-worse reading
 *  of the 5-hour tank for a given reset time; `warnedFor` is the reset time we
 *  already warned about (persisted), so the app stays quiet across restarts. */
export function fuelWarnDue(prev: Fuel, next: Fuel, warnedFor: number): boolean {
  const g = next.fiveHour;
  if (!g || g.level === "dark") return false;
  if (g.resetsAt === warnedFor) return false;
  const was = prev.fiveHour;
  return !was || was.level === "dark" || was.resetsAt !== g.resetsAt;
}

// ───────────────────────── Chalk line (Job 2, Orca plan) ─────────────────────
// A character's own one-sentence status ("reproduced the refund bug, testing a
// fix"), posted via the `post_status` tool and shown under its name on the
// street, on the Orders board and in /town.

const NOTE_MAX = 90;
const NOTE_COOLDOWN_MS = 20_000;

/** Strip the Markdown a model tends to sprinkle in, and flatten to one line. */
export function stripMarkdown(raw: string): string {
  return String(raw || "")
    .replace(/```[\s\S]*?```/g, " ")           // fenced code
    .replace(/`([^`]*)`/g, "$1")               // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // links → text
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "") // headings, quotes, bullets
    .replace(/(\*\*|__)(.*?)\1/g, "$2")        // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")           // italics
    .replace(/~~(.*?)~~/g, "$1")               // strike
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut to `max` characters on a word boundary, with an ellipsis. */
export function cutWords(s: string, max: number = NOTE_MAX): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:·—–-]+$/, "") + "…";
}

/** A posted status → the chalk line, or null when there is nothing to show:
 *  empty, or a QUESTION (ends with "?") — questions go through ask_maksym. */
export function sanitizeStatus(raw: string): string | null {
  const s = stripMarkdown(raw);
  if (!s) return null;
  if (/\?\s*$/.test(s)) return null;
  return cutWords(s, NOTE_MAX);
}

/** Accept a new status? Not within 20 s of the last accepted one — the tool
 *  then answers "kept your previous line" (never an error). */
export function statusAccepted(lastAt: number, now: number = Date.now()): boolean {
  return !lastAt || now - lastAt >= NOTE_COOLDOWN_MS;
}

/** No status was ever posted → the first line of the final reply stands in. */
export function fallbackNote(finalReply: string): string | null {
  const firstLine = String(finalReply || "").split(/\n+/).map((l) => stripMarkdown(l)).find((l) => l.length > 0);
  if (!firstLine) return null;
  return cutWords(firstLine, NOTE_MAX);
}
