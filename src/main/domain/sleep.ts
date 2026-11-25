// Sleep mode (2026-11-25): what the town does while Maksym is asleep or away.
// PURE (no Electron, no lanes), so scripts/check-sleep.mjs can run it.
//
// Two ways in:
//   the moon button — every character, every town, until it is switched off;
//   auto-away       — a question (or an approval) nobody answered for
//                     AWAY_AFTER_MS is treated as asleep for that question; the
//                     character is then "on its own" until Maksym next talks to
//                     it or presses the moon. Only a QUESTION starts it: a
//                     check-in or an error left alone with the moon off waits
//                     for Maksym as before (the check-in exists to bound what
//                     is spent while nobody looks).
//
// On its own, a character
//   - gets its ask_maksym back at once: take your own default, write it down
//     (night_note) and keep going; a question whose default is hard to pick is
//     parked and everything that does not depend on it is done;
//   - is told "yes" at a "keep cooking?" check-in;
//   - after an error or 45 minutes of silence gets ONE retry, then ONE read-only
//     diagnosis pass, then stops;
//   - is never allowed to merge, post a review, message people or create a Jira
//     ticket (nightRefusal) — those wait for the morning.
// When the moon is switched off (or pressed while characters were away), every
// character that did something on its own gets one morning page and Maksym gets
// one Telegram message.

import type { MorningPage, SleepSign } from "../../shared/ipc";

/** A question nobody answered for this long is treated as asked at night. */
export const AWAY_AFTER_MS = 20 * 60_000;
/** How often the lane engine looks for something sleep mode should carry on. */
export const SLEEP_TICK_MS = 30_000;
/** At most this many "what it did" lines are kept per character per night. */
export const DID_MAX = 12;

// ───────────── the journal ─────────────
// open   — asked while asleep; the character has not written its decision yet
// took   — the character took its own default (choice + why)
// parked — the default was hard to pick; left for Maksym (why)
// did    — one line of what it did (its own status lines, its last reply)
// auto   — what the town did for it (kept cooking, retried, diagnosis, stopped)
// held   — an outward act the town refused at night
export type NightKind = "open" | "took" | "parked" | "did" | "auto" | "held";
export interface NightEntry { at: number; kind: NightKind; text: string; question?: string; choice?: string; why?: string }
export interface NightNote { question: string; decision: "took" | "parked"; choice?: string; why: string }

const norm = (s: string): string => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const clip = (s: string, n: number): string => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };

/** The questions of one ask, written down as open. */
export function openEntries(questions: string[], now: number): NightEntry[] {
  return questions.map((q) => ({ at: now, kind: "open" as const, text: clip(q, 300), question: clip(q, 300) }));
}

/** The character wrote its decisions down: each note replaces the open entry it
 *  answers (same question, loosely matched; a lone note answers a lone open
 *  question whatever its words). A note that matches nothing is kept anyway —
 *  a decision written down is never dropped. Returns a new journal. */
export function applyNotes(journal: NightEntry[], notes: NightNote[], now: number): NightEntry[] {
  const out = journal.slice();
  const openIdx = (): number[] => out.map((e, i) => (e.kind === "open" ? i : -1)).filter((i) => i >= 0);
  for (const n of notes) {
    const q = norm(n.question);
    const opens = openIdx();
    let hit = opens.find((i) => { const o = norm(out[i].question || ""); return !!q && !!o && (o === q || o.includes(q.slice(0, 40)) || q.includes(o.slice(0, 40))); });
    if (hit === undefined && opens.length === 1 && notes.length === 1) hit = opens[0];
    const question = clip(hit !== undefined ? (out[hit].question || n.question) : n.question, 300);
    const entry: NightEntry = n.decision === "took"
      ? { at: now, kind: "took", text: question, question, choice: clip(n.choice || "", 200), why: clip(n.why, 300) }
      : { at: now, kind: "parked", text: question, question, why: clip(n.why, 300) };
    if (hit !== undefined) out[hit] = entry; else out.push(entry);
  }
  return out;
}

/** One more "what it did" line; the same line twice in a row is kept once and
 *  only the latest DID_MAX stay. */
export function addDid(journal: NightEntry[], text: string, now: number): NightEntry[] {
  const line = clip(text, 220);
  if (!line) return journal;
  const dids = journal.filter((e) => e.kind === "did");
  if (dids.length && dids[dids.length - 1].text === line) return journal;
  const out = journal.concat([{ at: now, kind: "did", text: line }]);
  const extra = out.filter((e) => e.kind === "did").length - DID_MAX;
  if (extra <= 0) return out;
  let drop = extra;
  return out.filter((e) => !(e.kind === "did" && drop-- > 0));
}

/** A note is usable when it names the question and says why; "took" also needs the choice. */
export function noteProblem(n: NightNote): string | null {
  if (norm(n.question).length < 6) return "name the question in a few plain words";
  if (norm(n.why).length < 10) return "say why in one plain sentence (Maksym reads it in the morning)";
  if (n.decision === "took" && norm(n.choice || "").length < 2) return "say what you chose";
  return null;
}

// ───────────── what the character is told ─────────────
/** Starts every reply the town gives in Maksym's place — the ask tool passes it
 *  through whole instead of splitting it into per-question answers. */
export const SLEEP_MARK = "🌙 MAKSYM IS ASLEEP";

export function askReply(count: number, why: "moon" | "away"): string {
  const lead = why === "moon"
    ? `${SLEEP_MARK} — sleep mode is on, he will not answer tonight.`
    : `${SLEEP_MARK} or away — nobody answered for 20 minutes, so this goes the night way.`;
  return `${lead} Do NOT wait and do NOT ask again. For ${count === 1 ? "this question" : `each of these ${count} questions`}:\n`
    + "1. If a sensible default exists — what the ticket, the design or an ordinary careful engineer would pick — TAKE IT and keep going.\n"
    + "2. If the default is hard to pick — it is about money, who is eligible, access or permissions, losing data, or a real product choice nothing written answers — PARK it: do not guess, and do every part of the job that does not depend on it.\n"
    + "Then call `night_note` ONCE with one entry per question (took: what you chose and why · parked: why it needs him), and carry on working. "
    + "He reads these in the morning, so write them for someone who did not watch: plain words, no file names. "
    + "Still off-limits until he is back, whatever you decide: merging, posting a review, messaging people, creating Jira tickets — the town refuses them; note them and move on.";
}

export const PERMISSION_REFUSAL = `${SLEEP_MARK} or away, so nobody can approve this. Do the job without it if you can; if you cannot, write it down with \`night_note\` (parked) and do everything that does not depend on it.`;

export const SLEEP_NOTE = " WHEN MAKSYM IS ASLEEP OR AWAY: `ask_maksym` can come back at once saying he is asleep (the town's sleep mode, or nobody answered for 20 minutes). That is not an answer to wait for — follow what it says: take your own sensible default, or park the question when the default is hard to pick (money, eligibility, access, losing data, a real product choice), write every decision down with `night_note`, and do everything that does not depend on a parked question. While he sleeps the town refuses merging, posting a review, messaging people and creating Jira tickets; do not look for a way around it. He gets a morning page with what you did, every decision you took for him and why, and what is still parked.";

export const DIAGNOSIS_PROMPT = "Maksym is asleep. This order has now failed twice (the retry failed too), so do NOT keep building and do NOT try another fix. Do one READ-ONLY diagnosis pass: reproduce what went wrong, collect the evidence, and name ONE hypothesis and the ONE change that would test it. Change nothing. Then write it for Maksym in a few plain sentences — what failed, what you saw, what you would try — and stop. He reads it in the morning.";

// ───────────── what the town does next for one lane ─────────────
export interface SleepLaneNow {
  working: boolean;
  /** an ask_maksym is open (waiting for an answer) */
  asking: boolean;
  /** a "may I run this?" approval is open */
  permission: boolean;
  paused: boolean;
  burned: boolean;
  /** parked on Claude's usage limit — it resumes by itself, never ours */
  limited: boolean;
  /** epoch ms since it has been waiting for Maksym (0 = not waiting) */
  waitSince: number;
  /** already on its own: one of its questions went the night way and Maksym has not talked to it since */
  night: boolean;
  /** automatic recovery steps already spent on this failure: 0 none · 1 retried · 2 diagnosis ran */
  recovery: number;
}
/** answer    — give the open question the asleep reply
 *  deny      — refuse the open approval
 *  cook      — say yes to "keep cooking?"
 *  retry     — the one automatic retry after an error / 45 min of silence
 *  diagnose  — the retry failed too: one read-only diagnosis pass
 *  stop      — the diagnosis is spent: stay stopped (written down once)
 *  none      — nothing to do */
export type SleepAction = "answer" | "deny" | "cook" | "retry" | "diagnose" | "stop" | "none";

/** Has this wait sat unanswered long enough to go the night way by itself? */
export function awayNow(waitSince: number, now: number): boolean {
  return waitSince > 0 && now - waitSince >= AWAY_AFTER_MS;
}

export function sleepStep(l: SleepLaneNow, moon: boolean, now: number): SleepAction {
  if (l.working || l.limited) return "none";
  const night = moon || l.night;
  if (l.asking || l.permission) {
    if (!night && !awayNow(l.waitSince, now)) return "none";
    return l.asking ? "answer" : "deny";
  }
  if (!night) return "none"; // a check-in or an error with the moon off, on a character Maksym is still with
  if (l.burned) return l.recovery <= 0 ? "retry" : l.recovery === 1 ? "diagnose" : l.recovery === 2 ? "stop" : "none";
  if (l.paused) return "cook";
  return "none";
}

// ───────────── never at night ─────────────
/** The four things that wait for the morning. Returns what was tried, in plain
 *  words, or null when the call is fine. A draft is fine (nobody receives it);
 *  reading is fine; pushing a branch and opening a pull request are fine. */
export function nightRefusal(toolName: string, input: Record<string, unknown>): string | null {
  const t = String(toolName || "");
  if (t === "mcp__bikini__post_review") return "post a review";
  if (t === "Bash") {
    // One shell line can hold several commands; look at each.
    const cmd = String(input.command ?? "");
    for (const part of cmd.split(/&&|\|\||;|\n|\|/)) {
      const c = part.trim().replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, "");
      if (/^gh\s+pr\s+merge\b/.test(c)) return "merge a pull request";
      if (/^gh\s+api\b/.test(c) && /\/pulls\/\d+\/merge\b|\/merges\b/.test(c)) return "merge a pull request";
      if (/^gh\s+pr\s+review\b/.test(c)) return "post a review";
      if (/^gh\s+api\b/.test(c) && /\/pulls\/\d+\/reviews\b/.test(c) && /(-X|--method)\s*(POST|PUT)|\s-[fF]\s|--field|--raw-field|--input/i.test(c)) return "post a review";
      if (/^gh\s+(pr|issue)\s+comment\b/.test(c)) return "message people (a comment on GitHub)";
      if (/^gh\s+api\b/.test(c) && /\/comments\b/.test(c) && /(-X|--method)\s*POST|\s-[fF]\s|--field|--raw-field|--input/i.test(c)) return "message people (a comment on GitHub)";
      if (/^gh\s+issue\s+create\b/.test(c)) return "message people (a new GitHub issue)";
      // A push straight onto a main line is a merge by another name. (Pushing
      // the lane's own branch, and merging the main line INTO it, are fine.)
      if (/^git\s+push\b/.test(c) && /(\s|:)(main|master|dev|develop|stage|staging|production|prod)(\s|$)/.test(c)) return "merge (a push straight onto a main line)";
      if (/^(acli\s+)?jira\s+(issue\s+)?create\b/.test(c)) return "create a Jira ticket";
      if (/^curl\b/.test(c) && /\/rest\/api\/\d\/issue\b(?!\/)/.test(c) && /(-X|--request)\s*POST|\s(-d|--data\S*)\s/i.test(c)) return "create a Jira ticket";
      if (/^curl\b/.test(c) && /\/rest\/api\/\d\/issue\/[^/\s]+\/comment\b/.test(c) && /(-X|--request)\s*POST|\s(-d|--data\S*)\s/i.test(c)) return "message people (a Jira comment)";
      if (/^curl\b/.test(c) && /(slack\.com\/api\/chat\.postMessage|hooks\.slack\.com|api\.telegram\.org\/bot[^/]*\/send)/.test(c)) return "message people";
    }
    return null;
  }
  if (!t.startsWith("mcp__")) return null;
  const leaf = t.split("__").pop() || "";
  if (/draft/i.test(leaf)) return null; // a draft reaches nobody
  if (/createJiraIssue$/i.test(leaf)) return "create a Jira ticket";
  if (/addOrEditJiraIssueComment$|addCommentToJiraIssue$|createConfluenceFooterComment$|createConfluenceInlineComment$/i.test(leaf)) return "message people (a Jira comment)";
  if (/Atlassian/i.test(t) && /^execute(Write|Destructive)$/.test(leaf)) {
    const name = String(input.name ?? "");
    if (/create.*issue/i.test(name)) return "create a Jira ticket";
    if (/comment/i.test(name)) return "message people (a Jira comment)";
    return null;
  }
  if (/slack/i.test(t) && /^slack_(send_message|schedule_message|add_list_comment|add_reaction|create_conversation)$/.test(leaf)) return "message people (Slack)";
  if (/gmail/i.test(t) && /^(send_message|reply|forward)$/.test(leaf)) return "message people (email)";
  if (/github/i.test(t) && /merge_pull_request/.test(leaf)) return "merge a pull request";
  if (/github/i.test(t) && /(create_pull_request_review|submit_pending_pull_request_review|pull_request_review_write)/.test(leaf)) return "post a review";
  if (/github/i.test(t) && /(add_issue_comment|add_comment|create_issue)$/.test(leaf)) return "message people (a comment on GitHub)";
  return null;
}

export function refusalReason(what: string): string {
  return `${SLEEP_MARK} — the town does not ${what} while he sleeps. It is written on his morning page; he does it (or says go) when he is back. Do not look for another way to do it tonight; carry on with everything else, or finish.`;
}

// ───────────── the morning ─────────────
/** Did this character do anything on its own worth a page? */
export function hasMorning(journal: NightEntry[]): boolean { return journal.length > 0; }

export function morningPage(who: { town: string; townName: string; id: string; name: string }, journal: NightEntry[], since: number, now: number): MorningPage {
  const of = (k: NightKind): NightEntry[] => journal.filter((e) => e.kind === k);
  return {
    town: who.town, townName: who.townName, characterId: who.id as MorningPage["characterId"], name: who.name,
    since: since || (journal[0]?.at ?? now), until: now,
    did: of("did").map((e) => e.text),
    took: of("took").map((e) => ({ question: e.question || e.text, choice: e.choice || "", why: e.why || "" })),
    parked: of("parked").map((e) => ({ question: e.question || e.text, why: e.why || "" }))
      .concat(of("open").map((e) => ({ question: e.question || e.text, why: "asked while you were away — no decision was written down, so nothing was decided for you" }))),
    auto: of("auto").map((e) => e.text),
    held: of("held").map((e) => e.text),
  };
}

/** The page as one chat bubble (Markdown) — the record that stays in the character's chat. */
export function morningBubble(p: MorningPage): string {
  const out: string[] = [`🌅 **Morning page** — while you were away (${fmtSpan(p.since, p.until)})`];
  if (p.did.length) out.push("**What I did**\n" + p.did.map((d) => `- ${d}`).join("\n"));
  if (p.took.length) out.push("**Decided for you**\n" + p.took.map((t) => `- ${t.question}\n  → **${t.choice}** — ${t.why}`).join("\n"));
  if (p.parked.length) out.push("**Still parked — needs you**\n" + p.parked.map((t) => `- ${t.question} — ${t.why}`).join("\n"));
  if (p.auto.length) out.push("**The town did for me**\n" + p.auto.map((d) => `- ${d}`).join("\n"));
  if (p.held.length) out.push("**Held back until you are here**\n" + p.held.map((d) => `- ${d}`).join("\n"));
  return out.join("\n\n");
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One Telegram message (HTML) for every page; null when nobody has one. Long
 *  nights are cut per character, never across the 4096-character limit. */
export function morningTelegram(pages: MorningPage[], multiTown: boolean): string | null {
  if (!pages.length) return null;
  const blocks = pages.map((p) => {
    const lines: string[] = [`<b>${esc(p.name)}${multiTown ? ` · ${esc(p.townName)}` : ""}</b>`];
    if (p.did.length) lines.push(`did: ${esc(clip(p.did.slice(-3).join("; "), 400))}`);
    for (const t of p.took) lines.push(`✅ ${esc(clip(t.question, 160))} → <b>${esc(clip(t.choice, 100))}</b> — ${esc(clip(t.why, 200))}`);
    for (const t of p.parked) lines.push(`🅿️ ${esc(clip(t.question, 160))} — ${esc(clip(t.why, 200))}`);
    for (const a of p.auto) lines.push(`⚙️ ${esc(clip(a, 200))}`);
    for (const h of p.held) lines.push(`✋ ${esc(clip(h, 200))}`);
    return lines.join("\n");
  });
  const took = pages.reduce((n, p) => n + p.took.length, 0), parked = pages.reduce((n, p) => n + p.parked.length, 0);
  const head = `🌅 <b>Morning page</b> — ${pages.length} character${pages.length === 1 ? "" : "s"} worked on their own: ${took} decision${took === 1 ? "" : "s"} taken for you, ${parked} still parked.`;
  let body = head;
  let left = 0;
  for (let i = 0; i < blocks.length; i++) {
    if ((body + "\n\n" + blocks[i]).length > 3800) { left = blocks.length - i; break; }
    body += "\n\n" + blocks[i];
  }
  if (left) body += `\n\n…and ${left} more — the full pages are in the town.`;
  return body;
}

function fmtSpan(a: number, b: number): string {
  const mins = Math.max(1, Math.round((b - a) / 60_000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

// ───────────── the moon button ─────────────
/** `away` = characters with something written down while the moon was off
 *  (auto-away). Pressing then hands over their pages and stays off. */
export function sleepSign(moon: boolean, since: number, away: number, now: number): SleepSign {
  if (moon) {
    return { on: true, away, label: "🌙 asleep", title: `Sleep mode is on (${fmtSpan(since || now, now)}): nobody waits for you. Characters take their own default and write it down, park the hard questions, keep cooking at check-ins, and never merge, post a review, message people or create Jira tickets. Press when you are back — you get one morning page per character.` };
  }
  if (away > 0) {
    return { on: false, away, label: `🌙 ${away} page${away === 1 ? "" : "s"}`, title: `${away} character${away === 1 ? "" : "s"} went on without you after a question sat unanswered for 20 minutes. Press to read ${away === 1 ? "its morning page" : "their morning pages"}.` };
  }
  return { on: false, away: 0, label: "🌙", title: "Sleep mode: off. Press before you leave — characters stop waiting for you, take their own default and write it down. (A question unanswered for 20 minutes goes this way by itself.)" };
}

/** What a press does. */
export function moonPress(moon: boolean, away: number): { moon: boolean; morning: boolean } {
  if (moon) return { moon: false, morning: true };
  if (away > 0) return { moon: false, morning: true };
  return { moon: true, morning: false };
}
