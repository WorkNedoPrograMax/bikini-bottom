// Review only (2026-11-06). Karen, the reviewer, has ONE job: other people's
// pull requests. She never changes code — not by prompt, by construction: the
// PreToolUse hook refuses every edit and every write to git or GitHub except
// the review itself. Maksym: "she never writes code, she simply reviews PRs,
// that's the only job". PURE so scripts/check-review-only.mjs can test it.
//
// Shape: an ALLOWLIST. A Bash line is allowed only when EVERY segment of it
// (split on && || ; |) is a plain reader, a git read, a branch move, a PR
// read, the review itself, or one of the town's test/analyze runners. Anything
// else — including a command we simply do not know — is refused with the reason.

import { segments, words } from "./stayInLane";

export const REVIEW_ONLY_REASON =
  "Karen only reviews — she never changes code. Say what is wrong in the review on GitHub; the author fixes it. (Reading, checking out the PR branch, running the checks, and posting the review are all fine.)";

/** The line in her system prompt that states the rule (the hook enforces it). */
export const REVIEW_ONLY_NOTE =
  " YOU ONLY REVIEW: you never change code, never commit, never push, never open or merge a pull request, never edit a file — the town refuses all of it, so do not try. Your deliverable is the review posted on GitHub (gh pr review / gh pr comment) and, when needed, asking the reviewer to look again (gh pr edit --add-reviewer). You may fetch, check out the PR's branch in this folder, run what CI runs, and read anything. When you are done, switch this folder back to its main line (`git switch dev`) — it is the shared project folder, not a lane of your own.";

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "NotebookRead", "WebFetch", "WebSearch", "ToolSearch", "Skill"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "EnterWorktree"]);

const PLAIN_READERS = new Set([
  "ls", "cat", "head", "tail", "less", "more", "wc", "grep", "rg", "egrep", "fgrep", "ugrep", "find", "fd", "diff", "stat", "file",
  "echo", "printf", "pwd", "which", "type", "env", "printenv", "date", "sleep", "true", "false", "test", "[", "sort", "uniq", "cut",
  "tr", "awk", "jq", "yq", "xargs", "basename", "dirname", "realpath", "readlink", "column", "tree", "du", "df",
  "cd", "export", "set", "unset", "source", ".",
  "pytest", "ruff", "pyright", "mypy", // the backend town's checks (read the tree, write nothing of ours)
]);
const GIT_READS = new Set(["status", "log", "diff", "show", "rev-parse", "rev-list", "ls-files", "ls-remote", "blame", "describe", "name-rev", "merge-base", "cat-file", "shortlog", "grep", "reflog"]);
const GH_PR_READS = new Set(["view", "diff", "checks", "list", "status", "checkout"]);
const GH_PR_REVIEW = new Set(["review", "comment"]);

/** Every `>`/`>>` that is not `2>&1`-style or into /dev/null writes a file. */
function redirectsToFile(seg: string): boolean {
  const re = /\d?>>?\s*(\S*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    const target = m[1];
    if (target.startsWith("&")) continue;      // 2>&1, >&2
    if (target === "/dev/null") continue;
    return true;
  }
  return false;
}

function gitAllowed(w: string[]): boolean {
  // Skip global options between `git` and the subcommand (-C x, -c k=v, --git-dir=…).
  let i = 1;
  while (i < w.length && w[i].startsWith("-")) { if (w[i] === "-C" || w[i] === "-c") i++; i++; }
  const sub = w[i]; if (!sub) return false;
  const rest = w.slice(i + 1);
  const flags = rest.filter((x) => x.startsWith("-"));
  const args = rest.filter((x) => !x.startsWith("-"));
  if (GIT_READS.has(sub)) return true;
  switch (sub) {
    case "branch": return args.length === 0 && flags.every((f) => ["-a", "-r", "-l", "-v", "-vv", "--list", "--show-current", "--contains", "--merged", "--no-merged"].includes(f));
    case "tag": return args.length === 0 && flags.every((f) => f === "-l" || f === "--list" || f.startsWith("-n"));
    case "remote": return args.length === 0 || args[0] === "show" || args[0] === "get-url";
    case "config": return flags.some((f) => f === "--get" || f === "--list" || f === "-l" || f === "--get-all") || (args.length === 1 && flags.length === 0);
    case "worktree": return args[0] === "list";
    case "stash": return args[0] === "list" || args[0] === "show";
    case "fetch": return true;
    case "pull": return args.every((a) => a === "origin" || a === "dev" || a === "develop" || a === "main") && flags.every((f) => f === "--ff-only" || f === "--ff" || f === "--rebase=false" || f === "-q" || f === "--quiet");
    // Move between branches: one branch name, never create one (-b/-c), never
    // restore files (`checkout -- <path>`, `checkout <ref> <path>`).
    case "switch": case "checkout": return args.length <= 1 && !rest.includes("--") && !flags.some((f) => ["-b", "-B", "-c", "-C", "--orphan", "--detach", "-p", "--patch"].includes(f));
    case "clean": return flags.includes("-n") || flags.includes("--dry-run");
    default: return false; // add, commit, push, reset, restore, rebase, merge, cherry-pick, am, apply, revert, rm, mv, …
  }
}

function ghAllowed(w: string[]): boolean {
  const [, a, b, ...rest] = w;
  if (a === "pr") {
    if (!b) return false;
    if (GH_PR_READS.has(b) || GH_PR_REVIEW.has(b)) return true;
    if (b === "edit") return rest.some((x) => x === "--add-reviewer" || x.startsWith("--add-reviewer=")) && !rest.some((x) => /^--(title|body|body-file|base|add-label|remove-label|add-assignee|remove-assignee|milestone|add-project|remove-project|remove-reviewer)\b/.test(x));
    return false; // create, merge, close, ready, reopen, lock, …
  }
  if (a === "api") return !w.some((x) => x === "-X" || x === "--method" || x.startsWith("--method=") || x === "-F" || x === "-f" || x === "--field" || x === "--raw-field" || x === "--input"); // GET only
  if (a === "auth") return b === "status";
  if (a === "repo" || a === "issue") return b === "view" || b === "list";
  if (a === "run") return b === "view" || b === "list" || b === "watch";
  if (a === "search") return true;
  return false;
}

/** fvm / flutter / dart: analyze, test, codegen (generated code, never source). */
function flutterAllowed(w: string[]): boolean {
  const sub = w.slice(1).filter((x) => x !== "flutter" && x !== "dart");
  const verb = sub[0];
  if (!verb || verb === "--version" || verb === "doctor" || verb === "devices" || verb === "analyze" || verb === "test") return true;
  if (verb === "pub") return sub[1] === "get" || sub[1] === "deps" || sub[1] === "outdated";
  if (verb === "run") return sub[1] === "build_runner" || sub[1] === "intl_utils:generate" || sub[1] === "intl_utils";
  if (verb === "format") return sub.includes("--set-exit-if-changed") || sub.includes("--output=none") || (sub.includes("-o") && sub.includes("none"));
  return false;
}

function segmentAllowed(seg: string): boolean {
  const w = words(seg);
  if (!w.length) return true;
  if (redirectsToFile(seg)) return false;
  const bin = (w[0].split("/").pop() ?? "").toLowerCase();
  if (bin === "git") return gitAllowed(w);
  if (bin === "gh") return ghAllowed(w);
  if (bin === "sed") return !w.some((x) => x === "-i" || x.startsWith("-i.") || x === "--in-place" || x.startsWith("--in-place="));
  if (bin === "fvm" || bin === "flutter" || bin === "dart") return flutterAllowed(w);
  if (bin === "python3" || bin === "python" || bin === "node") {
    // Only the library's own read-only scripts; an inline snippet cannot be checked, so it is refused.
    return w.length === 1 || w[1] === "--version" || w.slice(1).some((x) => /(^|\/)(hc-precedents|hc-stats)\.py$|(^|\/)scripts\/check-[\w-]+\.mjs$/.test(x)) && !w.some((x) => x === "-c" || x === "-e" || x === "--eval");
  }
  if (bin === "npm" || bin === "pnpm" || bin === "yarn") return w[1] === "test" || w[1] === "ci" || w[1] === "ls" || (w[1] === "run" && /^(test|lint|check|analyze|typecheck|build)(:[\w-]+)?$/.test(w[2] ?? ""));
  if (bin === "make") return ["test", "lint", "check", "analyze", "typecheck"].includes(w[1] ?? "");
  return PLAIN_READERS.has(bin);
}

/** True when the tool call may run in a review-only session. */
export function isReviewOnlyAllowed(toolName: string, toolInput: Record<string, unknown> | null | undefined): boolean {
  const ti = toolInput ?? {};
  if (toolName.startsWith("mcp__bikini__")) return true; // ask_maksym, post_status
  if (WRITE_TOOLS.has(toolName)) return false;
  if (toolName === "Agent" || toolName === "Task") return ti.isolation !== "worktree"; // a helper's own calls pass through this same hook
  if (toolName === "Bash") return segments(String(ti.command ?? "")).every(segmentAllowed);
  if (READ_TOOLS.has(toolName)) return true;
  // Connector tools: only read-shaped names (get/list/search/read/view…); every write-shaped one is refused.
  if (toolName.startsWith("mcp__")) return /__(get|list|search|read|fetch|view|find|query|lookup|describe|whoami|discover|executeRead|atlassianUserInfo|getAccessibleAtlassianResources)[A-Za-z_]*$/i.test(toolName);
  return false;
}
