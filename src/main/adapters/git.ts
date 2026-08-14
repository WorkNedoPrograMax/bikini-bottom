// The git adapter. Prepares a user-chosen folder so Lanes can work in it
// safely (AD-9: the Project is sacred). Every step is idempotent, so an
// interrupted prep simply completes on the next run. We only ever APPEND —
// on a fresh folder we make one empty initial commit (never committing the
// user's files); on an existing repo we touch nothing but .gitignore.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || stderr || "").trim() });
    });
  });
}

export interface PrepResult {
  ok: boolean;
  message: string;
}

/** Create (lazily) a Character's private worktree, or return the existing one.
 *  One worktree per Lane, stable path (AD-3) — made only on first job. */
export async function ensureWorktree(projectPath: string, id: string): Promise<string> {
  const wt = path.join(projectPath, ".bikini", "worktrees", id);
  try {
    await fs.access(path.join(wt, ".git")); // already a worktree
    return wt;
  } catch { /* create it */ }
  // Branch per Lane off the Project's current HEAD; -B is idempotent.
  const r = await git(projectPath, ["worktree", "add", "-B", `lane/${id}`, wt, "HEAD"]);
  if (!r.ok && !(await exists(path.join(wt, ".git")))) {
    throw new Error(`could not create ${id}'s workspace: ${r.out}`);
  }
  return wt;
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

const IDENT = ["-c", "user.email=town@bikini.bottom", "-c", "user.name=Bikini Bottom"];

/** The Project's current main-line commit (AD-5). */
export async function headSha(projectPath: string): Promise<string> {
  return (await git(projectPath, ["rev-parse", "HEAD"])).out;
}

/**
 * Serve a Lane's work: commit it and integrate onto the Project's main line
 * (AD-5). Returns the main-line tip after landing, or a collision when it
 * overlaps another Character's served work. `strategy` resolves a collision:
 * 'mine' keeps this Lane's version, 'theirs' keeps the main line's.
 */
export async function serveJob(
  projectPath: string, id: string, title: string, strategy?: "mine" | "theirs"
): Promise<{ status: "served" | "nochange" | "collision"; tip?: string }> {
  const wt = path.join(projectPath, ".bikini", "worktrees", id);
  const main = (await git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])).out || "main";

  await git(wt, ["add", "-A"]);
  const dirty = (await git(wt, ["status", "--porcelain"])).out !== "";
  const ahead = (await git(wt, ["rev-list", "--count", `${main}..HEAD`])).out !== "0";
  if (dirty) {
    const c = await git(wt, [...IDENT, "commit", "-m", `${title} [bikini]`]);
    if (!c.ok && !(await git(wt, ["rev-list", "--count", `${main}..HEAD`])).out) return { status: "nochange" };
  } else if (!ahead) {
    return { status: "nochange" }; // the Job changed nothing to land
  }

  // Try a clean fast-forward of main to this Lane.
  let ff = await git(projectPath, ["merge", "--ff-only", `lane/${id}`]);
  if (!ff.ok) {
    // Main moved (another Character served) — replay this Lane on top of it.
    const strat = strategy === "mine" ? ["-X", "theirs"] : strategy === "theirs" ? ["-X", "ours"] : [];
    const rb = await git(wt, [...IDENT, "rebase", main, ...strat]);
    if (!rb.ok) { await git(wt, ["rebase", "--abort"]); return { status: "collision" }; }
    ff = await git(projectPath, ["merge", "--ff-only", `lane/${id}`]);
    if (!ff.ok) return { status: "collision" };
  }
  return { status: "served", tip: await headSha(projectPath) };
}

/** Send a served Job back: revert its commits on the main line (AD-5). */
export async function sendBack(
  projectPath: string, baseSha: string, tipSha: string
): Promise<{ status: "sent" | "conflict" }> {
  const r = await git(projectPath, [...IDENT, "revert", "--no-edit", `${baseSha}..${tipSha}`]);
  if (!r.ok) { await git(projectPath, ["revert", "--abort"]); return { status: "conflict" }; }
  return { status: "sent" };
}

/** Idempotent: safe to call repeatedly and after an interrupted attempt. */
export async function prepareProject(projectPath: string): Promise<PrepResult> {
  // 1. Folder must exist and be writable.
  try {
    const st = await fs.stat(projectPath);
    if (!st.isDirectory()) return { ok: false, message: "That's not a folder — pick a folder to work in." };
    await fs.access(projectPath, fs.constants.W_OK);
  } catch {
    return { ok: false, message: "I can't open that folder. Try picking another one." };
  }

  // 2. Is it already a git repo? If not, start one (safe, empty).
  const inside = await git(projectPath, ["rev-parse", "--is-inside-work-tree"]);
  const freshRepo = !inside.ok;
  if (freshRepo) {
    const init = await git(projectPath, ["init"]);
    if (!init.ok) return { ok: false, message: "I couldn't set up my kitchen in that folder." };
  }

  // 3. Ensure at least one commit exists (worktrees need a HEAD). On a fresh
  //    repo make an EMPTY commit so we never commit the user's own files.
  const head = await git(projectPath, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) {
    await git(projectPath, ["-c", "user.email=town@bikini.bottom", "-c", "user.name=Bikini Bottom",
      "commit", "--allow-empty", "-m", "Bikini Bottom: town opened"]);
  }

  // 4. Keep the app's machinery out of the user's repo (.bikini git-ignored).
  const ignored = await git(projectPath, ["check-ignore", ".bikini"]);
  if (!ignored.ok) {
    const gi = path.join(projectPath, ".gitignore");
    let cur = "";
    try { cur = await fs.readFile(gi, "utf8"); } catch { /* none yet */ }
    if (!/^\.bikini\/?\s*$/m.test(cur)) {
      await fs.writeFile(gi, (cur && !cur.endsWith("\n") ? cur + "\n" : cur) + ".bikini/\n", "utf8");
    }
  }

  // 5. Make the app's private area (event log + per-Lane worktrees live here).
  await fs.mkdir(path.join(projectPath, ".bikini", "worktrees"), { recursive: true });

  return {
    ok: true,
    message: freshRepo
      ? "All set — I made my kitchen in that folder and touched none of your files."
      : "All set — I set up my kitchen alongside your existing work, untouched.",
  };
}
