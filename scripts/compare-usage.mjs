#!/usr/bin/env node
// Side-by-side cost comparison for the A/B experiment:
//   • SDK lanes (bob, pat)  — read from Bikini's own [usage] log lines
//   • Terminal lane (squid) — read from the real `claude` CLI's session
//     transcript (~/.claude/projects/<escaped-cwd>/*.jsonl)
//
// Run:  node scripts/compare-usage.mjs
// It touches NO tokens — it only reads log files already on disk.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const BIKINI_LOG = path.join(HOME, "Library", "Application Support", "bikini-bottom", "bikini.log");
const PROJECTS = path.join(HOME, ".claude", "projects");

// Where each character works (its lane worktree). Terminal chars are read from
// the claude transcript in that worktree's project dir.
const CODE = path.join(HOME, "development", "code");
const WORKTREES = { bob: path.join(CODE, "sr-bob"), squid: path.join(CODE, "sr-squid"), pat: path.join(CODE, "sr-pat") };
const TERMINAL = new Set(["squid"]); // matches TERMINAL_IDS in main.ts

// Rough price weights (relative to 1 full-price input token). Cache read ≈ 10%,
// cache write (5-min) ≈ 125%, output ≈ 5× input on Opus. A PROXY for comparison,
// not a bill — the shape is what matters.
const W = { input: 1, cacheRead: 0.1, cacheWrite: 1.25, out: 5 };

function blank() { return { input: 0, cacheRead: 0, cacheWrite: 0, out: 0, turns: 0, cold: 0 }; }
function add(a, u) {
  a.input += u.input || 0; a.cacheRead += u.cacheRead || 0;
  a.cacheWrite += u.cacheWrite || 0; a.out += u.out || 0; a.turns += 1;
  if (u.coldResume) a.cold += 1;
}
function units(a) {
  return Math.round(a.input * W.input + a.cacheRead * W.cacheRead + a.cacheWrite * W.cacheWrite + a.out * W.out);
}
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));

// --- SDK lanes: parse [usage] lines from bikini.log ------------------------
const sdk = {};
if (fs.existsSync(BIKINI_LOG)) {
  const re = /\[usage\] (\w+) turn (\{.*\})\s*$/;
  for (const line of fs.readFileSync(BIKINI_LOG, "utf8").split("\n")) {
    const m = line.match(re);
    if (!m) continue;
    const id = m[1];
    if (TERMINAL.has(id)) continue; // squid's terminal era is read from the transcript
    let j; try { j = JSON.parse(m[2]); } catch { continue; }
    (sdk[id] ||= blank());
    add(sdk[id], { input: j.input, cacheRead: j.cacheRead, cacheWrite: j.cacheWrite, out: j.out, coldResume: j.coldResume });
  }
} else {
  console.error(`(no bikini.log at ${BIKINI_LOG})`);
}

// --- Terminal lanes: sum usage from the claude transcript ------------------
function escapeCwd(p) { return p.replace(/[^a-zA-Z0-9]/g, "-"); }
function transcriptUsage(worktree) {
  const dir = path.join(PROJECTS, escapeCwd(worktree));
  if (!fs.existsSync(dir)) return { ...blank(), missing: dir };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
  const acc = blank();
  for (const f of files) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const u = o?.message?.usage;
      if (!u) continue;
      add(acc, {
        input: u.input_tokens, cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens, out: u.output_tokens,
      });
    }
  }
  return acc;
}
const term = {};
for (const id of TERMINAL) term[id] = transcriptUsage(WORKTREES[id]);

// --- Print -----------------------------------------------------------------
function row(label, a, kind) {
  const cold = kind === "SDK" ? `  cold-resumes: ${a.cold}` : "";
  console.log(
    `  ${label.padEnd(7)} ${String(a.turns).padStart(4)} turns | ` +
    `in ${k(a.input).padStart(7)} · cacheR ${k(a.cacheRead).padStart(7)} · cacheW ${k(a.cacheWrite).padStart(7)} · out ${k(a.out).padStart(7)} ` +
    `| ~${k(units(a)).padStart(7)} units${cold}`
  );
}
console.log("\n=== Bikini A/B usage comparison ===");
console.log("(units = rough price proxy: in×1 + cacheR×0.1 + cacheW×1.25 + out×5)\n");
console.log("SDK lanes (bob, pat) — our current app UI, kept warm:");
if (!Object.keys(sdk).length) console.log("  (no SDK usage logged yet)");
for (const id of Object.keys(sdk)) row(id, sdk[id], "SDK");
console.log("\nTerminal lane (squid) — the real `claude` CLI embedded:");
for (const id of Object.keys(term)) {
  if (term[id].missing) { console.log(`  ${id}: (no transcript yet at ${term[id].missing})`); continue; }
  row(id, term[id], "TERM");
}
console.log("\nPer-turn averages (the honest apples-to-apples):");
for (const [id, a] of [...Object.entries(sdk), ...Object.entries(term)]) {
  if (!a.turns) continue;
  console.log(`  ${id.padEnd(7)} ~${k(Math.round(units(a) / a.turns))} units/turn  ·  ctx≈${k(Math.round((a.input + a.cacheRead + a.cacheWrite) / a.turns))}/turn`);
}
console.log("");
