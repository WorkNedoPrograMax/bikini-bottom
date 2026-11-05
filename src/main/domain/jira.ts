// The Jira page of the Mailbox — the PURE part. Jira's answers (issues with
// their change history, comments as ADF documents) → the paper's lines:
// who tagged Maksym, what of his was moved back or handed to him, what moved
// forward, what sits quiet, and how many tickets stand in each column. No
// I/O. scripts/check-jira.mjs runs this against today's real shapes.
//
// Not a copy of Jira (Maksym, 2026-11-05): only what changed and what needs
// him. A line is "for you" until he has looked at the page (the `seen` set).

import type { JiraLine, JiraWord } from "../../shared/ipc";

/** One issue as `POST /rest/api/3/search/jql` returns it (the fields we ask for,
 *  plus `expand: changelog`). Measured 2026-11-05: 45 issues, 2 s, one call. */
export interface JiraRawIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    updated?: string;
    status?: { name?: string; statusCategory?: { key?: string; name?: string } } | null;
    assignee?: { accountId?: string; displayName?: string } | null;
    issuetype?: { name?: string; subtask?: boolean } | null;
    parent?: { key?: string } | null;
  };
  changelog?: { histories?: JiraHistory[] } | null;
}

export interface JiraHistory {
  id: string;
  created: string;
  author?: { accountId?: string; displayName?: string } | null;
  items?: { field?: string; from?: string | null; to?: string | null; fromString?: string | null; toString?: string | null }[];
}

/** One comment as `GET /rest/api/3/issue/{key}/comment` returns it. The body is
 *  an ADF document; a mention is a node `{ type: "mention", attrs: { id, text } }`. */
export interface JiraRawComment {
  id: string;
  created: string;
  author?: { accountId?: string; displayName?: string } | null;
  body?: unknown;
}

/** The board's columns, left to right. "QA Failed" is always a step back. */
export const COLUMNS = ["To Do", "In Progress", "Code Review", "Review Completed", "Ready for QA", "In QA", "Release Ready", "Done"] as const;
export function columnIndex(status: string | null | undefined): number {
  const i = COLUMNS.findIndex((c) => c.toLowerCase() === String(status || "").trim().toLowerCase());
  return i;
}

/** Every account id mentioned in an ADF document. */
export function adfMentions(body: unknown): string[] {
  const out: string[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "mention" && n.attrs && typeof n.attrs.id === "string") out.push(n.attrs.id);
    if (n.content) walk(n.content);
  };
  walk(body);
  return out;
}

/** The plain words of an ADF document, one line, mentions as "@Name". */
export function adfText(body: unknown): string {
  const parts: string[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    else if (n.type === "mention") parts.push(String(n.attrs?.text || "@someone"));
    else if (n.type === "hardBreak") parts.push(" ");
    if (n.content) { walk(n.content); if (n.type === "paragraph" || n.type === "listItem" || n.type === "heading") parts.push(" "); }
  };
  walk(body);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** "Anna Pinchuk" → "Anna". */
export function firstName(displayName: string | null | undefined): string {
  const s = String(displayName || "").trim();
  return s ? s.split(/\s+/)[0] : "someone";
}

const DAY = 24 * 3600 * 1000;

export interface JiraInput {
  /** Every issue fetched: Maksym's open ones (with changelog) and the ones with comments mentioning him. */
  issues: readonly JiraRawIssue[];
  /** Comments by issue key, newest first — only for the issues the "tagged" search returned. */
  comments: Readonly<Record<string, readonly JiraRawComment[]>>;
  /** Maksym's Atlassian account id. */
  me: string;
  /** Epoch ms now (injected so checks are deterministic). */
  now: number;
  /** Line ids Maksym has already looked at (the page was open). */
  seen: ReadonlySet<string>;
  /** "https://empat.atlassian.net" — for the lines' links. */
  site: string;
}

const WORD_TEXT: Record<JiraWord, string> = { tagged: "TAGGED YOU", "sent-back": "SENT BACK", assigned: "NEWLY YOURS", moved: "MOVED", quiet: "QUIET" };

/** The lines of the Jira page, unsorted (jiraRank orders them). */
export function jiraLines(input: JiraInput): JiraLine[] {
  const { issues, comments, me, now, seen, site } = input;
  const out: JiraLine[] = [];
  const byKey = new Map<string, JiraRawIssue>();
  for (const i of issues) byKey.set(i.key, i);
  const line = (i: JiraRawIssue, id: string, word: JiraWord, reason: string, since: number, who: string, forYouWhenUnseen: boolean): JiraLine => ({
    id, key: i.key, title: i.fields.summary || i.key, url: `${site}/browse/${i.key}`, status: i.fields.status?.name || "", word,
    label: WORD_TEXT[word], reason, forYou: forYouWhenUnseen && !seen.has(id), since, who,
    mine: (i.fields.assignee?.accountId || "") === me,
  });

  for (const i of byKey.values()) {
    const mine = (i.fields.assignee?.accountId || "") === me;
    // Tagged: the newest comment by someone else that mentions me, in the last 7 days.
    const tags = (comments[i.key] || []).filter((c) => (c.author?.accountId || "") !== me && adfMentions(c.body).includes(me) && now - Date.parse(c.created) < 7 * DAY)
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    if (tags.length) {
      const c = tags[0];
      const text = adfText(c.body);
      const more = tags.length > 1 ? ` · +${tags.length - 1} more` : "";
      out.push(line(i, `tagged:${c.id}`, "tagged", `${firstName(c.author?.displayName)}: “${text.slice(0, 140)}${text.length > 140 ? "…" : ""}”${more}`, Date.parse(c.created) || now, firstName(c.author?.displayName), true));
    }
    // From the change history (last 2 days, by someone else): moved back, moved forward, handed to me.
    const hist = (i.changelog?.histories || []).filter((h) => (h.author?.accountId || "") !== me && now - Date.parse(h.created) < 2 * DAY)
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    const lastStatus = hist.find((h) => (h.items || []).some((x) => x.field === "status"));
    if (lastStatus && mine) {
      const x = (lastStatus.items || []).find((y) => y.field === "status")!;
      const from = x.fromString || "", to = x.toString || "";
      const back = to.toLowerCase() === "qa failed" || (columnIndex(to) >= 0 && columnIndex(from) >= 0 && columnIndex(to) < columnIndex(from));
      const who = firstName(lastStatus.author?.displayName);
      const at = Date.parse(lastStatus.created) || now;
      if (back) out.push(line(i, `sent-back:${i.key}:${lastStatus.id}`, "sent-back", `${who} moved it back: ${from} → ${to}`, at, who, true));
      else if (now - at < DAY) out.push(line(i, `moved:${i.key}:${lastStatus.id}`, "moved", `${who} moved it on: ${from} → ${to}`, at, who, false));
    }
    const handed = hist.find((h) => (h.items || []).some((x) => x.field === "assignee" && x.to === me));
    if (handed && mine) {
      const who = firstName(handed.author?.displayName);
      out.push(line(i, `assigned:${i.key}:${handed.id}`, "assigned", `${who} handed it to you · ${i.fields.status?.name || ""}`, Date.parse(handed.created) || now, who, true));
    }
    // Quiet: mine, In Progress, nothing happened for 3+ days.
    const upd = Date.parse(i.fields.updated || "") || now;
    if (mine && String(i.fields.status?.name || "").toLowerCase() === "in progress" && now - upd >= 3 * DAY) {
      out.push(line(i, `quiet:${i.key}`, "quiet", `in progress, nothing for ${Math.floor((now - upd) / DAY)} days — still on it?`, upd, "", false));
    }
  }
  return batchHandovers(out, site).sort((a, b) => jiraRank(a) - jiraRank(b) || b.since - a.since);
}

/** More than three tickets handed over by the same person on the same day are
 *  ONE line, not a wall (Alona handed Maksym 25 on 2026-11-05 — "not a copy
 *  of Jira"). The line links to those tickets as a Jira search. */
export const HANDOVER_BATCH = 3;
export function batchHandovers(lines: JiraLine[], site: string): JiraLine[] {
  const groups = new Map<string, JiraLine[]>();
  for (const l of lines) if (l.word === "assigned") { const k = `${l.who}|${new Date(l.since).toISOString().slice(0, 10)}`; groups.set(k, [...(groups.get(k) || []), l]); }
  const out = lines.filter((l) => l.word !== "assigned");
  for (const [k, g] of groups) {
    if (g.length <= HANDOVER_BATCH) { out.push(...g); continue; }
    const who = g[0].who, day = k.split("|")[1];
    const statuses = new Map<string, number>();
    for (const l of g) statuses.set(l.status, (statuses.get(l.status) || 0) + 1);
    const keys = g.map((l) => l.key).sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
    const jql = `project = ${keys[0].split("-")[0]} AND key in (${keys.join(", ")}) ORDER BY key`;
    out.push({
      id: `assigned-batch:${who}:${day}`, key: `×${g.length}`, title: `${g.length} tickets from ${who}`,
      url: `${site}/issues/?jql=${encodeURIComponent(jql)}`, status: "", word: "assigned", label: "NEWLY YOURS",
      reason: `${who} handed you ${g.length} tickets · ${[...statuses].map(([s, n]) => `${n} ${s}`).join(", ")} · ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "…" : ""}`,
      forYou: g.some((l) => l.forYou), since: Math.max(...g.map((l) => l.since)), who, mine: true,
    });
  }
  return out;
}

const RANK: Record<JiraWord, number> = { tagged: 0, "sent-back": 0, assigned: 1, quiet: 2, moved: 3 };
export function jiraRank(l: JiraLine): number { return (l.forYou ? 0 : 10) + RANK[l.word]; }

/** How many lines need Maksym (the number on the flag, next to the mail's). */
export function jiraForYou(lines: readonly JiraLine[]): number { return lines.filter((l) => l.forYou).length; }

/** Pings fire once per line id — a new tag, a new move, a new hand-over. */
export function newJiraPings(lines: readonly JiraLine[], already: ReadonlySet<string>): JiraLine[] {
  return lines.filter((l) => l.forYou && !already.has(l.id));
}

/** The plate: how many of Maksym's open tickets stand in each column, board order. */
export function plateCounts(issues: readonly JiraRawIssue[], me: string): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of issues) {
    if ((i.fields.assignee?.accountId || "") !== me) continue;
    const s = i.fields.status?.name || "?";
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const order = (s: string) => { const i = columnIndex(s); return i < 0 ? 50 : i; };
  return [...counts].map(([status, count]) => ({ status, count })).sort((a, b) => order(a.status) - order(b.status) || a.status.localeCompare(b.status));
}

/** The ticket a PR belongs to, from its branch ("feature/HIGHCAP-275-plan-view")
 *  or its title ("[HIGHCAP-275] Plan tab…"); null when neither names one. */
export function ticketKeyOf(branch: string, title: string, project?: string): string | null {
  const re = project ? new RegExp(`\\b(${project}-\\d+)\\b`) : /\b([A-Z][A-Z0-9]+-\d+)\b/;
  const m = branch.match(re) || title.match(re);
  return m ? m[1] : null;
}

/** The board's moves, by the transition names Jira offers (measured 2026-11-05 on
 *  HIGHCAP: strict and linear). A move is allowed only from its one column. */
export const MOVES = {
  start: { from: "To Do", to: "In Progress", transition: "Start work" },
  review: { from: "In Progress", to: "Code Review", transition: "To review" },
  approved: { from: "Code Review", to: "Review Completed", transition: "Review approved" },
  changes: { from: "Code Review", to: "In Progress", transition: "Changes requested" },
} as const;

/** After Maksym merged a PR from the town: the ticket, if it still sits in
 *  Code Review, moves to Review Completed (the merge IS the approval). From any
 *  other column: nothing — "Deployed, ready for QA" is the deploy's step, never
 *  the town's. Returns the move to make, or the one-line reason there is none. */
export function moveAfterMerge(status: string | null | undefined): { ok: true; move: typeof MOVES.approved } | { ok: false; why: string } {
  const s = String(status || "").trim();
  if (!s) return { ok: false, why: "the ticket could not be read" };
  if (s.toLowerCase() === MOVES.approved.from.toLowerCase()) return { ok: true, move: MOVES.approved };
  if (columnIndex(s) > columnIndex(MOVES.approved.from)) return { ok: false, why: `already past Code Review (${s})` };
  return { ok: false, why: `not in Code Review (${s}) — the PR was merged before the ticket was sent to review` };
}

/** The sweep: a character's order to check that every ticket of Maksym's sits
 *  where the work says it should, propose the moves in ONE question, apply his
 *  picks. Pure text; the character does the reading and the moving. */
export function sweepBrief(input: { project: string; site: string; plate: readonly { status: string; count: number }[]; open: number; repos: readonly string[] }): string {
  const { project, site, plate, open, repos } = input;
  const counts = plate.map((p) => `${p.status} ${p.count}`).join(" · ") || "none";
  return `Sweep the Jira board for me: project ${project} on ${site}. I have ${open} open tickets (${counts}). Check that each one sits where the work says it should, then ask me ONCE what to move.

How the board works (strict, these are the only moves, by their transition names): To Do —"Start work"→ In Progress —"To review"→ Code Review —"Review approved"→ Review Completed —"Deployed, ready for QA"→ Ready for QA; Code Review —"Changes requested"→ In Progress. "Deployed, ready for QA", In QA, Done and Release Ready are never yours to move; never change assignees; never create tickets.

Do, in this order:
1. Read my open tickets with the Atlassian MCP: JQL \`project = ${project} AND assignee = currentUser() AND statusCategory != Done\` (key, summary, status, links, sub-tasks, parent, last updated).
2. For each, find the work behind it on GitHub${repos.length ? ` (${repos.join(", ")})` : ""}: \`gh pr list -R <repo> --state all --search "<KEY>" --json number,state,isDraft,mergedAt,reviewDecision,headRefName\` and \`git branch -r | grep <KEY>\`.
3. Apply the rules and collect proposals:
   - In To Do, but a branch or PR with its key exists → propose In Progress (or Code Review when a non-draft PR is open).
   - In Progress, a non-draft PR open for review → propose Code Review.
   - In Code Review, but the PR is merged → propose Review Completed.
   - In Code Review, but the PR has changes requested and nothing pushed since → say so (the mailbox already shows it; no move).
   - In Progress with no commit and no comment for 3+ days → ask: still on it, or park it (back to To Do)?
   - Blocked by an unfinished linked ticket ("is blocked by" link, or a [BE] sibling sub-task of an [FE] one that is not past Code Review) → propose flagging it (the Impediment flag / a one-line comment "blocked by KEY"), no column move.
   - Every sub-task Done or past the parent's column, parent behind → propose moving the parent along.
   Nothing to propose for a ticket → leave it out.
4. Ask me ONCE with ask_maksym: the story = the board in 3–5 plain sentences (how many tickets, how many look fine, what is out of place and why); one question per proposal, short, with the options "Move it" / "Leave it" (and "Flag as blocked" where that applies), the ticket named in the question. No proposals at all → no question: say "the board is in order" and stop.
5. Apply exactly what I picked: \`getTransitionsForJiraIssue\` → the transition whose name matches → \`transitionJiraIssue\`; one short comment on each moved ticket saying why (the PR, the merge, the sweep). A transition that is not offered: skip it and tell me in one line.
6. Finish with one short message: what moved, what was flagged, what you left.`;
}

/** "HIGHCAP" from a lifecycle config's projectKeys, or null. */
export function projectFromLifecycle(raw: unknown): string | null {
  const keys = (raw as { jira?: { projectKeys?: unknown } } | null)?.jira?.projectKeys;
  return Array.isArray(keys) && typeof keys[0] === "string" && /^[A-Z][A-Z0-9]+$/.test(keys[0]) ? keys[0] : null;
}
