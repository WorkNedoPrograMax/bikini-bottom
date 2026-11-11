// Checks the Notebook's PURE parts (domain/notebook.ts) against dist/, with
// plain node — no Electron, no Jira, no network. Run after `npm run build`
// (it is wired into postbuild):
//   node scripts/check-notebook.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const N = require("../dist/main/domain/notebook.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const UA = "HIGHCAP-275: зробив вкладку плану з перемиканням тижнів і кешем на день, головна проблема — сервер віддавав дати без часового поясу.";

console.log("jiraMoveOf — which tool calls move a ticket:");
ok(N.jiraMoveOf("mcp__claude_ai_Atlassian_MCP__transitionJiraIssue", { cloudId: "x", issueIdOrKey: "HIGHCAP-275", transition: { id: "31" } })?.key === "HIGHCAP-275", "the Atlassian MCP's transitionJiraIssue → the key");
ok(N.jiraMoveOf("mcp__claude_ai_Atlassian_MCP__transitionJiraIssue", { issueIdOrKey: "highcap-275", transition: { id: 31 } })?.transitionId === "31", "a lowercase key and a numeric id are normalised");
ok(N.jiraMoveOf("mcp__other_server__transitionJiraIssue", { issueIdOrKey: "HIGHCAP-1" }) !== null, "any server name — the tool's last segment decides");
ok(N.jiraMoveOf("mcp__claude_ai_Atlassian_MCP__executeWrite", { name: "transitionJiraIssue", inputs: { issueIdOrKey: "HIGHCAP-9", transition: { id: "5" } } })?.key === "HIGHCAP-9", "the generic executeWrite carrying a transition counts too");
ok(N.jiraMoveOf("mcp__claude_ai_Atlassian_MCP__addCommentToJiraIssue", { issueIdOrKey: "HIGHCAP-275" }) === null, "a comment is not a move");
ok(N.jiraMoveOf("Bash", { command: "curl -X POST .../transitions" }) === null, "a shell command is not read as a move");
ok(N.jiraMoveOf("mcp__claude_ai_Atlassian_MCP__transitionJiraIssue", { issueIdOrKey: "12345" }) === null, "a bare numeric issue id (no key) is not tracked");

console.log("jiraTransitionsOf — learning the move names from the character's own lookup:");
const offered = { content: [{ type: "text", text: JSON.stringify({ transitions: [{ id: "11", name: "Start work", to: { name: "In Progress" } }, { id: "31", name: "To review", to: { name: "Code Review" } }] }) }] };
const t = N.jiraTransitionsOf("mcp__claude_ai_Atlassian_MCP__getTransitionsForJiraIssue", { issueIdOrKey: "HIGHCAP-275" }, offered);
ok(t && t.key === "HIGHCAP-275" && t.names["31"] === "To review" && t.names["11"] === "Start work", "JSON inside an MCP text block → id → name");
const t2 = N.jiraTransitionsOf("mcp__claude_ai_Atlassian_MCP__getTransitionsForJiraIssue", { issueIdOrKey: "HIGHCAP-275" }, { transitions: [{ id: 31, name: "To review" }] });
ok(t2 && t2.names["31"] === "To review", "a structured answer works too");
ok(N.jiraTransitionsOf("mcp__claude_ai_Atlassian_MCP__getJiraIssue", { issueIdOrKey: "HIGHCAP-275" }, offered) === null, "another tool's answer is ignored");
ok(N.jiraTransitionsOf("mcp__claude_ai_Atlassian_MCP__getTransitionsForJiraIssue", { issueIdOrKey: "HIGHCAP-275" }, { content: [{ type: "text", text: "not json" }] }) === null, "no transitions in the answer → null, not a crash");

console.log("reachedReview — which moves and columns mean 'done from Maksym's side':");
ok(N.reachedReview("To review") && N.reachedReview("Code Review") && N.reachedReview("Review approved") && N.reachedReview("review completed"), "To review / Code Review / Review approved / Review Completed → yes");
ok(!N.reachedReview("Start work") && !N.reachedReview("In Progress") && !N.reachedReview("Changes requested") && !N.reachedReview("Deployed, ready for QA") && !N.reachedReview(null), "Start work / In Progress / Changes requested / Deployed / unknown → no");

console.log("sentenceCheck — the line as a hand can copy it:");
ok(N.sentenceCheck("HIGHCAP-275", UA).ok, "a Ukrainian sentence naming the key passes");
ok(N.sentenceCheck("highcap-275", "**HIGHCAP-275**: зробив екран плану, проблема — дати без часового поясу").ok, "Markdown stripped, key case-insensitive, a missing full stop is added");
ok(N.sentenceCheck("HIGHCAP-275", "Зробив екран плану, проблема — дати без часового поясу зсували день.").ok === false, "no key in it → refused");
ok(N.sentenceCheck("HIGHCAP-275", "HIGHCAP-275: added the plan tab with a day cache; the server sent dates without a timezone.").ok === false, "English → refused (must be Ukrainian)");
ok(N.sentenceCheck("HIGHCAP-275", "HIGHCAP-275: зробив екран плану. Проблема була в датах без часового поясу.").ok === false, "two sentences → refused");
ok(N.sentenceCheck("HIGHCAP-275", "HIGHCAP-275: зробив екран плану з перемиканням тижнів і кешем на день, головна проблема — сервер віддавав дати без часового поясу, " + "і день зсувався на годину, тому довелося переписати розбір дат ".repeat(3) + ".").ok === false, "far too long → refused");
ok(N.sentenceCheck("HIGHCAP-275", "HIGHCAP-275: готово.").ok === false, "too short to say anything → refused");
ok(N.sentenceCheck("nonsense", UA).ok === false, "a bad key → refused");
ok(N.sentenceCheck("HIGHCAP-275", "HIGHCAP-275: поле avatarUrl приходило як null, а код чекав рядок, тож додав перевірку на null і запасну картинку.").ok, "a few Latin code words inside a Ukrainian sentence are fine");

console.log("the state — one line per key, ever; the pending key goes when the line lands:");
let st = N.EMPTY_NOTEBOOK;
let p = N.notePending(st, "HIGHCAP-275", "bob", 1000);
ok(p.added && p.state.pending.length === 1, "a move to review with no line → pending for that character");
ok(!N.notePending(p.state, "HIGHCAP-275", "squid", 2000).added, "the same key pending again → nothing changes (first owner keeps it)");
let a = N.addLine(p.state, { key: "HIGHCAP-275", sentence: UA, characterId: "bob", name: "SpongeBob", at: 3000 });
ok(a.result === "new" && a.state.entries.length === 1 && a.state.pending.length === 0, "the line lands → entry added, pending cleared");
const dupe = N.addLine(a.state, { key: "HIGHCAP-275", sentence: "HIGHCAP-275: інша версія того самого речення про план і дати.", characterId: "squid", name: "Squidward", at: 4000 });
ok(dupe.result === "dupe" && dupe.state === a.state && dupe.existing.characterId === "bob", "a second line for the same key → dupe, the first one stands, state untouched");
ok(!N.notePending(a.state, "HIGHCAP-275", "bob", 5000).added, "a key that already has a line never goes pending again (a re-review, a merge)");
const c = N.setCopied(a.state, "HIGHCAP-275", true, 6000);
ok(c.entries[0].copied && c.entries[0].copiedAt === 6000 && N.uncopiedCount(c) === 0 && N.uncopiedCount(a.state) === 1, "ticking a line → copied, the count drops; unticking is the reverse");
ok(N.setCopied(c, "HIGHCAP-275", false, 7000).entries[0].copiedAt === null, "unticked → copiedAt cleared");

console.log("stopVerdict — the forced step, refused ONCE, never a loop:");
st = N.notePending(N.EMPTY_NOTEBOOK, "HIGHCAP-281", "pat", 1000).state;
let v = N.stopVerdict(st, "pat", false);
ok(v.block && v.key === "HIGHCAP-281" && /notebook_line/.test(v.reason) && /HIGHCAP-281/.test(v.reason), "Patrick owes a line → his first finish is refused, the reason names the tool and the key");
const two = N.notePending(N.notePending(N.EMPTY_NOTEBOOK, "HIGHCAP-281", "pat", 1).state, "HIGHCAP-282", "pat", 2).state;
const v2 = N.stopVerdict(two, "pat", false);
ok(v2.block && v2.keys.length === 2 && /HIGHCAP-281, HIGHCAP-282/.test(v2.reason) && !N.stopVerdict(v2.state, "pat", false).block, "two keys owed (a catch-up) → ONE refusal naming both, then the next finish goes through");
ok(!N.stopVerdict(v.state, "pat", false).block, "the second finish (still no line) goes through — the key is marked nudged");
ok(!N.stopVerdict(st, "pat", true).block, "stop_hook_active (the CLI already continued us once) → never refused, whatever the state says");
ok(!N.stopVerdict(st, "bob", false).block, "another character does not pay for Patrick's line");
const landed = N.addLine(st, { key: "HIGHCAP-281", sentence: UA.replace("HIGHCAP-275", "HIGHCAP-281"), characterId: "pat", name: "Patrick", at: 2000 }).state;
ok(!N.stopVerdict(landed, "pat", false).block, "the line written → the finish is not refused");
ok(!N.stopVerdict(N.EMPTY_NOTEBOOK, "pat", false).block, "nothing owed → nothing refused");

console.log("parseNotebook — the file, whatever is in it:");
const raw = { entries: [{ key: "HIGHCAP-1", sentence: "HIGHCAP-1: рядок.", characterId: "bob", name: "SpongeBob", at: 1, copied: true, copiedAt: 2 }, { key: "HIGHCAP-1", sentence: "dupe" }, { key: "", sentence: "x" }], pending: [{ key: "HIGHCAP-1", characterId: "pat" }, { key: "HIGHCAP-2", characterId: "pat", at: 5, nudged: true }, { key: "HIGHCAP-2", characterId: "bob" }] };
const parsed = N.parseNotebook(raw);
ok(parsed.entries.length === 1 && parsed.entries[0].copied && parsed.entries[0].copiedAt === 2, "entries: one per key, the first wins, copied kept");
ok(parsed.pending.length === 1 && parsed.pending[0].key === "HIGHCAP-2" && parsed.pending[0].nudged === true, "pending: a key with a line is dropped, duplicates collapse, nudged survives a restart");
ok(N.parseNotebook(null).entries.length === 0 && N.parseNotebook("junk").pending.length === 0 && N.parseNotebook({ entries: "x" }).entries.length === 0, "null / junk / wrong shapes → an empty notebook, no crash");
// The crossing a restart must pass: a nudged pending key read back → the next stop still goes through (no second refusal after relaunch).
ok(!N.stopVerdict(parsed, "pat", false).block, "after a relaunch, a key already nudged is not refused again");

console.log("catching up — what moved before the notebook existed:");
const DAY = 86_400_000, NOW = Date.parse("2026-11-10T09:00:00Z");
const hist = (created, to) => ({ created, items: [{ field: "status", fromString: "x", toString: to }] });
const issues = [
  { key: "HIGHCAP-260", fields: { summary: "Plan tab" }, changelog: { histories: [hist("2026-11-09T10:00:00Z", "Code Review"), hist("2026-11-09T15:00:00Z", "Review Completed")] } },
  { key: "HIGHCAP-261", fields: { summary: "Old one" }, changelog: { histories: [hist("2026-11-01T10:00:00Z", "Done")] } },
  { key: "HIGHCAP-262", fields: { summary: "Started" }, changelog: { histories: [hist("2026-11-09T11:00:00Z", "In Progress")] } },
  { key: "HIGHCAP-263", fields: { summary: "Sent back" }, changelog: { histories: [hist("2026-11-10T07:00:00Z", "Code Review"), { created: "2026-11-10T08:00:00Z", items: [{ field: "assignee", toString: "Code Review" }] }] } },
  { key: "HIGHCAP-275", fields: { summary: "Has a line" }, changelog: { histories: [hist("2026-11-10T06:00:00Z", "Code Review")] } },
];
const withLine = N.addLine(N.EMPTY_NOTEBOOK, { key: "HIGHCAP-275", sentence: UA, characterId: "bob", name: "SpongeBob", at: 1 }).state;
const mv = N.movedForward(issues, NOW - 2 * DAY, NOW, withLine);
ok(mv.map((x) => x.key).join(",") === "HIGHCAP-263,HIGHCAP-260", "forward moves inside the window, newest first; a move to In Progress, an old Done and a key with a line are left out");
ok(mv[1].to === "Review Completed" && mv[1].summary === "Plan tab", "the latest forward move of a key is the one reported, with the title");
ok(mv[0].to === "Code Review", "a non-status history item saying 'Code Review' is not a move");
const w = N.catchUpWindow(Date.parse("2026-11-10T09:30:00"), 2);
ok(new Date(w.from).getDate() === 9 && new Date(w.from).getHours() === 0 && w.to === Date.parse("2026-11-10T09:30:00"), "2 days = from the start of yesterday (local) to now");
ok(new Date(N.catchUpWindow(Date.parse("2026-11-10T09:30:00"), 1).from).getDate() === 10, "1 day = today only");
ok(N.jqlDate(Date.parse("2026-11-09T00:05:00")) === "2026/11/09 00:05", "JQL date is local yyyy/MM/dd HH:mm");
const convos = [
  { characterId: "bob", name: "SpongeBob", title: "HIGHCAP-260 plan tab", messages: [{ from: "you", text: "do HIGHCAP-260" }, { from: "them", text: "Looking…", tool: true }, { from: "them", text: "Done: the plan tab shows weeks; the server sent dates without a zone so I normalise them." }] },
  { characterId: "pat", name: "Patrick", title: "something else", messages: [{ from: "them", text: "unrelated" }] },
  { characterId: "squid", name: "Squidward", title: "fix", messages: [{ from: "you", text: "please also check HIGHCAP-263" }, { from: "them", text: "Checked HIGHCAP-263: the retry button kept the error state." }] },
];
const rc = N.recallFor(["HIGHCAP-260", "HIGHCAP-263", "HIGHCAP-999"], convos);
ok(rc.length === 2 && rc[0].key === "HIGHCAP-260" && rc[0].name === "SpongeBob" && rc[0].said.startsWith("Done: the plan tab"), "a conversation naming the key → its last plain reply (tool bubbles skipped)");
ok(rc[1].key === "HIGHCAP-263" && rc[1].characterId === "squid", "a key named only inside a message is found too; an unknown key yields nothing");
const brief = N.catchUpBrief({ tickets: mv, recalls: rc, site: "https://empat.atlassian.net", repos: ["EmpatDevelopment/highcap-mobile"], from: NOW - 2 * DAY, to: NOW });
ok(/HIGHCAP-260/.test(brief) && /HIGHCAP-263/.test(brief) && /notebook_line/.test(brief) && /the plan tab shows weeks/.test(brief) && /change no code/.test(brief) && /highcap-mobile/.test(brief), "the brief lists the tickets, what the old lanes said, the tool, the repo and the no-changes rule");
ok(/found no finished conversation/.test(N.catchUpBrief({ tickets: mv, recalls: [], site: "s", repos: [], from: 0, to: 1 })), "no recalls → the brief says so and points at Jira and GitHub");

console.log("the rest:");
const e1 = { key: "A-1", sentence: "x", characterId: "bob", name: "", at: 1000, copied: false, copiedAt: null };
ok(N.isFresh(e1, 1000 + 60_000) && !N.isFresh(e1, 1000 + N.FRESH_MS + 1) && !N.isFresh({ ...e1, copied: true }, 1000 + 1), "fresh = written within ten minutes and not copied");
ok(N.sortedEntries({ entries: [{ ...e1, at: 1 }, { ...e1, key: "A-2", at: 9 }], pending: [] })[0].key === "A-2", "newest first");
ok(N.bubbleText("HIGHCAP-1: рядок.").startsWith("📓 Записав у записник Максима: HIGHCAP-1"), "the chat bubble names the line");

console.log("the paper (renderer.js) keeps the reader's place:");
const rjs = require("node:fs").readFileSync(new URL("../src/renderer/renderer.js", import.meta.url), "latin1");
const fn = rjs.slice(rjs.indexOf("function renderNotebookPaper("), rjs.indexOf("function closeNotebook("));
ok(/if \(old && drawn === notebookDrawn\) return;/.test(fn) && /JSON\.stringify\(\[nb, noteAsk\]\)/.test(fn), "a snapshot that changes nothing in the notebook does not redraw the paper (2026-11-11: it jumped to the top every push)");
ok(/const keep = old \? old\.scrollTop : 0;/.test(fn) && /paper\.scrollTop = keep;/.test(fn) && fn.indexOf("noteboard.replaceChildren(pad)") < fn.indexOf("paper.scrollTop = keep"), "a redraw puts the scroll back where it was, after the new paper is in the page");
ok(/function closeNotebook\(\) \{[^\n]*notebookDrawn = null;/.test(rjs), "closing the notebook forgets what was drawn, so the next open draws fresh");

console.log(fails ? `\n${fails} check(s) failed` : "\nall notebook checks passed");
process.exit(fails ? 1 : 0);
