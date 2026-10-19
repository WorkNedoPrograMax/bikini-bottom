// Checks the stay-in-your-lane guard (one worktree per character) against
// dist/, with plain node. Run after `npm run build`:  node scripts/check-stay-in-lane.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isStrayWorktree, STRAY_WORKTREE_REASON, STAY_IN_LANE_NOTE } = require("../dist/main/domain/stayInLane.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const bash = (command) => isStrayWorktree("Bash", { command });

console.log("isStrayWorktree — refused (makes another worktree):");
ok(bash("git worktree add ../km-copy feature/HIGHCAP-233-km-copy"), "git worktree add <path> <branch> (Pat, 2026-10-18)");
ok(bash("git worktree add --no-track -b feature/X .claude/worktrees/X origin/onboarding 2>&1 | tail -2"), "git worktree add -b … | tail (Pat, HIGHCAP-264)");
ok(bash("export PATH=/opt/homebrew/bin:$PATH && W=../km-copy && git worktree add $W feature/x"), "export … && W=… && git worktree add $W (the real Pat line)");
ok(bash("git -C /repo worktree add --detach /tmp/x refs/remotes/origin/dev"), "git -C <dir> worktree add --detach");
ok(bash("cd sub && /usr/bin/git worktree add ../y"), "cd && /usr/bin/git worktree add (absolute binary, chained)");
ok(bash("claude --worktree x -p 'hi'"), "claude --worktree");
ok(bash("claude -w feat -p 'hi'"), "claude -w");
ok(isStrayWorktree("EnterWorktree", { path: "/x/.claude/worktrees/y" }), "EnterWorktree tool (Squid, 7×)");
ok(isStrayWorktree("Agent", { prompt: "x", isolation: "worktree" }), "Agent with isolation: worktree");

console.log("isStrayWorktree — allowed (ordinary work in the lane):");
ok(!bash("git worktree list"), "git worktree list");
ok(!bash("git worktree prune"), "git worktree prune");
ok(!bash("git worktree remove .claude/worktrees/old"), "git worktree remove (cleaning up is fine)");
ok(!bash("git switch feature/HIGHCAP-233-km-copy"), "git switch <branch>");
ok(!bash("git checkout -b feature/x origin/onboarding"), "git checkout -b");
ok(!bash("git status && git log --oneline -3"), "git status / log");
ok(!bash("grep -rn 'worktree add' docs/"), "grep for the words (not git)");
ok(!bash("echo git worktree"), "echo … (not git binary)");
ok(!bash("claude -p 'hello'"), "claude -p without --worktree");
ok(!isStrayWorktree("Agent", { prompt: "x" }), "Agent without isolation");
ok(!isStrayWorktree("Read", { file_path: "/x" }), "Read");
ok(!isStrayWorktree("Bash", {}), "Bash with no command");

console.log("messages:");
ok(STRAY_WORKTREE_REASON.includes("git switch"), "refusal tells the character what to do instead");
ok(STAY_IN_LANE_NOTE.startsWith(" ") && STAY_IN_LANE_NOTE.includes("git worktree add"), "prompt note joins the others (leading space) and names the forbidden command");

console.log(fails ? `\n${fails} check(s) failed` : "\nall stay-in-lane checks passed");
process.exit(fails ? 1 : 0);
