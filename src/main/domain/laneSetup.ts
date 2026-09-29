// Lane setup ("the pantry"): what a FRESH lane needs before a character can
// build in it. A lane is a plain git worktree, so it lacks everything git
// ignores — secrets (env files), generated code, downloaded packages. Without
// this, every character spends its first turns rediscovering `pub get`,
// build_runner and the localisation step (the Flutter version of the server
// churn we killed in Scout & Runner).
//
// The recipe lives in the town's profile (<project>/.bikini/town.json):
//   "setup": {
//     "copy": ["env/.env*", ".claude/settings.local.json"],   // git-ignored files
//     "run":  ["fvm flutter pub get", "fvm dart run build_runner build …"]
//   }
// A Flutter town gets a seed recipe when it is added; anything else starts
// with none. Maksym edits the file to add or drop steps.
//
// PURE (no fs, no child processes) so scripts/check-lane-setup.mjs can test it.

export interface LaneSetup {
  /** Paths RELATIVE to the project, copied from the main checkout into the lane
   *  when they exist there. A trailing `*` in the LAST segment matches a prefix
   *  ("env/.env*" → env/.env, env/.env.dev, …). Missing sources are skipped. */
  copy?: string[];
  /** Shell commands run in the lane, in order, once. A failed step is reported
   *  to the character and retried on its next job; it never blocks the job. */
  run?: string[];
}

/** The seed recipe for a folder, from what is on disk. `has(rel)` says whether a
 *  project-relative path exists. Null = nothing to prepare (plain repos). */
export function seedSetup(has: (rel: string) => boolean): LaneSetup | null {
  if (!has("pubspec.yaml")) return null;
  const fvm = has(".fvmrc") ? "fvm " : "";
  const setup: LaneSetup = {
    // env/.env*: the secrets. .mcp.json: per-machine MCP wiring (highcap's
    // CLAUDE.md tells agents to use Mazarax; its wiring is git-ignored).
    copy: ["env/.env*", ".mcp.json"],
    // `fvm install` (no args) installs the version .fvmrc pins if it is missing
    // and exits at once when it is there — without it, `fvm flutter` stops at a
    // "install it now? (y/n)" prompt nobody can answer in a lane.
    run: fvm ? ["fvm install", "fvm flutter pub get"] : ["flutter pub get"],
  };
  // build_runner is the codegen workhorse (envied, freezed, mocks); intl_utils
  // writes the localisation classes. Both are git-ignored output.
  setup.run!.push(`${fvm}dart run build_runner build --delete-conflicting-outputs`);
  setup.run!.push(`${fvm}dart run intl_utils:generate`);
  return setup;
}

/** Trim a recipe from a JSON-ish object down to what we understand. Null when
 *  it has nothing usable (then the profile carries no setup). */
export function normalizeSetup(raw: unknown): LaneSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : [];
  const copy = strs(r.copy);
  const run = strs(r.run);
  if (!copy.length && !run.length) return null;
  const out: LaneSetup = {};
  if (copy.length) out.copy = copy;
  if (run.length) out.run = run;
  return out;
}

/** Expand one copy pattern against a directory listing. `list(dir)` returns the
 *  entry names of a project-relative dir (or [] when it is missing). Only a
 *  trailing `*` on the last segment is a wildcard; anything else is literal. */
export function expandCopy(pattern: string, list: (relDir: string) => string[]): string[] {
  const p = pattern.replace(/^\.?\//, "").replace(/\/+$/, "");
  if (!p || p.includes("..")) return []; // never reach outside the project
  const slash = p.lastIndexOf("/");
  const dir = slash === -1 ? "" : p.slice(0, slash);
  const leaf = slash === -1 ? p : p.slice(slash + 1);
  if (!leaf.endsWith("*")) return [p];
  const prefix = leaf.slice(0, -1);
  return list(dir).filter((n) => n.startsWith(prefix)).sort().map((n) => (dir ? `${dir}/${n}` : n));
}

/** What one run of the recipe did. Persisted in the lane as .bikini-setup.json
 *  so the next job knows what to retry and the character knows what is ready. */
export interface SetupReport {
  /** Files that landed in the lane (project-relative). */
  copied: string[];
  /** Commands that ran and passed. */
  passed: string[];
  /** Commands that failed, with the tail of their output. */
  failed: { cmd: string; tail: string }[];
  /** Epoch ms when the recipe last ran. */
  at: number;
}

export const EMPTY_REPORT: SetupReport = { copied: [], passed: [], failed: [], at: 0 };

/** Which commands still need running: everything not yet passed. A recipe
 *  edit (new command) is picked up naturally; a dropped command is forgotten. */
export function pendingRuns(setup: LaneSetup, previous: SetupReport | null): string[] {
  const done = new Set(previous?.passed ?? []);
  return (setup.run ?? []).filter((c) => !done.has(c));
}

/** Merge this run's outcome onto the previous report: passes accumulate,
 *  the failure list is only what failed THIS time. */
export function mergeReport(previous: SetupReport | null, now: Omit<SetupReport, "at">, at: number, setup: LaneSetup): SetupReport {
  const wanted = new Set(setup.run ?? []);
  const passed = [...new Set([...(previous?.passed ?? []), ...now.passed])].filter((c) => wanted.has(c));
  return { copied: now.copied, passed, failed: now.failed, at };
}

/** Plain-language name for a command, for the street and the prompt. */
export function stepWord(cmd: string): string {
  const c = cmd.replace(/^fvm\s+/, "");
  if (/^install\b/.test(c)) return "Flutter SDK";
  if (/pub get/.test(c)) return "packages";
  if (/build_runner/.test(c)) return "generated code";
  if (/intl_utils/.test(c)) return "translations";
  if (/env_build/.test(c)) return "env code";
  if (/pod install/.test(c)) return "iOS pods";
  return c.length > 40 ? c.slice(0, 37) + "…" : c;
}

/** The sentence appended to the character's system prompt so it never redoes
 *  (or wrongly assumes) the prep. Empty when nothing was set up. */
export function setupNote(report: SetupReport | null): string {
  if (!report || (!report.copied.length && !report.passed.length && !report.failed.length)) return "";
  const parts: string[] = [];
  if (report.passed.length) parts.push(`already done for you: ${report.passed.map(stepWord).join(", ")} (do NOT run these again unless you change what they depend on)`);
  if (report.copied.length) parts.push(`these git-ignored files were copied in from the main checkout: ${report.copied.join(", ")}`);
  if (report.failed.length) parts.push(`these steps FAILED and are still needed: ${report.failed.map((f) => `\`${f.cmd}\` (${firstLine(f.tail)})`).join("; ")} — fix or run them yourself before building, and tell Maksym if a secret or file is missing`);
  return ` Your lane was prepared before you started — ${parts.join(". ")}.`;
}

/** The street's one-line activity while the recipe runs. */
export function setupActivity(cmd: string): string {
  if (cmd === "waiting") return "waiting for the lane setup…";
  return `setting up the lane (${stepWord(cmd)})…`;
}

function firstLine(tail: string): string {
  const lines = tail.split("\n").map((s) => s.trim()).filter(Boolean);
  const l = lines.length ? lines[lines.length - 1] : "no output";
  return l.length > 120 ? l.slice(0, 117) + "…" : l;
}
