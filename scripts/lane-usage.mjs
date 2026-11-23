#!/usr/bin/env node
// What the lanes cost, per lane and per day — one command, no tokens spent.
//
//   npm run usage                      → the last 7 days
//   npm run usage -- 2026-11-09 2026-11-23
//   npm run usage -- 2026-11-23 --lane mobile/bob   (one day, one lane)
//   npm run usage -- 2026-11-09 2026-11-23 --total  (one row per lane)
//
// It reads the engine's own session records (~/.claude/projects/<lane worktree>/
// *.jsonl and their subagents/ folders): every model call is there with its
// real token counts, whichever build of the town made it. So the same command
// gives "before" and "after" for any change.
//
// Words used in the table:
//   calls      model calls (one request each; main session + helpers)
//   avg ctx    average tokens one call carried (fresh input + cache read + cache write)
//   >200k      share of the cost that came from calls carrying more than 200k
//   sonnet     share of the calls that ran on the cheaper model (the rest: the strong one)
//   first      tokens the first call of a brand-new session carried (median)
//   rebuilds   calls that re-wrote more than half of their context to the cache
//              although the session had already been running — split by how long
//              the session had been quiet: under 5 min (compaction and the like),
//              5–60 min (a pause the 1-hour lifetime covers), over 60 min
//   helpers    helper (sub-agent) runs started
//   5m / 1h    cache-write tokens by lifetime
//   cost       relative units: input 1, cache read 0.1, 5-min write 1.25,
//              1-hour write 2, output 5 — a proxy for comparing days, not a bill

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECTS = path.join(os.homedir(), ".claude", "projects");
const LANE_DIR = /-([A-Za-z0-9]+)-([A-Za-z0-9]+)--bikini-worktrees-([a-z]+)$/; // …-highcap-mobile--bikini-worktrees-bob
const W = { input: 1, read: 0.1, w5m: 1.25, w1h: 2, out: 5 };
const BIG = 200_000;

const args = process.argv.slice(2);
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? "") : null; };
const day = (d) => d.toISOString().slice(0, 10);
const to = dates[1] || dates[0] || day(new Date());
const from = dates[0] || day(new Date(Date.now() - 6 * 86_400_000));
const onlyLane = flag("--lane");
const total = args.includes("--total");
const asJson = args.includes("--json");

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

/** Every model call of one record file, oldest first, one per request. */
function callsOf(file) {
  const seen = new Set();
  const calls = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== "assistant" || !d.message?.usage || d.message.model === "<synthetic>") continue;
    const rid = d.requestId || d.message.id;
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);
    const u = d.message.usage, cc = u.cache_creation || {};
    const write = u.cache_creation_input_tokens || 0;
    const w1h = cc.ephemeral_1h_input_tokens || 0;
    calls.push({
      t: Date.parse(d.timestamp), day: String(d.timestamp).slice(0, 10),
      input: u.input_tokens || 0, read: u.cache_read_input_tokens || 0,
      w1h, w5m: Math.max(0, write - w1h), out: u.output_tokens || 0,
      helper: !!d.isSidechain, sonnet: /sonnet/.test(d.message.model || ""),
    });
  }
  return calls.sort((a, b) => a.t - b.t);
}

const blank = () => ({ calls: 0, ctx: 0, cost: 0, bigCost: 0, firsts: [], rb5: 0, rb60: 0, rbOld: 0, rbTokens: 0, helpers: 0, w5m: 0, w1h: 0, sonnet: 0 });
const rows = new Map(); // "lane|day" → totals
const row = (lane, d) => { const k = total ? lane : `${lane}|${d}`; if (!rows.has(k)) rows.set(k, blank()); return rows.get(k); };

for (const dirName of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
  const m = dirName.match(LANE_DIR);
  if (!m) continue;
  const lane = `${m[2]}/${m[3]}`; // mobile/bob
  if (onlyLane && lane !== onlyLane) continue;
  for (const file of files(path.join(PROJECTS, dirName))) {
    const isHelperFile = file.includes(`${path.sep}subagents${path.sep}`);
    const calls = callsOf(file);
    let prev = null;
    for (const c of calls) {
      const ctx = c.input + c.read + c.w5m + c.w1h;
      const first = prev === null;
      const gapMin = first ? 0 : (c.t - prev.t) / 60_000;
      prev = c;
      if (c.day < from || c.day > to) continue;
      const r = row(lane, c.day);
      const cost = c.input * W.input + c.read * W.read + c.w5m * W.w5m + c.w1h * W.w1h + c.out * W.out;
      r.calls++; r.ctx += ctx; r.cost += cost; r.w5m += c.w5m; r.w1h += c.w1h;
      if (ctx > BIG) r.bigCost += cost;
      if (c.sonnet) r.sonnet++;
      if (first && (isHelperFile || c.helper)) r.helpers++;
      if (first && !isHelperFile && !c.helper) r.firsts.push(ctx);
      if (!first && ctx > 20_000 && c.w5m + c.w1h > ctx / 2) {
        if (gapMin < 5) r.rb5++; else if (gapMin <= 60) r.rb60++; else r.rbOld++;
        r.rbTokens += c.w5m + c.w1h;
      }
    }
  }
}

const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n)));
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const out = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, r]) => {
  const [lane, d] = key.split("|");
  return {
    lane, day: d || `${from}..${to}`, calls: r.calls, avgCtx: Math.round(r.ctx / Math.max(1, r.calls)),
    over200kCostShare: r.cost ? +(r.bigCost / r.cost).toFixed(3) : 0, firstCall: median(r.firsts), sessions: r.firsts.length,
    rebuildsUnder5m: r.rb5, rebuilds5to60m: r.rb60, rebuildsOver60m: r.rbOld, rebuildTokens: r.rbTokens,
    sonnetCalls: r.sonnet, helperRuns: r.helpers, write5m: r.w5m, write1h: r.w1h, cost: Math.round(r.cost),
  };
});

if (asJson) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
const head = ["lane", "day", "calls", "avg ctx", ">200k", "first", "rebuilds <5m/5-60m/>60m", "helpers", "sonnet", "5m write", "1h write", "cost"];
const table = out.map((o) => [o.lane, o.day, String(o.calls), k(o.avgCtx), Math.round(o.over200kCostShare * 100) + "%", o.sessions ? k(o.firstCall) : "—",
  `${o.rebuildsUnder5m}/${o.rebuilds5to60m}/${o.rebuildsOver60m}`, String(o.helperRuns), Math.round((o.sonnetCalls / Math.max(1, o.calls)) * 100) + "%", k(o.write5m), k(o.write1h), k(o.cost)]);
const sum = out.reduce((a, o) => ({ calls: a.calls + o.calls, ctx: a.ctx + o.avgCtx * o.calls, rb5: a.rb5 + o.rebuildsUnder5m, rb60: a.rb60 + o.rebuilds5to60m, rbOld: a.rbOld + o.rebuildsOver60m, helpers: a.helpers + o.helperRuns, sonnet: a.sonnet + o.sonnetCalls, w5m: a.w5m + o.write5m, w1h: a.w1h + o.write1h, cost: a.cost + o.cost, big: a.big + o.over200kCostShare * o.cost }),
  { calls: 0, ctx: 0, rb5: 0, rb60: 0, rbOld: 0, helpers: 0, sonnet: 0, w5m: 0, w1h: 0, cost: 0, big: 0 });
table.push(["ALL", `${from}..${to}`, String(sum.calls), k(sum.ctx / Math.max(1, sum.calls)), Math.round((sum.big / Math.max(1, sum.cost)) * 100) + "%", "", `${sum.rb5}/${sum.rb60}/${sum.rbOld}`, String(sum.helpers), Math.round((sum.sonnet / Math.max(1, sum.calls)) * 100) + "%", k(sum.w5m), k(sum.w1h), k(sum.cost)]);
const widths = head.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
const fmt = (r) => r.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
console.log(fmt(head)); console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of table) console.log(fmt(r));
if (!out.length) console.log(`(no lane calls between ${from} and ${to})`);
