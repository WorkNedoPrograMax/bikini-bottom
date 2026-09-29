// Checks lane setup (what a fresh lane needs before a character can build) —
// the PURE recipe parts against dist/, plus the runner against a FAKE project
// in a temp folder (real copies, real tiny shell commands; no Flutter, no
// Electron, no Claude). Run after `npm run build`:
//   node scripts/check-lane-setup.mjs
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const D = require("../dist/main/domain/laneSetup.js");
const { seedSetup, normalizeSetup, expandCopy, pendingRuns, mergeReport, stepWord, setupNote, setupActivity } = D;
const { runSetup, loadReport, setupDue } = require("../dist/main/adapters/laneSetup.js");
const { normalizeProfile, serializeProfile } = require("../dist/main/config/townProfile.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

console.log("seedSetup — a Flutter folder gets the recipe, anything else none:");
const hc = new Set(["pubspec.yaml", ".fvmrc", ".maestro"]);
const flutter = seedSetup((rel) => hc.has(rel));
ok(flutter && JSON.stringify(flutter.copy) === JSON.stringify(["env/.env*", ".mcp.json"]), "copies the git-ignored env files (env/.env*) and the per-machine MCP wiring (.mcp.json)");
ok(flutter && flutter.run[0] === "fvm install", "step 1 is `fvm install` (the pinned SDK may be missing; `fvm flutter` would prompt)");
ok(flutter && flutter.run[1] === "fvm flutter pub get", "step 2 is `fvm flutter pub get`");
ok(flutter && flutter.run[2] === "fvm dart run build_runner build --delete-conflicting-outputs", "step 3 is build_runner");
ok(flutter && flutter.run[3] === "fvm dart run intl_utils:generate" && flutter.run.length === 4, "step 4 is intl_utils, nothing else");
const noFvm = seedSetup((rel) => rel === "pubspec.yaml");
ok(noFvm && noFvm.run[0] === "flutter pub get" && !noFvm.run.some((c) => c.startsWith("fvm")), "no .fvmrc → plain flutter/dart, no fvm install");
ok(seedSetup(() => false) === null, "a non-Flutter folder → no recipe");
ok(seedSetup((rel) => rel === "package.json") === null, "a Node project → no recipe (S&R lanes come ready)");

console.log("normalizeSetup — town.json is trimmed, never trusted blindly:");
ok(normalizeSetup(undefined) === null && normalizeSetup("x") === null && normalizeSetup({}) === null, "missing / junk / empty → null");
ok(JSON.stringify(normalizeSetup({ copy: ["a", " ", 3], run: ["  b  "] })) === JSON.stringify({ copy: ["a"], run: ["b"] }), "blank and non-string entries dropped, whitespace trimmed");
ok(JSON.stringify(normalizeSetup({ run: ["x"] })) === JSON.stringify({ run: ["x"] }), "run without copy is fine (no empty copy key)");
const prof = normalizeProfile({ name: "highcap", landing: "none", setup: { copy: ["env/.env*"], run: ["fvm install"] } }, "/x/highcap");
ok(prof.setup && prof.setup.run[0] === "fvm install", "the profile carries the recipe through normalize");
ok(serializeProfile(prof).includes('"setup"'), "…and writes it back to town.json");
ok(!normalizeProfile({ name: "p", landing: "none", setup: { copy: [] } }, "/x/p").setup, "an empty recipe leaves the profile without a setup key");

console.log("expandCopy — a trailing * on the last segment matches a prefix:");
const list = (dir) => (dir === "env" ? [".env", ".env.dev", ".env.example", "notes.md"] : dir === "" ? ["pubspec.yaml", ".mcp.json"] : []);
ok(JSON.stringify(expandCopy("env/.env*", list)) === JSON.stringify(["env/.env", "env/.env.dev", "env/.env.example"]), "env/.env* → .env, .env.dev, .env.example (sorted)");
ok(JSON.stringify(expandCopy(".claude/settings.local.json", list)) === JSON.stringify([".claude/settings.local.json"]), "a literal path is returned as is (the copier skips it if missing)");
ok(JSON.stringify(expandCopy("./.mcp*", list)) === JSON.stringify([".mcp.json"]), "a top-level prefix works, leading ./ ignored");
ok(expandCopy("../secrets/*", list).length === 0 && expandCopy("", list).length === 0, "never reaches outside the project; empty → nothing");
ok(expandCopy("env/nothing*", list).length === 0, "no match → nothing (not the pattern itself)");

console.log("pendingRuns / mergeReport — passed steps are remembered, failed ones retried:");
const recipe = { run: ["a", "b", "c"] };
ok(JSON.stringify(pendingRuns(recipe, null)) === JSON.stringify(["a", "b", "c"]), "first time: everything is pending");
const r1 = mergeReport(null, { copied: ["env/.env"], passed: ["a"], failed: [{ cmd: "b", tail: "boom" }] }, 1000, recipe);
ok(JSON.stringify(pendingRuns(recipe, r1)) === JSON.stringify(["b", "c"]), "after a passes and b fails: b and c pending");
const r2 = mergeReport(r1, { copied: [], passed: ["b", "c"], failed: [] }, 2000, recipe);
ok(JSON.stringify(r2.passed) === JSON.stringify(["a", "b", "c"]) && r2.failed.length === 0 && r2.at === 2000, "passes accumulate, failures are only this run's");
ok(pendingRuns(recipe, r2).length === 0, "all done → nothing pending");
ok(pendingRuns({ run: ["a", "d"] }, r2).join() === "d", "a NEW command in an edited recipe is pending");
ok(mergeReport(r2, { copied: [], passed: [], failed: [] }, 3000, { run: ["a"] }).passed.join() === "a", "a DROPPED command is forgotten");

console.log("setupDue — copies always re-run, commands only until they pass:");
ok(setupDue(null, null) === false, "no recipe → never due");
ok(setupDue({ run: ["a"] }, null) === true && setupDue({ run: ["a"] }, r2) === false, "commands: due until passed");
ok(setupDue({ copy: ["env/.env*"] }, r2) === true, "a copy-only recipe is always due (a secret that arrives later must reach the lane)");

console.log("words — what the street and the prompt say:");
ok(stepWord("fvm install") === "Flutter SDK" && stepWord("fvm flutter pub get") === "packages", "fvm install → Flutter SDK, pub get → packages");
ok(stepWord("fvm dart run build_runner build --delete-conflicting-outputs") === "generated code" && stepWord("fvm dart run intl_utils:generate") === "translations", "build_runner → generated code, intl_utils → translations");
ok(stepWord("make something-quite-long-that-nobody-named-especially") .endsWith("…"), "an unknown long command is shortened");
ok(setupActivity("fvm flutter pub get") === "setting up the lane (packages)…" && setupActivity("waiting") === "waiting for the lane setup…", "activity lines");
ok(setupNote(null) === "" && setupNote({ copied: [], passed: [], failed: [], at: 0 }) === "", "nothing prepared → no sentence");
const note = setupNote({ copied: ["env/.env.dev"], passed: ["fvm install", "fvm flutter pub get"], failed: [{ cmd: "fvm dart run intl_utils:generate", tail: "x\nMissing l10n.yaml" }], at: 1 });
ok(note.includes("already done for you: Flutter SDK, packages") && note.includes("do NOT run these again"), "the prompt says what is done and not to redo it");
ok(note.includes("env/.env.dev"), "…which secrets were copied in");
ok(note.includes("FAILED") && note.includes("intl_utils:generate") && note.includes("Missing l10n.yaml"), "…and which step failed, with the last output line");

console.log("runSetup — the runner on a fake project (real copies, tiny real commands):");
const tmp = mkdtempSync(path.join(tmpdir(), "bikini-setup-"));
const project = path.join(tmp, "project"); const lane = path.join(tmp, "lane");
mkdirSync(path.join(project, "env"), { recursive: true }); mkdirSync(lane, { recursive: true });
writeFileSync(path.join(project, "env", ".env.dev"), "A=1\n"); writeFileSync(path.join(project, "env", ".env.example"), "A=\n"); writeFileSync(path.join(project, "env", "README"), "no\n");
const fake = { copy: ["env/.env*", ".claude/settings.local.json"], run: ["echo hello > ran.txt", "exit 3", "test -f ran.txt"] };
const steps = [];
const rep = await runSetup(project, lane, fake, (c) => steps.push(c));
ok(JSON.stringify(rep.copied) === JSON.stringify(["env/.env.dev", "env/.env.example"]), "copied exactly the env files (README not matched, the missing settings file skipped)");
ok(readFileSync(path.join(lane, "env", ".env.dev"), "utf8") === "A=1\n", "the copy is byte-identical");
ok(rep.passed.length === 2 && rep.passed[0] === "echo hello > ran.txt" && rep.passed[1] === "test -f ran.txt", "two commands passed, in order, in the LANE (the file landed there)");
ok(rep.failed.length === 1 && rep.failed[0].cmd === "exit 3", "the failing step is recorded — and did not stop the next one");
ok(steps[0] === "waiting" && steps.slice(1).join("|") === fake.run.join("|"), "onStep: waiting, then each command before it runs");
ok(existsSync(path.join(project, ".bikini", "setup", "lane.json")) && !existsSync(path.join(lane, ".bikini-setup.json")), "the report is saved under the town's .bikini/setup/<lane>.json — NOT in the lane (nothing to commit by mistake)");
const again = await loadReport(project, lane);
ok(again && again.passed.length === 2 && again.failed[0].cmd === "exit 3", "…and reads back");
ok(setupDue(fake, again) === true && pendingRuns(fake, again).join() === "exit 3", "next job: only the failed step is pending");
writeFileSync(path.join(project, "env", ".env.prod"), "B=2\n");
const rep2 = await runSetup(project, lane, { ...fake, run: ["echo hello > ran.txt", "true", "test -f ran.txt"] }, () => {});
ok(rep2.copied.includes("env/.env.prod"), "a secret that arrived later is copied on the next run");
ok(rep2.passed.length === 3 && rep2.failed.length === 0, "the edited recipe's new step ran; the old passes were kept, not re-run");
const prompted = await runSetup(project, lane, { run: ["read -r x; echo got:$x"] }, () => {});
ok(prompted.passed.length === 1 || prompted.failed.length === 1, "a command that asks for input cannot hang: stdin is closed");
rmSync(tmp, { recursive: true, force: true });

console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
