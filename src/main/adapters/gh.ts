// How the town starts the `gh` CLI. Electron launched from the Dock has a bare
// PATH with no Homebrew in it, so every caller of gh uses this environment —
// the Mailbox (pulls.ts) and the reviewer's post_review (lane.ts). 2026-11-14:
// post_review started gh with no env, gh was not found, and the failure reached
// the reviewer as "exit 1: no message".

import { execFile } from "node:child_process";

/** The environment gh runs in: Homebrew's bin first, and gh never stops to ask or advertise an update. */
export function ghEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, PATH: `/opt/homebrew/bin:/usr/local/bin:${base.PATH || "/usr/bin:/bin"}`, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" };
}

/** `gh <args>` in a folder, no shell: the argv reaches gh verbatim. A gh that never ran
 *  (not found, timed out) printed nothing, so `out` then carries why. */
export function runGh(args: string[], cwd: string, env: NodeJS.ProcessEnv = ghEnv()): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("gh", args, { cwd, env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err: any, stdout, stderr) => {
      const out = `${stdout || ""}${stderr || ""}`.trim();
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: out || (err ? String(err.message || err).trim() : "") });
    });
  });
}
