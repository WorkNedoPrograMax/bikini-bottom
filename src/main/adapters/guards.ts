// Small pure helpers behind the lane's "don't waste Maksym's time" guards — kept
// free of Electron/SDK imports so they can be checked with a plain node script
// (scripts/check-guards.mjs). Born from the 25 Aug 2026 day: 33 one-at-a-time
// questions, three usage-limit hits shown as generic burns, nothing visible.

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
