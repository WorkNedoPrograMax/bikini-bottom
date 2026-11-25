// Checks sleep mode (2026-11-25): the rule (who is answered for, the 20-minute
// auto-away, the retry → diagnosis → stop ladder), what is never done at night,
// the notes and the morning page, the moon button's words — and, on a real
// LaneManager, that an open question comes back at once, a check-in is kept
// cooking, an error is retried once / diagnosed once / stopped, and the page is
// handed over and survives a relaunch.
// NOT covered here: a live Claude session (the hook refusing a real command,
// the character actually calling night_note) — those need a real job.
// Plain node, no Electron. Run after `npm run build`:
//   node scripts/check-sleep.mjs
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const S = require("../dist/main/domain/sleep.js");
const { LaneManager } = require("../dist/main/adapters/lane.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 8000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await tick(20); return cond(); };
const MIN = 60_000, NOW = 1_800_000_000_000;
const lane = (o = {}) => ({ working: false, asking: false, permission: false, paused: false, burned: false, limited: false, waitSince: 0, night: false, recovery: 0, ...o });

console.log("the rule — what the town does next for one character:");
{
  ok(S.AWAY_AFTER_MS === 20 * MIN, "auto-away is 20 minutes");
  ok(S.sleepStep(lane({ asking: true, waitSince: NOW }), true, NOW) === "answer", "moon on + a question open → answered at once");
  ok(S.sleepStep(lane({ asking: true, waitSince: NOW - 19 * MIN }), false, NOW) === "none", "moon off, question 19 min old → still waits for Maksym");
  ok(S.sleepStep(lane({ asking: true, waitSince: NOW - 20 * MIN }), false, NOW) === "answer", "moon off, question 20 min old → goes the night way by itself");
  ok(S.sleepStep(lane({ permission: true, waitSince: NOW - 20 * MIN }), false, NOW) === "deny", "an approval nobody gave for 20 min → refused (never granted for him)");
  ok(S.sleepStep(lane({ paused: true, waitSince: NOW }), true, NOW) === "cook", "moon on + \"keep cooking?\" → yes");
  ok(S.sleepStep(lane({ paused: true, waitSince: NOW - 600 * MIN }), false, NOW) === "none", "moon off: a check-in left for 10 hours still waits (only a QUESTION starts auto-away)");
  ok(S.sleepStep(lane({ paused: true, night: true, waitSince: NOW }), false, NOW) === "cook", "a character already on its own (its question went the night way) is kept cooking");
  ok(S.sleepStep(lane({ paused: true, limited: true }), true, NOW) === "none", "parked on Claude's limit → never ours (it resumes by itself)");
  ok(S.sleepStep(lane({ working: true, asking: true }), true, NOW) === "none", "working → nothing to do");
  ok(S.sleepStep(lane({ burned: true, recovery: 0 }), true, NOW) === "retry", "an error → one retry");
  ok(S.sleepStep(lane({ burned: true, recovery: 1 }), true, NOW) === "diagnose", "the retry failed → one diagnosis pass");
  ok(S.sleepStep(lane({ burned: true, recovery: 2 }), true, NOW) === "stop", "the diagnosis is spent → stop");
  ok(S.sleepStep(lane({ burned: true, recovery: 3 }), true, NOW) === "none", "stopped stays stopped — never a fourth try");
  ok(S.sleepStep(lane({ burned: true, waitSince: NOW - 600 * MIN }), false, NOW) === "none", "moon off: an error left alone waits for Maksym");
  ok(S.sleepStep(lane(), true, NOW) === "none", "idle → nothing");
}

console.log("never at night:");
{
  const bash = (command) => S.nightRefusal("Bash", { command });
  ok(/merge/.test(bash("gh pr merge 104 --squash") || ""), "gh pr merge");
  ok(/merge/.test(bash("cd app && gh pr merge 104") || ""), "…also behind a cd &&");
  ok(/merge/.test(bash("gh api -X PUT repos/o/r/pulls/104/merge") || ""), "a merge through gh api");
  ok(/merge/.test(bash("git push origin HEAD:main") || ""), "a push straight onto main");
  ok(/review/.test(bash("gh pr review 104 --approve -b 'ok'") || ""), "gh pr review");
  ok(/review/.test(S.nightRefusal("mcp__bikini__post_review", { repo: "o/r", number: 1, event: "approve" }) || ""), "the reviewer's own post_review tool");
  ok(/message/.test(bash("gh pr comment 104 -b 'ping'") || ""), "a PR comment");
  ok(/message/.test(S.nightRefusal("mcp__claude_ai_Slack__slack_send_message", { text: "hi" }) || ""), "a Slack message");
  ok(/message/.test(S.nightRefusal("mcp__claude_ai_Gmail__send_message", {}) || ""), "an email");
  ok(/message/.test(S.nightRefusal("mcp__claude_ai_Atlassian_MCP__addOrEditJiraIssueComment", {}) || ""), "a Jira comment");
  ok(/Jira ticket/.test(S.nightRefusal("mcp__claude_ai_Atlassian_MCP__createJiraIssue", {}) || ""), "a new Jira ticket");
  ok(/Jira ticket/.test(S.nightRefusal("mcp__claude_ai_Atlassian_MCP__executeWrite", { name: "createJiraIssue" }) || ""), "a new Jira ticket through the generic write call");
  ok(S.nightRefusal("mcp__claude_ai_Slack__slack_send_message_draft", { text: "hi" }) === null, "a Slack DRAFT is fine (nobody receives it)");
  ok(S.nightRefusal("mcp__claude_ai_Gmail__create_draft", {}) === null, "an email draft is fine");
  ok(S.nightRefusal("mcp__claude_ai_Atlassian_MCP__transitionJiraIssue", {}) === null, "moving a ticket is fine");
  ok(S.nightRefusal("mcp__claude_ai_Atlassian_MCP__getJiraIssue", {}) === null, "reading Jira is fine");
  ok(bash("git push -u origin feat/HIGHCAP-1-x") === null, "pushing the lane's own branch is fine");
  ok(bash("git merge origin/dev") === null, "merging the main line INTO the lane's branch is fine");
  ok(bash("gh pr create --title x --body y") === null, "opening a pull request is fine");
  ok(bash("gh pr view 104 --json reviews") === null && bash("gh api repos/o/r/pulls/104/reviews") === null, "reading reviews is fine");
  ok(bash("flutter test") === null && S.nightRefusal("Edit", { file_path: "a" }) === null, "ordinary work is fine");
  ok(S.refusalReason("merge a pull request").startsWith(S.SLEEP_MARK) && /morning page/.test(S.refusalReason("x")), "the refusal says why and that it is on the morning page");
}

console.log("what the character is told, and what it writes down:");
{
  const r = S.askReply(3, "moon");
  ok(r.startsWith(S.SLEEP_MARK) && /TAKE IT/.test(r) && /PARK it/.test(r) && /night_note/.test(r) && /do every part of the job that does not depend on it/.test(r), "the reply: take your default, park the hard one, write it down, do what does not depend on it");
  ok(/money/.test(r) && /eligible/.test(r) && /access/.test(r) && /losing data/.test(r), "hard to pick = money, eligibility, access, losing data, a real product choice");
  ok(/nobody answered for 20 minutes/.test(S.askReply(1, "away")), "the auto-away reply says why");
  let j = S.openEntries(["Miles or kilometres for a new runner?", "Keep the old screen behind the flag?"], NOW);
  ok(j.length === 2 && j.every((e) => e.kind === "open"), "two questions asked → two open entries");
  j = S.applyNotes(j, [{ question: "Miles or kilometres for a new runner?", decision: "took", choice: "Kilometres", why: "The ticket says the default unit is metric." }], NOW);
  ok(j[0].kind === "took" && j[0].choice === "Kilometres" && j[1].kind === "open", "a note replaces the question it answers; the other stays open");
  j = S.applyNotes(j, [{ question: "keep the old screen behind the flag", decision: "parked", why: "It decides whether paying users lose a feature." }], NOW);
  ok(j[1].kind === "parked" && j.length === 2, "a loosely worded note still finds its question");
  const extra = S.applyNotes(j, [{ question: "Something nobody asked", decision: "took", choice: "A", why: "Because it is the ordinary way." }], NOW);
  ok(extra.length === 3 && extra[2].kind === "took", "a note that matches nothing is kept anyway");
  ok(S.noteProblem({ question: "Miles or km?", decision: "took", why: "The ticket says metric is default." }) !== null, "took without a choice is refused");
  ok(S.noteProblem({ question: "Miles or km?", decision: "parked", why: "no" }) !== null, "a note without a real why is refused");
  ok(S.noteProblem({ question: "Miles or km?", decision: "parked", why: "It changes what paying users see." }) === null, "a full note passes");
  let d = [];
  for (let i = 0; i < 15; i++) d = S.addDid(d, `step ${i}`, NOW + i);
  d = S.addDid(d, "step 14", NOW + 99);
  ok(d.length === S.DID_MAX && d[0].text === "step 3" && d[d.length - 1].text === "step 14", `only the latest ${S.DID_MAX} "did" lines stay, a repeat is kept once`);

  const page = S.morningPage({ town: "/t", townName: "Highcap", id: "bob", name: "SpongeBob" }, [...j, { at: NOW, kind: "did", text: "built the plan screen" }, { at: NOW, kind: "auto", text: "kept cooking" }, { at: NOW, kind: "held", text: "Wanted to merge a pull request" }, { at: NOW, kind: "open", text: "Ship today?", question: "Ship today?" }], NOW - 90 * MIN, NOW);
  ok(page.took.length === 1 && page.took[0].choice === "Kilometres" && /metric/.test(page.took[0].why), "the page lists each decision taken, with what and why");
  ok(page.parked.length === 2 && /no decision was written down/.test(page.parked[1].why), "parked + a question never noted (shown as parked, said honestly)");
  ok(page.did.length === 1 && page.auto.length === 1 && page.held.length === 1, "what it did, what the town did, what was held back");
  const b = S.morningBubble(page);
  ok(/Morning page/.test(b) && /Decided for you/.test(b) && /Still parked/.test(b) && /Held back/.test(b) && /1 h 30 min/.test(b), "the chat bubble carries the same page");
  const t = S.morningTelegram([page, { ...page, name: "Patrick", characterId: "pat" }], false);
  ok(/2 characters/.test(t) && /2 decisions taken for you, 4 still parked/.test(t) && t.length < 4096, "ONE Telegram message for everyone, with the counts");
  ok(S.morningTelegram([], false) === null, "no pages → no message");
  const long = S.morningTelegram(Array.from({ length: 30 }, (_, i) => ({ ...page, name: `C${i}` })), true);
  ok(long.length < 4096 && /more — the full pages are in the town/.test(long), "a long night is cut whole characters at a time, under Telegram's limit");
}

console.log("the moon button:");
{
  const off = S.sleepSign(false, 0, 0, NOW);
  ok(!off.on && off.label === "🌙" && /20 minutes/.test(off.title), "off: a plain moon; the hover names the 20-minute rule");
  const on = S.sleepSign(true, NOW - 125 * MIN, 0, NOW);
  ok(on.on && on.label === "🌙 asleep" && /2 h 5 min/.test(on.title) && /never merge/.test(on.title), "on: \"asleep\", how long, and what is never done");
  const away = S.sleepSign(false, 0, 2, NOW);
  ok(!away.on && away.label === "🌙 2 pages" && away.away === 2, "off but two characters went on alone → \"2 pages\"");
  ok(S.sleepSign(false, 0, 1, NOW).label === "🌙 1 page", "one → \"1 page\"");
  const p1 = S.moonPress(false, 0), p2 = S.moonPress(true, 3), p3 = S.moonPress(false, 2);
  ok(p1.moon && !p1.morning, "press when off → on");
  ok(!p2.moon && p2.morning, "press when on → off + the morning pages");
  ok(!p3.moon && p3.morning, "press when off with pages waiting → the pages, stays off");
}

console.log("a real lane engine:");
{
  const dir = mkdtempSync(join(tmpdir(), "bikini-sleep-"));
  mkdirSync(join(dir, ".bikini"));
  const events = []; const log = { append: async (e) => { events.push(e); }, all: () => events };
  const cues = [];
  const lm = new LaneManager(dir, log, () => {}, () => {}, (id, kind) => cues.push(`${id}:${kind}`));
  const sent = [];
  lm.send = async (id, text) => { sent.push([id, text]); }; // never open a real Claude session from a check
  const live = (id) => { const l = lm.lane(id); l.pump = { closed: () => false, end() {}, push() {} }; l.working = true; return l; };
  const ask = (qs) => ({ story: "s", questions: qs.map((q) => ({ question: q, options: [{ label: "a" }, { label: "b" }] })) });

  // 1. auto-away: a question nobody answers
  const bob = live("bob");
  let bobAnswer = null;
  void lm.promptChoice("bob", ask(["Miles or kilometres for a new runner?"])).then((a) => { bobAnswer = a; });
  await until(() => bob.pendingChoice !== null);
  ok(bob.waitSince > 0 && cues.includes("bob:ready"), "a question rings Maksym and starts the 20-minute clock");
  lm.sleepTick(Date.now() + 19 * MIN);
  await tick(60);
  ok(bob.pendingChoice !== null && bobAnswer === null, "19 minutes: still waiting for him");
  lm.sleepTick(Date.now() + 20 * MIN);
  await until(() => bobAnswer !== null);
  ok(typeof bobAnswer === "string" && bobAnswer.startsWith(S.SLEEP_MARK) && /nobody answered for 20 minutes/.test(bobAnswer), "20 minutes: the question comes back with \"take your default / park it\"");
  ok(bob.working && bob.night && bob.pendingChoice === null && bob.journal.length === 1 && bob.journal[0].kind === "open", "he works on, is on his own, and the question is on his page as open");
  ok(lm.nightCount() === 1 && !lm.isMoon(), "one character has a page waiting; the moon itself is still off");

  // on his own: a check-in is answered yes, with nobody rung
  bob.working = false; bob.paused = true; bob.waitSince = Date.now();
  const cuesBefore = cues.length;
  lm.sleepTick();
  await until(() => sent.length === 1);
  ok(sent.length === 1 && sent[0][0] === "bob" && /Continue from where you left off/.test(sent[0][1]) && !bob.paused, "on his own, \"keep cooking?\" is answered yes");
  ok(cues.length === cuesBefore && bob.journal.some((e) => e.kind === "auto" && /keep cooking/.test(e.text)), "nobody is rung; it is written on his page");
  ok(!bob.conversation.some((m) => m.from === "you" && /Keep going/.test(m.text)), "no words are put in Maksym's mouth in the chat");

  // Maksym talks to him → he is attended again; the page stays owed
  await lm.followUp("bob", "how is it going?");
  ok(!bob.night && bob.journal.length >= 2 && lm.nightCount() === 1, "Maksym writes to him → no longer on his own; what he wrote down stays for the page");
  bob.paused = true; bob.working = false; bob.waitSince = Date.now() - 600 * MIN;
  ok(lm.sleepActionFor("bob") === "none", "now a check-in waits for Maksym again, however long");
  bob.paused = false;

  // 2. the moon: an open question is answered at once
  const pat = live("pat");
  let patAnswer = null;
  void lm.promptChoice("pat", ask(["Ship the fix today?", "Keep the old screen behind the flag?"])).then((a) => { patAnswer = a; });
  await until(() => pat.pendingChoice !== null);
  const sandy = lm.lane("sandy"); sandy.burned = true; // an error Maksym already saw and left
  lm.setMoon(true);
  await until(() => patAnswer !== null);
  ok(patAnswer.startsWith(S.SLEEP_MARK) && /each of these 2 questions/.test(patAnswer) && !pat.night, "moon on → the open questions come back at once (2 of them)");
  ok(pat.journal.filter((e) => e.kind === "open").length === 2, "both are on the page as open until he notes his decisions");
  ok(lm.sleepActionFor("sandy") === "none", "an error from BEFORE the moon is Maksym's — never retried behind his back");
  ok(events.some((e) => e.type === "CharacterStateChanged" && e.id === "pat" && e.state === "working"), "the street shows him working again");

  // 3. the ladder: error → retry → diagnosis → stop
  const squid = live("squid");
  const sentBefore = sent.length, cuesB = cues.length;
  await lm.burn("squid", "the build fell over");
  await until(() => sent.length === sentBefore + 1);
  ok(squid.recovery === 1 && !squid.burned && /Continue from where you left off/.test(sent[sent.length - 1][1]), "an error at night → ONE automatic retry");
  squid.pump = { closed: () => false, end() {}, push() {} }; squid.working = true;
  await lm.burn("squid", "the build fell over again");
  await until(() => sent.length === sentBefore + 2);
  ok(squid.recovery === 2 && squid.diagnosing && sent[sent.length - 1][1] === S.DIAGNOSIS_PROMPT && /READ-ONLY/.test(S.DIAGNOSIS_PROMPT) && /Change nothing/.test(S.DIAGNOSIS_PROMPT), "the retry failed too → ONE read-only diagnosis pass (not a third try)");
  squid.pump = { closed: () => false, end() {}, push() {} }; squid.working = true;
  await lm.burn("squid", "and again");
  await until(() => squid.recovery === 3);
  await tick(120);
  ok(squid.recovery === 3 && squid.burned && sent.length === sentBefore + 2, "it failed again → stopped; nothing more is sent");
  lm.sleepTick(); await tick(120);
  ok(sent.length === sentBefore + 2 && lm.sleepActionFor("squid") === "none", "stopped stays stopped on every later look");
  ok(cues.slice(cuesB).filter((c) => c === "squid:ready").length <= 1, "the phone is not rung for each automatic step");
  ok(squid.journal.filter((e) => e.kind === "auto").length >= 5, "every step is on his page (the three errors, the retry, the diagnosis, the stop)");

  // a diagnosis that ends well is written down and the count starts over
  const gary = live("gary"); gary.diagnosing = true; gary.recovery = 2;
  gary.conversation.push({ from: "them", text: "The token for the test server expired; nothing was changed." });
  await lm.goIdle("gary");
  ok(!gary.diagnosing && gary.recovery === 0 && gary.journal.some((e) => e.kind === "auto" && /Diagnosis \(nothing was changed\): The token/.test(e.text)), "a finished diagnosis lands on the page in his own words");

  // 4. asleep: a status line and a finished turn become "what I did"
  lm.nightDid(pat, "built the plan screen");
  pat.journal = S.applyNotes(pat.journal, [
    { question: "Ship the fix today?", decision: "took", choice: "Yes, behind the flag", why: "The ticket asks for it this sprint and the flag keeps users safe." },
    { question: "Keep the old screen behind the flag?", decision: "parked", why: "It decides what paying users see." },
  ], Date.now());

  // 5. it survives a relaunch
  lm.persist(); await tick(200);
  const saved = existsSync(join(dir, ".bikini", "sessions.json")) ? JSON.parse(readFileSync(join(dir, ".bikini", "sessions.json"), "utf8")) : {};
  ok(saved.pat?.current?.journal?.length === 3 && saved.bob?.current?.journal?.length >= 2, "the pages are saved with the lanes");
  const lm2 = new LaneManager(dir, log, () => {}, () => {}, () => {});
  ok(lm2.lane("pat").journal.length === 3 && lm2.nightCount() >= 2, "a relaunched town still owes the same pages");

  // 6. the morning
  lm.setMoon(false);
  const page = lm.takeMorning("pat", { townName: "Highcap", name: "Patrick" });
  ok(page && page.took.length === 1 && page.parked.length === 1 && page.did.length === 1 && page.name === "Patrick" && page.town === dir, "moon off → Patrick's page: 1 decision, 1 parked, what he did");
  ok(pat.journal.length === 0 && /Morning page/.test(pat.conversation[pat.conversation.length - 1].text), "the page is written into his chat and his journal starts empty");
  ok(lm.takeMorning("pat", { townName: "Highcap", name: "Patrick" }) === null, "a second hand-over gives nothing (one page per night)");
  ok(lm.takeMorning("krabs", { townName: "Highcap", name: "Mr. Krabs" }) === null, "a character that did nothing on its own gets no page");
  for (const m of [lm, lm2]) { if (m.sleepTicker) clearInterval(m.sleepTicker); if (m.limitSweep) clearInterval(m.limitSweep); }
}

console.log("the wiring — the ban comes before everything, the tool and the note are there:");
{
  const js = readFileSync(new URL("../dist/main/adapters/lane.js", import.meta.url), "utf8");
  const hook = js.indexOf("nightRefusal)(toolName");
  const allowOwn = js.indexOf('toolName.startsWith("mcp__bikini__")', hook > 0 ? hook - 2000 : 0);
  ok(hook > 0 && js.indexOf('toolName.startsWith("mcp__bikini__")', hook) > hook, "the night ban is checked before the town's own tools are let through (post_review included) and before bypass");
  ok(/"night_note"/.test(js) && /SLEEP_NOTE/.test(js), "every character has night_note and is told about sleep mode");
  ok(/answer\.startsWith\(\(?.*SLEEP_MARK/.test(js) || /startsWith\(sleep_1\.SLEEP_MARK\)/.test(js), "the asleep reply reaches the character whole (not split per question)");
  const main = readFileSync(new URL("../dist/main/main.js", import.meta.url), "utf8");
  ok(/case "moon":/.test(main) && /case "closeMorning":/.test(main) && /cmd === "sleep"/.test(main), "the button, putting the pages away, and /sleep from the phone are wired");
  ok(/if \(sleepSince\)\s*return;/.test(main), "asleep: no sound and no phone ping per event");
  void allowOwn;
}

console.log("the page — the moon and the morning paper:");
{
  const html = readFileSync(new URL("../src/renderer/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const calm = html.indexOf('id="calmBtn"'), moon = html.indexOf('id="sleepBtn"'), wake = html.indexOf('id="wakeBtn"');
  ok(calm > 0 && moon > calm && wake > moon, "the moon sits right after the leaf, before Wake everyone");
  ok(/<div class="board-wrap morning" id="morning" hidden>/.test(html), "the morning paper starts hidden");
  const rules = [...css.matchAll(/([^{}]*(?:#sleepBtn|\.morning|:root\.asleep)[^{}]*)\{([^}]*)\}/g)];
  ok(rules.length >= 5 && rules.every((r) => !/animation/.test(r[2])), "nothing about sleep mode animates (a running animation costs a frame 60 times a second)");
}

console.log(fails ? `\n${fails} FAILED` : "\nall sleep checks passed");
process.exit(fails ? 1 : 0);
