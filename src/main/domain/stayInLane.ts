// Stay in your lane (2026-10-19). Bikini gives every character exactly ONE
// worktree (its lane) and knows nothing else. Measured in highcap that day:
// git listed 10 worktrees for a town of 3 characters — Pat had made a sibling
// lane for a PR (2026-10-18), Pat and Squid had spun nested worktrees inside
// their lanes (Claude Code's own "work in a separate worktree" tool, or a
// hand-typed `git worktree add`), Bob two more. Work left in those copies is
// invisible to the next job (which always starts in the lane), to the town's
// merge/status (which read the lane branch), and to the Phone Booth (keyed on
// the lane path). So: a character never creates a worktree; it switches
// branches INSIDE its lane. PURE so scripts/check-stay-in-lane.mjs can test it.

export const STRAY_WORKTREE_REASON =
  "Stay in your lane: this is your only workspace. Never create another worktree (git worktree add, claude --worktree, the EnterWorktree tool, a worktree-isolated subagent). To work on a different branch, switch to it right here (git checkout / git switch).";

/** The character prompt line that states the rule (the hook enforces it). */
export const STAY_IN_LANE_NOTE =
  " STAY IN YOUR LANE: the folder you start in is your one and only workspace, and the town only ever looks there. Never create another worktree or copy of the repo — no `git worktree add`, no `claude --worktree`, no EnterWorktree tool, no worktree-isolated subagent; the town refuses them. To work on another branch, switch to it inside this folder (`git switch <branch>`) and switch back when done. If you find a stray worktree left by an earlier job, say so to Maksym rather than using it.";

/** Pipe/chain-aware split of a shell line, so `cd x && git worktree add` is seen. */
function segments(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||;|\|)\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Strips env assignments and wrappers (sudo, env, fvm…) in front of the binary. */
function words(segment: string): string[] {
  const w = segment.split(/\s+/);
  while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || ["sudo", "env", "nice", "nohup", "time"].includes(w[0]))) w.shift();
  return w;
}

/** True when one tool call would make a new worktree (or copy) outside the lane. */
export function isStrayWorktree(toolName: string, toolInput: Record<string, unknown> | null | undefined): boolean {
  const ti = toolInput ?? {};
  if (toolName === "EnterWorktree") return true;
  if ((toolName === "Agent" || toolName === "Task") && ti.isolation === "worktree") return true;
  if (toolName !== "Bash") return false;
  const command = String(ti.command ?? "");
  for (const seg of segments(command)) {
    const w = words(seg);
    if (!w.length) continue;
    const bin = w[0].split("/").pop() ?? "";
    if (bin === "git") {
      // `git [global opts] worktree add …` — global opts (-C x, --git-dir=…) may sit between.
      const i = w.indexOf("worktree");
      if (i > 0 && w[i + 1] === "add") return true;
    }
    if (bin === "claude" && w.some((x) => x === "--worktree" || x === "-w" || x.startsWith("--worktree="))) return true;
  }
  return false;
}
