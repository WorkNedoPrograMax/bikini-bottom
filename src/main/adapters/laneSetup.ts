// Runs a town's lane-setup recipe (domain/laneSetup.ts) in a FRESH worktree:
// copies the git-ignored files the recipe names from the main checkout, then
// runs its commands one by one through the user's login shell (so `fvm`,
// `flutter`, `pod` resolve exactly as in Terminal — Electron's own PATH is
// bare when launched from the Dock). The report is saved OUTSIDE the lane, at
// <project>/.bikini/setup/<lane>.json, so the next job only retries what
// failed — and no character can ever commit it into a team PR.

import { execFile } from "node:child_process";
import { promises as fs, readdirSync } from "node:fs";
import path from "node:path";
import { expandCopy, mergeReport, pendingRuns, type LaneSetup, type SetupReport } from "../domain/laneSetup";

/** Where a lane's report lives: beside the town's other state, never in the
 *  worktree itself (the lane's basename is the character id). */
export function reportPath(projectPath: string, worktree: string): string {
  return path.join(projectPath, ".bikini", "setup", `${path.basename(worktree)}.json`);
}
/** One step may legitimately take minutes (a cold `pub get`, build_runner). */
const STEP_TIMEOUT_MS = 15 * 60 * 1000;
const TAIL_CHARS = 1500;

/** One town preps one lane at a time: three characters starting together would
 *  otherwise race on the same SDK download or package cache. Keyed by project. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  queues.set(key, next);
  return next;
}

/** The saved report of an earlier run, or null. Never throws. */
export async function loadReport(projectPath: string, worktree: string): Promise<SetupReport | null> {
  try {
    const raw = JSON.parse(await fs.readFile(reportPath(projectPath, worktree), "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return {
      copied: Array.isArray(raw.copied) ? raw.copied.filter((s: unknown) => typeof s === "string") : [],
      passed: Array.isArray(raw.passed) ? raw.passed.filter((s: unknown) => typeof s === "string") : [],
      failed: Array.isArray(raw.failed) ? raw.failed.filter((f: unknown) => f && typeof (f as { cmd?: unknown }).cmd === "string") : [],
      at: Number(raw.at) || 0,
    };
  } catch { return null; }
}

/** Is there anything left to do for this lane? (Copies always re-run — they are
 *  cheap and a secret that arrived later must reach the lane.) */
export function setupDue(setup: LaneSetup | null, previous: SetupReport | null): boolean {
  if (!setup) return false;
  return (setup.copy?.length ?? 0) > 0 || pendingRuns(setup, previous).length > 0;
}

/**
 * Run the recipe in `worktree`. `onStep(cmd)` fires before each command (for the
 * street's activity line). Copies never throw; a failing command is recorded
 * and the next one still runs. Returns the merged report (also written to the
 * lane). Idempotent: passed commands are skipped on later calls.
 */
export function runSetup(
  projectPath: string, worktree: string, setup: LaneSetup,
  onStep: (cmd: string) => void = () => {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SetupReport> {
  onStep("waiting"); // shown while another lane of this town is being prepared
  return serialized(projectPath, () => runSetupNow(projectPath, worktree, setup, onStep, env));
}

async function runSetupNow(
  projectPath: string, worktree: string, setup: LaneSetup,
  onStep: (cmd: string) => void, env: NodeJS.ProcessEnv,
): Promise<SetupReport> {
  const previous = await loadReport(projectPath, worktree);
  const copied: string[] = [];
  for (const pattern of setup.copy ?? []) {
    for (const rel of expandCopy(pattern, (dir) => listDir(path.join(projectPath, dir)))) {
      if (await copyIfPresent(path.join(projectPath, rel), path.join(worktree, rel))) copied.push(rel);
    }
  }

  const passed: string[] = [];
  const failed: { cmd: string; tail: string }[] = [];
  for (const cmd of pendingRuns(setup, previous)) {
    onStep(cmd);
    const r = await sh(cmd, worktree, env);
    if (r.ok) passed.push(cmd); else failed.push({ cmd, tail: r.out.slice(-TAIL_CHARS) });
  }

  const report = mergeReport(previous, { copied, passed, failed }, Date.now(), setup);
  try {
    const file = reportPath(projectPath, worktree);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(report, null, 2) + "\n", "utf8");
  } catch { /* the lane is still usable */ }
  return report;
}

function listDir(abs: string): string[] {
  // Synchronous on purpose: expandCopy is pure and takes a plain lister.
  try { return readdirSync(abs); } catch { return []; }
}

/** Copy a regular file if the source exists. Returns whether it landed. */
async function copyIfPresent(src: string, dst: string): Promise<boolean> {
  try {
    const st = await fs.stat(src);
    if (!st.isFile()) return false;
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    return true;
  } catch { return false; }
}

/** Run one command through a login zsh in `cwd`, stdin closed (nothing can
 *  prompt), with a hard timeout. The user's real PATH is what the shell loads. */
function sh(cmd: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const child = execFile("/bin/zsh", ["-lc", cmd], { cwd, env: { ...env, CI: "1" }, timeout: STEP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ""}\n${stderr || ""}`.trim();
      resolve({ ok: !err, out: err && !out ? String(err.message) : out });
    });
    try { child.stdin?.end(); } catch { /* fine */ }
  });
}
