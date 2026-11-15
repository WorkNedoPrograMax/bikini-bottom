// Checks how the town starts the `gh` CLI (adapters/gh.ts).
// 2026-11-14: the app was launched with no Homebrew on its PATH; post_review
// started gh with no env of its own, gh was not found, and every review came
// back as "GitHub did not take it (exit 1): no message".
// Run after `npm run build`:  node scripts/check-gh.mjs
import { createRequire } from "node:module";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { ghEnv, runGh } = require("../dist/main/adapters/gh.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

// The process PATH the Dock gives the app: nothing with gh in it.
const empty = mkdtempSync(join(tmpdir(), "bikini-nogh-"));
const realPath = process.env.PATH;
process.env.PATH = empty;

console.log("gh — the process PATH has no gh:");
const env = ghEnv();
ok(env.PATH === `/opt/homebrew/bin:/usr/local/bin:${empty}`, "Homebrew's bin is put in front of the process PATH");
ok(env.GH_PROMPT_DISABLED === "1", "gh never stops to ask a question");
ok(ghEnv({}).PATH === "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "no PATH at all still gets a usable one");

const installed = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].some((p) => existsSync(p));
if (installed) {
  const r = await runGh(["--version"], empty);
  ok(r.code === 0 && /gh version/.test(r.out), `runGh still finds and runs gh (exit ${r.code}: ${r.out.split("\n")[0]})`);
} else {
  console.log("  – skipped: gh is not installed under /opt/homebrew/bin or /usr/local/bin on this machine, so the real run is unverified here");
}

console.log("gh — gh is nowhere at all:");
const miss = await runGh(["--version"], empty, { PATH: empty });
ok(miss.code !== 0, `a missing gh is a failure (exit ${miss.code})`);
ok(/ENOENT/.test(miss.out), `…and says why instead of nothing: "${miss.out}"`);

console.log("gh — the reviewer's post_review goes through it:");
const lane = readFileSync(new URL("../dist/main/adapters/lane.js", import.meta.url), "utf8");
ok(/gh_1\.runGh\)\(/.test(lane), "lane.ts calls the shared runGh");
ok(!/execFile\)\("gh"/.test(lane), "lane.ts starts no gh of its own");

process.env.PATH = realPath;
console.log(fails ? `\n${fails} FAILED` : "\nall green");
process.exit(fails ? 1 : 0);
