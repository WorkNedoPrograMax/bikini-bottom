// The GitHub adapter for the Mailbox. Talks to GitHub ONLY through the `gh`
// CLI that is already logged in as Maksym on this Mac — no token of its own,
// nothing stored. Reads: the open PRs of a repo with their reviews, last push,
// checks and open comment threads — ONE GraphQL call per look (`gh pr list
// --json commits` blows GitHub's node budget: "600,000 possible nodes",
// measured 2026-11-04). Writes: exactly one — merging a PR that main.ts has
// guarded (mergeRefusal). Electron launched from the Dock has a bare PATH, so
// Homebrew's bin is added.

import { execFile } from "node:child_process";
import type { GhPull, GhThread } from "../domain/mail";
import { repoFromRemote } from "../domain/mail";
import { log } from "../log";

const ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin:/bin"}`, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" };

function run(cmd: string, args: string[], cwd: string | undefined, timeout = 30_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, env: ENV, timeout, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => {
      resolve({ ok: !e, out: String(stdout || "").trim(), err: String(stderr || e?.message || "").trim() });
    });
  });
}

/** Maksym's GitHub login as `gh` sees it, or null when gh is missing/logged out. */
export async function ghLogin(): Promise<string | null> {
  const r = await run("gh", ["api", "user", "--jq", ".login"], undefined, 20_000);
  if (!r.ok || !r.out) { log("mail", "gh login unavailable", { err: r.err.slice(0, 200) }); return null; }
  return r.out;
}

/** "Owner/repo" of the project's origin remote, or null (no remote, not GitHub). */
export async function repoOf(projectPath: string): Promise<string | null> {
  const r = await run("git", ["remote", "get-url", "origin"], projectPath, 10_000);
  return r.ok ? repoFromRemote(r.out) : null;
}

/** The fields one open PR brings back, with the pieces `gh pr list` could not
 *  carry cheaply: the LAST commit only (its date + its checks), the reviews,
 *  and the review threads with their first comments. */
const PR_NODE = `
  number title url isDraft headRefName baseRefName createdAt updatedAt mergeable mergeStateStatus
  author { login }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state contexts(first: 20) { nodes {
    __typename
    ... on CheckRun { name status conclusion }
    ... on StatusContext { context state }
  } } } } } }
  reviews(last: 40) { nodes { author { login } state submittedAt } }
  reviewRequests(first: 10) { nodes { requestedReviewer { __typename ... on User { login } } } }
  reviewThreads(first: 60) { nodes { isResolved isOutdated
    opening: comments(first: 1) { nodes { id author { login } body path line } }
    tail: comments(last: 4) { nodes { id author { login } body path line } } } }`;
// One look costs ~20 rate-limit points of GitHub's 5000/hour (measured 2026-11-05;
// the fuller shape — 50 PRs, 100 threads, 10 comments each — cost 53). The thread's
// OPENING comment says who asked; its TAIL says who had the last word.

const MERGE_INFO = "Accept: application/vnd.github.merge-info-preview+json";

/** The open PRs of a repo, with their threads. Throws with a one-line reason. */
export async function fetchPulls(repo: string): Promise<{ pulls: GhPull[]; threads: Record<number, GhThread[]> }> {
  const [owner, name] = repo.split("/");
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
    pullRequests(first: 30, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_NODE} } } } }`;
  const r = await run("gh", ["api", "graphql", "-H", MERGE_INFO, "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`], undefined, 45_000);
  if (!r.ok) throw new Error(ghReason(r.err));
  let j: any;
  try { j = JSON.parse(r.out); } catch { throw new Error("GitHub's answer could not be read"); }
  if (j?.errors?.length && !j?.data?.repository) throw new Error(ghReason(String(j.errors[0]?.message || "GitHub said no")));
  const nodes: any[] = j?.data?.repository?.pullRequests?.nodes || [];
  const pulls: GhPull[] = []; const threads: Record<number, GhThread[]> = {};
  for (const n of nodes) { const { pull, thr } = fromNode(n); pulls.push(pull); threads[pull.number] = thr; }
  return { pulls, threads };
}

/** One PR, fresh — the merge guard reads this right before merging. */
export async function viewPull(repo: string, number: number): Promise<GhPull | null> {
  const [owner, name] = repo.split("/");
  const query = `query($owner: String!, $name: String!, $n: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $n) { ${PR_NODE} } } }`;
  const r = await run("gh", ["api", "graphql", "-H", MERGE_INFO, "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${number}`], undefined, 30_000);
  if (!r.ok) return null;
  try { const n = JSON.parse(r.out)?.data?.repository?.pullRequest; return n ? fromNode(n).pull : null; } catch { return null; }
}

/** A GraphQL node → the GhPull shape the domain reads (+ its threads). */
function fromNode(n: any): { pull: GhPull; thr: GhThread[] } {
  const commit = n.commits?.nodes?.[0]?.commit || null;
  const contexts: any[] = commit?.statusCheckRollup?.contexts?.nodes || [];
  const rollup: NonNullable<GhPull["statusCheckRollup"]> = contexts.map((c) => (c.__typename === "StatusContext" ? { state: c.state, context: c.context } : { conclusion: c.conclusion, status: c.status, name: c.name }));
  // No contexts but a rollup state (e.g. a check still queued) → carry the state.
  if (!rollup.length && commit?.statusCheckRollup?.state) rollup.push({ state: commit.statusCheckRollup.state });
  const pull: GhPull = {
    number: n.number, title: n.title || "", url: n.url || "", author: { login: n.author?.login || "" }, isDraft: !!n.isDraft,
    headRefName: n.headRefName || "", baseRefName: n.baseRefName || "", createdAt: n.createdAt || "", updatedAt: n.updatedAt || "",
    mergeable: n.mergeable || "UNKNOWN", mergeStateStatus: n.mergeStateStatus || "UNKNOWN",
    statusCheckRollup: rollup,
    reviews: (n.reviews?.nodes || []).map((r: any) => ({ author: { login: r.author?.login || "" }, state: r.state, submittedAt: r.submittedAt })),
    commits: commit?.committedDate ? [{ committedDate: commit.committedDate }] : [],
    requested: (n.reviewRequests?.nodes || []).map((q: any) => q?.requestedReviewer?.login).filter((x: unknown): x is string => typeof x === "string" && !!x),
  };
  const thr: GhThread[] = (n.reviewThreads?.nodes || []).map((t: any) => {
    const asComment = (c: any) => ({ author: c?.author?.login || "", body: String(c?.body || ""), path: c?.path ?? null, line: c?.line ?? null });
    const opening: any[] = t.opening?.nodes || []; const tail: any[] = t.tail?.nodes || [];
    // The opening comment, then the tail — the opening not twice when the thread is short.
    const all = opening.concat(tail.filter((c) => !opening.some((o) => o?.id && o.id === c?.id)));
    return { isResolved: !!t.isResolved, isOutdated: !!t.isOutdated, comments: all.map(asComment) };
  });
  return { pull, thr };
}

/** Merge a PR the way the repo allows. The caller has already run the guard. */
export async function mergePull(repo: string, number: number, method: "squash" | "merge"): Promise<{ ok: boolean; message: string }> {
  const r = await run("gh", ["pr", "merge", String(number), "-R", repo, method === "merge" ? "--merge" : "--squash", "--delete-branch"], undefined, 90_000);
  if (r.ok) return { ok: true, message: `#${number} merged` };
  return { ok: false, message: ghReason(r.err) };
}

/** Ask reviewers to look again (a pending review request on the PR). The
 *  second GitHub write; main.ts allows it only on Maksym's own PR. */
export async function requestReview(repo: string, number: number, logins: string[]): Promise<{ ok: boolean; message: string }> {
  const r = await run("gh", ["pr", "edit", String(number), "-R", repo, "--add-reviewer", logins.join(",")], undefined, 45_000);
  if (r.ok) return { ok: true, message: `asked ${logins.join(", ")}` };
  return { ok: false, message: ghReason(r.err) };
}

/** GitHub's/gh's error, shortened to one plain line for the paper. */
function ghReason(err: string): string {
  const e = (err || "").toLowerCase();
  if (e.includes("command not found") || e.includes("enoent")) return "the gh tool is not installed";
  if (e.includes("not logged") || e.includes("authentication") || e.includes("gh auth login")) return "gh is not logged in to GitHub";
  if (e.includes("could not resolve") || e.includes("network") || e.includes("timed out") || e.includes("etimedout") || e.includes("dial tcp")) return "GitHub could not be reached";
  if (e.includes("rate limit")) return "GitHub's rate limit — back in a bit";
  const first = (err || "").split("\n").find((l) => l.trim()) || "GitHub said no";
  return first.replace(/^(error|gh):\s*/i, "").slice(0, 140);
}
