// The Mailbox — pull requests on a team repo, worded as mail. PURE: this file
// turns GitHub's answers (as `gh` prints them) into the lines the paper shows,
// and decides which of them need Maksym. No fs, no network, no Electron — so
// scripts/check-mail.mjs can run it with recorded answers.
//
// GitHub's own "reviewDecision" is NOT used: on a repo whose ruleset requires 0
// approvals it comes back "" even after an APPROVED (highcap-mobile #87,
// 2026-11-04). The words are derived from the latest review per person, the
// last push time, the open comment threads and the collision state.

import type { MailLine, MailWord, CharacterId } from "../../shared/ipc";

/** One open pull request as `gh pr list --json …` prints it (the fields we read). */
export interface GhPull {
  number: number;
  title: string;
  url: string;
  author: { login: string };
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  /** "MERGEABLE" | "CONFLICTING" | "UNKNOWN" */
  mergeable: string;
  /** "CLEAN" | "BLOCKED" | "DIRTY" | "UNSTABLE" | "BEHIND" | "UNKNOWN" | … */
  mergeStateStatus: string;
  statusCheckRollup?: { conclusion?: string | null; state?: string | null; status?: string | null; name?: string; context?: string }[] | null;
  reviews?: { author: { login: string }; state: string; submittedAt: string }[] | null;
  commits?: { committedDate: string }[] | null;
  /** Logins with a review request PENDING right now (cleared when they review). */
  requested?: string[] | null;
}

/** An open (unresolved) review thread, from GraphQL. */
export interface GhThread {
  isResolved: boolean;
  isOutdated?: boolean;
  /** The thread's comments, first one first: who opened it and what it says. */
  comments: { author: string; body: string; path?: string | null; line?: number | null }[];
}

export type ChecksWord = "green" | "red" | "pending" | "none";

/** Red if any check failed; pending while any is still running; green when all
 *  concluded well; none when the repo runs no checks. */
export function checksWord(rollup: GhPull["statusCheckRollup"]): ChecksWord {
  if (!rollup || !rollup.length) return "none";
  let pending = false;
  for (const c of rollup) {
    const w = String(c.conclusion || c.state || "").toUpperCase();
    if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(w)) return "red";
    if (!w || ["PENDING", "IN_PROGRESS", "QUEUED", "EXPECTED", "WAITING", "REQUESTED"].includes(w) || String(c.status || "").toUpperCase() === "IN_PROGRESS") pending = true;
  }
  return pending ? "pending" : "green";
}

/** Each reviewer's LATEST verdict (APPROVED | CHANGES_REQUESTED), with a
 *  DISMISSED one counting as no verdict (the repo throws reviews away on push).
 *  COMMENTED reviews carry no verdict but still mark that the person looked. */
export function latestVerdicts(reviews: GhPull["reviews"], author: string): Map<string, { verdict: "APPROVED" | "CHANGES_REQUESTED" | null; lookedAt: number }> {
  const out = new Map<string, { verdict: "APPROVED" | "CHANGES_REQUESTED" | null; lookedAt: number }>();
  for (const r of (reviews || []).slice().sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))) {
    const who = r.author?.login;
    if (!who || who === author) continue;
    const prev = out.get(who) || { verdict: null, lookedAt: 0 };
    const at = Date.parse(r.submittedAt) || 0;
    const s = String(r.state || "").toUpperCase();
    if (s === "APPROVED" || s === "CHANGES_REQUESTED") out.set(who, { verdict: s, lookedAt: Math.max(prev.lookedAt, at) });
    else if (s === "DISMISSED") out.set(who, { verdict: null, lookedAt: Math.max(prev.lookedAt, at) });
    else out.set(who, { verdict: prev.verdict, lookedAt: Math.max(prev.lookedAt, at) }); // COMMENTED / PENDING
  }
  return out;
}

/** Epoch ms of the last push (the newest commit), 0 when unknown. */
export function lastPushAt(pr: GhPull): number {
  let t = 0;
  for (const c of pr.commits || []) t = Math.max(t, Date.parse(c.committedDate) || 0);
  return t;
}

const WORD_TEXT: Record<MailWord, string> = {
  "sent-back": "SENT BACK", almost: "ALMOST", "clean-plate": "CLEAN PLATE", "your-turn": "YOUR TURN",
  "look-again": "LOOK AGAIN", "with-reviewer": "WAITING", theirs: "THEIRS", draft: "DRAFT",
};

/** A login as the paper says it: "AnnaPinchukO" → "Anna", "mbr-cloud" → "mbr-cloud". */
export function firstName(login: string): string {
  const m = /^([A-Z][a-z]+)/.exec(login);
  return m ? m[1] : login;
}

function plural(n: number, one: string, many: string): string { return `${n} ${n === 1 ? one : many}`; }

/** The pieces that block a merge, in words: "collides with dev", "checks red", "3 comments still open". */
function blockers(pr: GhPull, checks: ChecksWord, unresolved: number): string[] {
  const out: string[] = [];
  if (pr.mergeable === "CONFLICTING") out.push(`collides with ${pr.baseRefName}`);
  if (checks === "red") out.push("checks red");
  if (unresolved > 0) out.push(`${plural(unresolved, "comment", "comments")} still open`);
  return out;
}

/** One PR → one line on the paper. `me` is Maksym's GitHub login. */
export function mailLineFor(pr: GhPull, threads: GhThread[], me: string): MailLine {
  const author = pr.author?.login || "";
  const mine = author === me;
  const open = threads.filter((t) => !t.isResolved);
  const unresolved = open.length;
  const mineOpen = open.filter((t) => t.comments[0]?.author === me).length;
  // A thread is "to answer" only while someone ELSE had the last word. One I
  // answered is still open on GitHub (the repo wants every thread resolved
  // before merge) but the ball is with the reviewer — measured 2026-11-05 on
  // #87: two of Anna's threads, both replied to, were read as "2 to answer".
  const toAnswer = open.filter((t) => t.comments.length && t.comments[t.comments.length - 1]?.author !== me).length;
  const answered = unresolved - toAnswer;
  // Answering and pushing is not enough: the reviewer must be ASKED again, or
  // the PR sits unnoticed (Maksym, 2026-11-05). "Asked" = a review request
  // pending for them on GitHub (it clears when they submit a review).
  const requested = new Set(pr.requested || []);
  const asked = (w: string) => requested.has(w);
  const answeredBy = [...new Set(open.filter((t) => t.comments.length && t.comments[t.comments.length - 1]?.author === me).map((t) => t.comments[0]?.author).filter((w): w is string => !!w && w !== me))];
  const checks = checksWord(pr.statusCheckRollup);
  const conflicts = pr.mergeable === "CONFLICTING";
  const verdicts = latestVerdicts(pr.reviews, author);
  const pushedAt = lastPushAt(pr);
  const approvedBy = [...verdicts].filter(([, v]) => v.verdict === "APPROVED").map(([who]) => who);
  const changesBy = [...verdicts].filter(([, v]) => v.verdict === "CHANGES_REQUESTED").map(([who]) => who);
  const names = (list: string[]) => list.map(firstName).join(" and ");
  const since = Math.max(0, Date.parse(pr.updatedAt) || Date.parse(pr.createdAt) || 0);

  let word: MailWord; let reason: string; let forYou = false; let canMerge = false; let canHandOff = false; let askBack: string[] = [];
  if (pr.isDraft) {
    word = "draft"; reason = mine ? "your draft — not sent out yet" : `${firstName(author)}'s draft — not sent out yet`;
  } else if (mine) {
    const blocks = blockers(pr, checks, unresolved);
    // "Changes requested" stands on GitHub until the reviewer looks again — a
    // push does NOT dismiss it (only approvals go stale). So it is sent back
    // only until the fix is pushed after her look and every thread answered;
    // then the ball is on her table (measured 2026-11-05 on #102).
    const lastLook = Math.max(0, ...changesBy.map((w) => verdicts.get(w)?.lookedAt || 0));
    const pushedAfterVerdict = pushedAt > lastLook;
    const hard = blocks.filter((b) => !b.endsWith("still open"));
    const notAsked = changesBy.filter((w) => !asked(w));
    if (changesBy.length && pushedAfterVerdict && !toAnswer && !hard.length && !notAsked.length) {
      word = "with-reviewer";
      reason = `${names(changesBy)} asked for changes · fixed and pushed` + (answered ? ` · ${plural(answered, "comment", "comments")} answered` : "") + ` · ${names(changesBy)} asked to look again ✓`;
    } else if (changesBy.length && pushedAfterVerdict && !toAnswer && !hard.length) {
      word = "sent-back"; forYou = true; canHandOff = true; askBack = notAsked;
      reason = `${names(changesBy)} asked for changes · fixed and pushed` + (answered ? ` · ${plural(answered, "comment", "comments")} answered` : "") + ` · but ${names(notAsked)} ${notAsked.length > 1 ? "weren't" : "wasn't"} asked to look again`;
    } else if (changesBy.length) {
      word = "sent-back"; forYou = true; canHandOff = true;
      const talk = toAnswer ? ` · ${plural(toAnswer, "comment", "comments")} to answer` : answered ? ` · all ${plural(answered, "comment", "comments")} answered` : "";
      const push = !pushedAfterVerdict && !toAnswer ? ` · push the fix so ${names(changesBy)} looks again` : "";
      reason = `${names(changesBy)} asked for changes` + talk + (hard.length ? ` · also ${hard.join(", ")}` : "") + push;
    } else if (approvedBy.length && blocks.length) {
      word = "almost"; forYou = true; canHandOff = true;
      reason = `${names(approvedBy)} approved ✓ · but it ${blocks.join(" and ")} — fix that, then it's yours to merge`;
    } else if (approvedBy.length && checks === "pending") {
      word = "almost"; reason = `${names(approvedBy)} approved ✓ · checks still running — merge when they're green`;
    } else if (approvedBy.length) {
      word = "clean-plate"; forYou = true; canMerge = true;
      reason = `${names(approvedBy)} approved ✓` + (checks === "green" ? " · checks green ✓" : "") + ` · no collisions ✓`;
    } else if (toAnswer || conflicts || checks === "red") {
      word = "sent-back"; forYou = true; canHandOff = true;
      const looked = [...verdicts.keys()];
      reason = (toAnswer ? `${plural(toAnswer, "comment", "comments")} to answer` : "") + (toAnswer && hard.length ? " · also " : "") + hard.join(", ")
        + (answered ? ` · ${answered} answered, waiting to be closed` : "") + (looked.length ? "" : " — fix it before anyone looks");
    } else if (answered && answeredBy.some((w) => !asked(w))) {
      word = "sent-back"; forYou = true; canHandOff = true; askBack = answeredBy.filter((w) => !asked(w));
      reason = `${plural(answered, "comment", "comments")} answered · but ${names(askBack)} ${askBack.length > 1 ? "weren't" : "wasn't"} asked to look again`;
    } else {
      word = "with-reviewer";
      const looked = [...verdicts.keys()];
      reason = answered ? `${plural(answered, "comment", "comments")} answered · ${names(answeredBy.length ? answeredBy : looked)} asked to look again ✓ — nothing for you`
        : looked.length ? `on ${names(looked)}'s table — nothing for you` : "waiting for a review — nothing for you";
    }
  } else {
    const my = verdicts.get(me) || null;
    const myLooked = my?.lookedAt || 0;
    const pushedSince = myLooked > 0 && pushedAt > myLooked;
    if (!my) {
      word = "your-turn"; forYou = true; canHandOff = true;
      const others = approvedBy.filter((w) => w !== me);
      reason = `${firstName(author)}'s · waiting for your review` + (others.length ? ` · ${names(others)} approved already` : "");
    } else if (pushedSince || my.verdict === null) {
      word = "look-again"; forYou = true; canHandOff = true;
      reason = `${firstName(author)} pushed since you looked — your old review no longer counts`;
    } else if (my.verdict === "APPROVED") {
      word = "theirs";
      reason = `you approved · ${firstName(author)}'s to merge` + (mineOpen ? ` · ${plural(mineOpen, "of your comments is", "of your comments are")} still open — close them so it can go` : unresolved ? ` · ${plural(unresolved, "comment", "comments")} still open` : "");
      if (mineOpen) forYou = true; // your own open threads block her merge — that IS for you
    } else {
      word = "theirs";
      reason = `you asked for changes · waiting on ${firstName(author)}`;
    }
  }
  const reviewers = [...new Set([...verdicts.keys(), ...open.map((t) => t.comments[0]?.author).filter((w): w is string => !!w && w !== author)])];
  const status = word === "sent-back" && askBack.length ? `ASK ${firstName(askBack[0]).toUpperCase()}`
    : word === "with-reviewer" && verdicts.size ? `WITH ${firstName([...verdicts.keys()][0]).toUpperCase()}`
    : word === "theirs" && forYou ? "YOUR COMMENTS" // approved, but your own open threads hold it — the word says so
    : WORD_TEXT[word];
  return {
    number: pr.number, title: pr.title, url: pr.url, author, mine, draft: !!pr.isDraft,
    word, status, reason, forYou, canMerge, canHandOff, askBack, reviewers, onIt: null, since, branch: pr.headRefName, base: pr.baseRefName,
    unresolved, conflicts, checks,
  };
}

/** A character is on a line (handed from the paper, still cooking): the line
 *  becomes "in progress" — not yours, no buttons, no ping — until the
 *  character finishes and the next look at GitHub says what came of it.
 *  Pure: `onIt` maps PR number → who, `working` says whether they still are. */
export function markOnIt(lines: readonly MailLine[], onIt: ReadonlyMap<number, { characterId: string; name: string; since: number }>, working: (characterId: string) => boolean): MailLine[] {
  return lines.map((l) => {
    const o = onIt.get(l.number);
    if (!o || !working(o.characterId)) return l;
    return { ...l, onIt: { characterId: o.characterId as CharacterId, name: o.name, since: o.since }, forYou: false, canMerge: false, canHandOff: false, askBack: [], status: `${o.name.toUpperCase()} IS ON IT`, reason: `${o.name} is on it · was: ${l.reason}` };
  });
}

/** The whole paper: lines with what needs you first. */
export function mailLines(pulls: GhPull[], threadsByNumber: Record<number, GhThread[]>, me: string): MailLine[] {
  const lines = pulls.map((pr) => mailLineFor(pr, threadsByNumber[pr.number] || [], me));
  return lines.sort((a, b) => mailRank(a) - mailRank(b) || b.since - a.since);
}

const RANK: Record<MailWord, number> = { "sent-back": 0, almost: 1, "clean-plate": 2, "look-again": 3, "your-turn": 4, "with-reviewer": 5, theirs: 6, draft: 7 };
export function mailRank(l: MailLine): number { return (l.forYou ? 0 : 10) + RANK[l.word]; }

/** How many lines need Maksym (the number on the flag). */
export function forYouCount(lines: readonly MailLine[]): number { return lines.filter((l) => l.forYou).length; }

/** The keys the phone has already been pinged about: "<number>:<word>". A ping
 *  fires once per PR per word — a PR that goes sent-back → clean-plate pings
 *  again, the same word twice does not. */
export function pingKey(l: MailLine): string { return `${l.number}:${l.word}`; }
export function newPings(lines: readonly MailLine[], already: ReadonlySet<string>): MailLine[] {
  return lines.filter((l) => l.forYou && !already.has(pingKey(l)));
}

/** The guard before a merge from the town: Maksym's own PR, on a clean plate,
 *  as GitHub says RIGHT NOW. Returns the one-line reason it must not merge, or null. */
export function mergeRefusal(line: MailLine | null, fresh: GhPull | null): string | null {
  if (!line) return "that PR isn't on the paper anymore";
  if (!line.mine) return `#${line.number} is ${firstName(line.author)}'s — hers to merge`;
  if (!fresh) return "GitHub didn't answer — try again in a moment";
  if (fresh.isDraft) return `#${line.number} is still a draft`;
  if (fresh.mergeable === "CONFLICTING") return `#${line.number} collides with ${fresh.baseRefName} now`;
  if (checksWord(fresh.statusCheckRollup) === "red") return `#${line.number}'s checks are red`;
  if (checksWord(fresh.statusCheckRollup) === "pending") return `#${line.number}'s checks are still running`;
  const v = latestVerdicts(fresh.reviews, fresh.author?.login || "");
  if (![...v.values()].some((x) => x.verdict === "APPROVED")) return `#${line.number} has no approval right now`;
  if ([...v.values()].some((x) => x.verdict === "CHANGES_REQUESTED")) return `#${line.number} has changes requested`;
  if (String(fresh.mergeStateStatus).toUpperCase() === "BLOCKED") return `#${line.number} is blocked on GitHub (open comments?)`;
  if (String(fresh.mergeStateStatus).toUpperCase() === "DIRTY") return `#${line.number} collides with ${fresh.baseRefName} now`;
  return null;
}

/** The order a character gets when Maksym hands a line to it. Plain words, the
 *  branch, every open comment quoted, and what "done" means. */
export function briefFor(line: MailLine, threads: GhThread[], repo: string): string {
  const open = threads.filter((t) => !t.isResolved);
  const quote = (t: GhThread) => {
    const c = t.comments[0];
    const where = c?.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : "";
    const rest = t.comments.slice(1).map((x) => `    ↳ ${firstName(x.author)}: ${x.body.trim().replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
    return `- ${firstName(c?.author || "someone")}${where}: ${(c?.body || "").trim().replace(/\s+/g, " ").slice(0, 600)}${rest ? "\n" + rest : ""}`;
  };
  const head = `Pull request #${line.number} on ${repo}: "${line.title}" (${line.url}).\nBranch: ${line.branch} → ${line.base}.`;
  if (line.mine) {
    const todo: string[] = [];
    if (open.length) todo.push(`answer every open review comment below — fix what it asks, or reply on the thread saying why not; resolve each thread you fixed`);
    if (line.conflicts) todo.push(`bring the branch up to date with ${line.base} and resolve the collision`);
    if (line.checks === "red") todo.push("make the checks green");
    const who = line.reviewers.length ? line.reviewers : line.askBack;
    if (who.length) todo.push(`push, then ASK the reviewer to look again — \`gh pr edit ${line.number} -R ${repo} --add-reviewer ${who.join(",")}\` — this is the one GitHub write besides the push and the thread replies, and it is never skipped: an answered PR nobody was asked to re-review sits unnoticed`);
    else todo.push("push");
    todo.push("then tell me in one short message what changed and that it is back on the reviewer's table");
    return `${head}\n\nThis is my PR and it was sent back. Get its branch into your lane first — \`git fetch origin ${line.branch} && git checkout -B ${line.branch} origin/${line.branch}\` (if git says the branch is checked out elsewhere, use \`git checkout --detach origin/${line.branch}\` and push with \`git push origin HEAD:${line.branch}\`). Never start from ${line.base}. Then:\n${todo.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nNever merge it, never push to ${line.base}, never close the PR.` +
      (open.length ? `\n\nOpen review comments (${open.length}):\n${open.map(quote).join("\n")}` : "");
  }
  return `${head}\n\nThis is ${firstName(line.author)}'s PR and it is my turn to review it. Read the whole diff against ${line.base}, run what CI runs, and write me a review draft: a one-line verdict (approve / request changes), then each finding with the file, what is wrong and the one-line fix — plain words, most important first. Post NOTHING on GitHub yourself: I post the review.` +
    (open.length ? `\n\nThreads already open on it (${open.length}):\n${open.map(quote).join("\n")}` : "");
}

/** "git@github.com:Owner/repo.git" / "https://github.com/Owner/repo" → "Owner/repo", else null. */
export function repoFromRemote(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}
