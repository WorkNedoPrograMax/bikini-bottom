// Checks how the town starts the `gh` CLI (adapters/gh.ts).
// 2026-11-14: the app was launched with no Homebrew on its PATH; post_review
// started gh with no env of its own, gh was not found, and every review came
// back as "GitHub did not take it (exit 1): no message".
// Run after `npm run build`:  node scripts/check-gh.mjs
import { createRequire } from "node:module";
import { mkdtempSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
import { fileURLToPath } from "node:url";
const { ghEnv, runGh } = require("../dist/main/adapters/gh.js");
const dist = fileURLToPath(new URL("../dist/main", import.meta.url));

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

console.log("gh — every place the town starts gh uses the shared starter:");
const lane = readFileSync(join(dist, "adapters/lane.js"), "utf8");
ok(/gh_1\.runGh\)\(/.test(lane), "the reviewer's post_review calls the shared runGh");
const starts = /(execFile|execFileSync|spawn|spawnSync|run)\)?\("gh"/;
const shared = /require\("(\.\/|\.\.\/adapters\/)gh"\)/;
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".js") ? [join(d, e.name)] : []);
const starters = walk(dist).filter((f) => f !== join(dist, "adapters/gh.js") && starts.test(readFileSync(f, "utf8")));
ok(starters.length > 0, `the scan sees the callers (${starters.map((f) => f.slice(dist.length + 1)).join(", ")})`);
for (const f of starters) ok(shared.test(readFileSync(f, "utf8")), `${f.slice(dist.length + 1)} starts gh through adapters/gh`);
ok(starts.test('(0, node_child_process_1.execFile)("gh", args)') && starts.test('await run("gh", ["pr"])') && !shared.test('require("node:child_process")'), "the scan itself catches a bare start (compiled and helper shapes)");

process.env.PATH = realPath;
console.log(fails ? `\n${fails} FAILED` : "\nall green");
process.exit(fails ? 1 : 0);
