// Checks that look-up helpers are forced to Sonnet by the town (domain/helperModel.ts)
// and that both of the lane's PreToolUse hooks apply it. No Claude call is made.
// The live proof is the probe recorded in helperModel.ts's header.
// Run after `npm run build`:  node scripts/check-helper-model.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const M = require("../dist/main/domain/helperModel.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const ALLOW = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
const DENY = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no" } };
const model = (v) => v?.hookSpecificOutput?.updatedInput?.model;

console.log("look-up helpers leave on Sonnet:");
for (const t of ["Explore", "general-purpose", "flutter:task-context-harvester", "task-context-harvester", "flutter:figma-comparer"])
  ok(model(M.withPinnedHelper("Agent", { subagent_type: t, model: "opus", prompt: "p" }, ALLOW)) === "sonnet", `${t} asked for opus → sonnet`);
ok(model(M.withPinnedHelper("Agent", { prompt: "p" }, ALLOW)) === "sonnet", "no subagent_type (the engine's general-purpose) → sonnet");
ok(model(M.withPinnedHelper("Task", { subagent_type: "Explore", prompt: "p" }, ALLOW)) === "sonnet", "the older Task tool name is pinned too");
ok(M.withPinnedHelper("Agent", { subagent_type: "Explore", prompt: "p", description: "d" }, ALLOW).hookSpecificOutput.updatedInput.prompt === "p", "the rest of the launch is kept");

console.log("judging helpers and everything else are left alone:");
for (const t of ["hc-reviewer", "hc-backend-lens", "hc-lens-records", "flutter:code-reviewer", "hc-walkthrough", "flutter:architecture-auditor"])
  ok(model(M.withPinnedHelper("Agent", { subagent_type: t, model: "opus" }, ALLOW)) === undefined, `${t} keeps its model`);
ok(M.withPinnedHelper("Bash", { command: "ls" }, ALLOW) === ALLOW, "a non-helper tool is untouched");
ok(M.withPinnedHelper("Agent", { subagent_type: "Explore", model: "sonnet" }, ALLOW) === ALLOW, "already sonnet → untouched");
ok(M.withPinnedHelper("Agent", { subagent_type: "Explore" }, DENY) === DENY, "a refusal stays a refusal (no rewrite)");
ok(M.withPinnedHelper("Agent", { subagent_type: "Explore" }, {}) && model(M.withPinnedHelper("Agent", { subagent_type: "Explore" }, {})) === undefined, "a verdict that is not an allow is untouched");

console.log("wiring:");
const src = readFileSync(new URL("../src/main/adapters/lane.ts", import.meta.url), "utf8");
const hooks = (src.match(/PreToolUse: \[\{/g) || []).length;
const pinned = (src.match(/hooks: \[async \(input: any\)(?:: Promise<any>)? => withPinnedHelper\(/g) || []).length;
ok(hooks === 2 && pinned === 2, `every lane PreToolUse hook goes through withPinnedHelper (${pinned} of ${hooks})`);

if (fails) { console.log(`\n${fails} check(s) failed`); process.exit(1); }
console.log("\nall helper-model checks passed");
