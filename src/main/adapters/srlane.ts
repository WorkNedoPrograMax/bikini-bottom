// Scout & Runner lane adapter. A Bikini character = one S&R "lane" (git
// worktree at ../sr-<name> + its own Docker stack). This drives the project's
// existing scripts/parallel/*.sh and `gh` for PRs — Bikini does NOT reinvent
// the worktree/Docker machinery.
//
// DRY-RUN: create/teardown/finish only LOG the exact command they would run
// (no Docker, no GitHub). Read-only listing always runs for real, so the
// 3-lane cap reflects reality even in dry-run.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface LaneInfo {
  name: string;
  worktree: string;
  branch: string;
}

export interface SrLaneConfig {
  /** Path to the scout-and-runner repo. */
  repoRoot: string;
  /** Branch new lanes are cut from (S&R convention). */
  baseBranch: string;
  /** GitHub repo for PRs, e.g. apex-telecom/scout-and-runner. */
  ghRepo: string;
  /** Max concurrent lanes (S&R caps at 3). */
  cap: number;
  /** When true, mutating ops only log their command; nothing real happens. */
  dryRun: boolean;
  /** Sink for command/dry-run lines (also surfaced to the user). */
  log: (line: string) => void;
}

function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 15 * 60_000 }, (err, so, se) =>
      resolve({ ok: !err, out: (so || se || "").toString().trim() })
    );
  });
}

export class SrLanes {
  constructor(private c: SrLaneConfig) {}

  /** Slugify a character name into a valid lane name. */
  static laneName(character: string): string {
    return character.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  }

  private parent(): string { return path.dirname(this.c.repoRoot); }

  /** Live lanes = ../sr-* worktrees. Always real (read-only). */
  async list(): Promise<LaneInfo[]> {
    let entries: string[] = [];
    try { entries = await fs.readdir(this.parent()); } catch { return []; }
    const out: LaneInfo[] = [];
    for (const e of entries) {
      if (!e.startsWith("sr-")) continue;
      const wt = path.join(this.parent(), e);
      try { if (!(await fs.stat(wt)).isDirectory()) continue; } catch { continue; }
      const name = e.slice(3);
      out.push({ name, worktree: wt, branch: `feat/${name}` });
    }
    return out;
  }

  /** Is there room for another lane? */
  async hasRoom(): Promise<boolean> {
    return (await this.list()).length < this.c.cap;
  }

  /** Open a character's lane: worktree + its own Docker stack. */
  async createLane(character: string): Promise<{ ok: boolean; worktree: string; message: string }> {
    const name = SrLanes.laneName(character);
    const worktree = path.join(this.parent(), `sr-${name}`);
    if (!(await this.hasRoom()) && !(await this.list()).some((l) => l.name === name)) {
      return { ok: false, worktree, message: `The town's full — ${this.c.cap} lanes are already running. Free one first.` };
    }
    const cmd = `scripts/parallel/lane-up.sh ${name} ${this.c.baseBranch}`;
    if (this.c.dryRun) {
      this.c.log(`[dry-run] would run: ${cmd}  (cwd: ${this.c.repoRoot})`);
      return { ok: true, worktree, message: `[dry-run] lane '${name}' would spin up (worktree ${worktree} + its own Docker stack).` };
    }
    this.c.log(`$ ${cmd}`);
    const r = await run(path.join(this.c.repoRoot, "scripts/parallel/lane-up.sh"), [name, this.c.baseBranch], this.c.repoRoot);
    return { ok: r.ok, worktree, message: r.ok ? `Lane '${name}' is up.` : `lane-up failed: ${r.out.slice(-300)}` };
  }

  /** Finish: commit on feat/<name>, push, open a PR — never merge (human gate). */
  async finishLane(character: string, title: string): Promise<{ ok: boolean; message: string }> {
    const name = SrLanes.laneName(character);
    const wt = path.join(this.parent(), `sr-${name}`);
    const steps = [
      `git -C ${wt} add -A && git -C ${wt} commit -m ${JSON.stringify(title)}`,
      `git -C ${wt} push -u origin feat/${name}`,
      `gh pr create --repo ${this.c.ghRepo} --head feat/${name} --base ${this.c.baseBranch} --title ${JSON.stringify(title)} --body "Opened by Bikini Bottom (${character})."`,
    ];
    if (this.c.dryRun) {
      this.c.log(`[dry-run] would run, in order:`);
      steps.forEach((s) => this.c.log(`  · ${s}`));
      return { ok: true, message: `[dry-run] ${character}'s work would be pushed to feat/${name} and a PR opened for you to review.` };
    }
    // live path
    await run("git", ["-C", wt, "add", "-A"], wt);
    await run("git", ["-C", wt, "commit", "-m", title], wt);
    const push = await run("git", ["-C", wt, "push", "-u", "origin", `feat/${name}`], wt);
    if (!push.ok) return { ok: false, message: `push failed: ${push.out.slice(-200)}` };
    const pr = await run("gh", ["pr", "create", "--repo", this.c.ghRepo, "--head", `feat/${name}`, "--base", this.c.baseBranch, "--title", title, "--body", `Opened by Bikini Bottom (${character}).`], wt);
    return { ok: pr.ok, message: pr.ok ? `PR opened: ${pr.out}` : `PR failed: ${pr.out.slice(-200)}` };
  }

  /** Finish an ADOPTED lane: commit + push its REAL feature branch + open a PR.
   *  Never renames the branch. Gated by dryRun (logs, fires nothing). */
  async finishBranch(worktree: string, branch: string, title: string): Promise<{ ok: boolean; message: string }> {
    const steps = [
      `git -C ${worktree} add -A && git -C ${worktree} commit -m ${JSON.stringify(title)}`,
      `git -C ${worktree} push -u origin ${branch}`,
      `gh pr create --repo ${this.c.ghRepo} --head ${branch} --base ${this.c.baseBranch} --title ${JSON.stringify(title)} --body "Opened by Bikini Bottom."`,
    ];
    if (this.c.dryRun) {
      this.c.log(`[gated] would run, in order:`);
      steps.forEach((s) => this.c.log(`  · ${s}`));
      return { ok: true, message: `[gated] would push ${branch} and open a PR (nothing fired — flip go-live to do it for real).` };
    }
    await run("git", ["-C", worktree, "add", "-A"], worktree);
    await run("git", ["-C", worktree, "commit", "-m", title], worktree);
    const push = await run("git", ["-C", worktree, "push", "-u", "origin", branch], worktree);
    if (!push.ok) return { ok: false, message: `push failed: ${push.out.slice(-200)}` };
    const pr = await run("gh", ["pr", "create", "--repo", this.c.ghRepo, "--head", branch, "--base", this.c.baseBranch, "--title", title, "--body", "Opened by Bikini Bottom."], worktree);
    return { ok: pr.ok, message: pr.ok ? `PR opened: ${pr.out}` : `PR failed: ${pr.out.slice(-200)}` };
  }

  /** Send a character home: tear the lane down (worktree + Docker). */
  async teardownLane(character: string): Promise<{ ok: boolean; message: string }> {
    const name = SrLanes.laneName(character);
    const cmd = `scripts/parallel/lane-down.sh ${name}`;
    if (this.c.dryRun) {
      this.c.log(`[dry-run] would run: ${cmd}`);
      return { ok: true, message: `[dry-run] lane '${name}' would be torn down (Docker down + worktree removed).` };
    }
    this.c.log(`$ ${cmd}`);
    const r = await run(path.join(this.c.repoRoot, "scripts/parallel/lane-down.sh"), [name], this.c.repoRoot);
    return { ok: r.ok, message: r.ok ? `Lane '${name}' taken down.` : `lane-down failed: ${r.out.slice(-200)}` };
  }
}
