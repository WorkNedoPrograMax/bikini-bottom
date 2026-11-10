// Checks whose picture a picture is (domain/pictureClaims.ts): the deliverables
// folder is one for every character in every town, so a screenshot Patrick
// made must never ride in Bob's bubble just because Bob was awake when it
// appeared (2026-11-04). Run after `npm run build`:  node scripts/check-pictures.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { newEvidence, noteEvidence, openWindow, closeWindow, isClaimed, pickToShow, dropShownPathLines } = require("../dist/main/domain/pictureClaims.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const DIR = "/Users/maksym/Desktop/claude-deliverables";
const shot = `${DIR}/HIGHCAP-240-settings.png`;
const T = 1_000_000;

console.log("the bug as it happened — Patrick's screenshot, Bob awake in the other town:");
{
  const pat = newEvidence(), bob = newEvidence();
  noteEvidence(pat, { command: `xcrun simctl io booted screenshot ${shot}` });
  noteEvidence(bob, { command: "pytest tests/onboarding -q" });
  noteEvidence(bob, "15 onboarding tests failed. They look for an empty table and found 30 saved answers.");
  ok(isClaimed(pat, shot, T, "Your answers on the phone lists both answers"), "Patrick claims the screenshot his own tool call named");
  ok(!isClaimed(bob, shot, T, "You re-approved the plan, so it's stamped and saved."), "Bob does NOT claim it — nothing of his named it");
  ok(!isClaimed(bob, shot, T, ""), "…nor at the end of his turn (the flush bubble)");
}

console.log("the ways a lane earns a claim:");
{
  const ev = newEvidence();
  ok(isClaimed(ev, shot, T, `Here it is: ${shot}`), "the reply names the full path");
  ok(isClaimed(ev, shot, T, "Here is HIGHCAP-240-settings.png, the settings page"), "the reply names just the file name");
  ok(!isClaimed(ev, shot, T, "Here is HIGHCAP-240-your-answers.png"), "a different picture's name is not a claim");
  noteEvidence(ev, { file_path: shot, content: "…" });
  ok(isClaimed(ev, shot, T, ""), "a Write tool call's input named it");
  const ev2 = newEvidence();
  noteEvidence(ev2, [{ type: "text", text: "Saved 3 captures:\nHIGHCAP-240-settings.png\nHIGHCAP-240-step6-answered.png" }]);
  ok(isClaimed(ev2, shot, T, ""), "a tool result (a helper's report, an ls) named it");
  const ev3 = newEvidence();
  noteEvidence(ev3, "nothing about pictures here");
  ok(ev3.text.length === 0, "text that names no picture is not kept (bounded memory)");
}

console.log("the folder-window claim — `cp shots/*.png …/claude-deliverables/` never spells the names:");
{
  const ev = newEvidence();
  openWindow(ev, "toolu_1", { command: "cp build/shots/*.png ~/Desktop/claude-deliverables/" }, 10_000);
  ok(isClaimed(ev, shot, 15_000, ""), "a picture that appeared while the call ran is claimed (call still open)");
  closeWindow(ev, "toolu_1", 20_000);
  ok(isClaimed(ev, shot, 21_500, ""), "…and up to 2 s after its result came back (clock slack)");
  ok(!isClaimed(ev, shot, 30_000, ""), "…but not one that appeared 10 s after the call ended");
  ok(!isClaimed(ev, shot, 5_000, ""), "…nor one older than the call");
  const ev2 = newEvidence();
  openWindow(ev2, "toolu_2", { command: "cp build/shots/*.png /tmp/out/" }, 10_000);
  ok(!isClaimed(ev2, shot, 15_000, ""), "a call that names some other folder opens no window");
  openWindow(ev2, "", { command: "ls ~/Desktop/claude-deliverables" }, 10_000);
  ok(!isClaimed(ev2, shot, 15_000, ""), "a call with no tool_use id opens no window");
}

console.log("a fresh turn starts with no claims:");
{
  const ev = newEvidence();
  noteEvidence(ev, `wrote ${shot}`);
  const next = newEvidence();
  ok(isClaimed(ev, shot, T, "") && !isClaimed(next, shot, T, ""), "evidence is per turn object; a new one knows nothing");
}

console.log("2026-11-10 — a reply names two pictures an earlier bubble already carried:");
{
  const D = "/Users/maksymloia/Desktop/claude-deliverables/2026-11-10-tester-build-recheck";
  const a = { file: `${D}/android-second-race-hidden.png`, mtime: T }, i = { file: `${D}/iphone-second-race.png`, mtime: T + 1 };
  const other = { file: `${D}/iphone-plan.png`, mtime: T + 2 };
  const ev = newEvidence();
  for (const p of [a, i, other]) noteEvidence(ev, `saved ${p.file}`);
  const shown = new Set([a, i, other].map((p) => `${p.file}@${p.mtime}`));
  const reply = `Here's how it looks on both phones today:\n\n${a.file}\n\n${i.file}\n\nAnd you're right, I shouldn't have talked as if Anna knows.`;
  const picked = pickToShow([a, i, other], shown, ev, reply);
  ok(picked.length === 2 && picked[0] === a && picked[1] === i, "both named pictures ride again, although shown before");
  ok(!picked.includes(other), "a shown picture the reply does not name is not repeated");
  ok(pickToShow([a, i, other], shown, ev, "").length === 0, "the end-of-turn flush repeats nothing already shown");
  ok(pickToShow([a], new Set(), ev, "").length === 1, "a never-shown picture still rides the flush");
  ok(pickToShow([a], shown, newEvidence(), "nothing of mine").length === 0, "another lane's shown picture is still not claimed");
  const cleaned = dropShownPathLines(reply, picked.map((p) => p.file));
  ok(!cleaned.includes("/Users/") && cleaned.includes("both phones today:") && cleaned.includes("Anna knows"), "the bare path lines leave the bubble, the words stay");
  ok(dropShownPathLines(`See ${a.file} for the bug.`, [a.file]).includes(a.file), "a path inside a sentence stays");
  ok(dropShownPathLines(`- \`${other.file}\``, [a.file]).includes("iphone-plan.png"), "a bare path of a picture NOT shown stays");
  ok(dropShownPathLines(`- \`${a.file}\``, [a.file]) === "", "a bulleted, back-ticked bare path of a shown picture goes");
}

console.log(fails ? `\n${fails} check(s) failed` : "\nall picture-claim checks passed");
process.exit(fails ? 1 : 0);
