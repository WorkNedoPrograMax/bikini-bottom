// Checks the Jira page's PURE part (Jira's answers → the paper's lines) against
// dist/, with plain node — no Electron, no token, no network. The fixtures are
// the real shapes empat.atlassian.net answered on 2026-11-05 (me = Maksym's
// account id), trimmed. Run after `npm run build`:
//   node scripts/check-jira.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { jiraLines, jiraForYou, newJiraPings, plateCounts, adfMentions, adfText, columnIndex, firstName, projectFromLifecycle, ticketKeyOf, moveAfterMerge, sweepBrief, MOVES, markJiraOnIt, canHandJira, townForTicket, jiraBrief } = require("../dist/main/domain/jira.js");
const { normalizeJira, normalizeProfile } = require("../dist/main/config/townProfile.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const ME = "712020:ba559797-3a6f-4af5-a285-8bd05fefe323", ANNA = "61ab79d9657a0500701e3107", MB = "712020:e00aea39-5301-4b63-8246-044bd2beff04";
const SITE = "https://empat.atlassian.net";
const NOW = Date.parse("2026-11-05T18:00:00Z");
const h = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();
const issue = (key, status, o = {}) => ({ id: key, key, fields: { summary: o.summary || `Ticket ${key}`, updated: o.updated || h(1), status: { name: status, statusCategory: { key: "indeterminate" } }, assignee: o.assignee === null ? null : { accountId: o.assignee || ME, displayName: o.assignee ? "Someone" : "Maksym Loia" }, issuetype: { name: "Task" }, parent: null }, changelog: { histories: o.histories || [] } });
const hist = (id, who, whoName, created, items) => ({ id, created, author: { accountId: who, displayName: whoName }, items });
const statusChange = (id, who, whoName, created, from, to) => hist(id, who, whoName, created, [{ field: "status", fromString: from, toString: to }]);
// A real comment body shape (HIGHCAP-274, 2026-11-05 17:44): a mention node, then text.
const adf = (mentionId, mentionText, text) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: mentionId, text: mentionText, accessLevel: "" } }, { type: "text", text: " " + text }] }] });
const comment = (id, who, whoName, created, body) => ({ id, created, author: { accountId: who, displayName: whoName }, body });

console.log("ADF — mentions and plain words:");
const body = adf(ME, "@Maksym Loia", "on threshold.timed: yes, this needs its own ticket");
ok(adfMentions(body).includes(ME) && !adfMentions(body).includes(ANNA), "a mention node carries the account id");
ok(adfText(body) === "@Maksym Loia on threshold.timed: yes, this needs its own ticket", `plain words: "${adfText(body)}"`);
ok(adfMentions({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "no one" }] }] }).length === 0, "no mention node → nobody mentioned");
ok(columnIndex("Code Review") === 2 && columnIndex("code review") === 2 && columnIndex("QA Failed") === -1 && columnIndex("Done") === 7, "the board's columns in order; QA Failed is off the ladder");
ok(firstName("Anna Pinchuk") === "Anna" && firstName("") === "someone", "first names");
ok(projectFromLifecycle({ jira: { projectKeys: ["HIGHCAP"] } }) === "HIGHCAP" && projectFromLifecycle({}) === null, "the project from the plugin's lifecycle config");

console.log("jiraLines — the paper's lines from today's shapes:");
const seen = new Set();
const issues = [
  // tagged: Maksym Brediuk mentioned me on 274, 1 h ago; an older comment by me on it does not count
  issue("HIGHCAP-274", "Code Review", { summary: "US4 [BE]: Produce each day's workout", assignee: MB }),
  // sent back: Anna moved 240 from In QA to QA Failed 3 h ago
  issue("HIGHCAP-240", "QA Failed", { summary: "[CR] Onboarding - Step updates", histories: [statusChange("1", ANNA, "Anna Pinchuk", h(3), "In QA", "QA Failed")] }),
  // moved on: Anna moved 234 from Code Review to Review Completed 5 h ago
  issue("HIGHCAP-234", "Review Completed", { summary: "[FE][Onboarding] Add multiple race date selection", histories: [statusChange("2", ANNA, "Anna Pinchuk", h(5), "Code Review", "Review Completed")] }),
  // newly yours: svk handed 359 to me 2 h ago
  issue("HIGHCAP-359", "To Do", { summary: "[CR] Gender on onboarding", histories: [hist("3", "svk-id", "svk", h(2), [{ field: "assignee", from: "anton-id", to: ME, fromString: "Anton", toString: "Maksym Loia" }])] }),
  // quiet: In Progress, updated 4 days ago
  issue("HIGHCAP-189", "In Progress", { summary: "US1: Greeting", updated: h(4 * 24) }),
  // my own move does not count; a move 3 days ago does not count
  issue("HIGHCAP-233", "Review Completed", { summary: "[FE][Onboarding] Unit system selection", histories: [statusChange("4", ME, "Maksym Loia", h(1), "Code Review", "Review Completed"), statusChange("5", ANNA, "Anna Pinchuk", h(72), "In Progress", "Code Review")] }),
  // plain To Do sub-task: no line at all
  issue("HIGHCAP-206", "To Do", { summary: "[FE] Current-Week Plan Overview" }),
];
const comments = {
  "HIGHCAP-274": [comment("62786", MB, "Maksym Brediuk", h(1), adf(ME, "@Maksym Loia", "please double-check the ladder on tab 4")), comment("62700", ME, "Maksym Loia", h(2), adf(MB, "@Maksym Brediuk", "done")), comment("62600", MB, "Maksym Brediuk", h(30 * 24), adf(ME, "@Maksym Loia", "old one"))],
};
const lines = jiraLines({ issues, comments, me: ME, now: NOW, seen, site: SITE });
const by = (w) => lines.filter((l) => l.word === w);
ok(by("tagged").length === 1 && by("tagged")[0].key === "HIGHCAP-274" && by("tagged")[0].forYou && by("tagged")[0].id === "tagged:62786", "Brediuk's mention 1 h ago → TAGGED YOU, for you, keyed by the comment id");
ok(by("tagged")[0].reason === "Maksym: “@Maksym Loia please double-check the ladder on tab 4”", `tagged reason: "${by("tagged")[0].reason}"`);
ok(by("sent-back").length === 1 && by("sent-back")[0].key === "HIGHCAP-240" && by("sent-back")[0].forYou, "In QA → QA Failed by Anna → SENT BACK, for you");
ok(by("sent-back")[0].reason === "Anna moved it back: In QA → QA Failed", `sent-back reason: "${by("sent-back")[0].reason}"`);
ok(by("moved").length === 1 && by("moved")[0].key === "HIGHCAP-234" && !by("moved")[0].forYou, "Code Review → Review Completed by Anna → MOVED, not for you");
ok(by("assigned").length === 1 && by("assigned")[0].key === "HIGHCAP-359" && by("assigned")[0].forYou && by("assigned")[0].reason === "svk handed it to you · To Do", `handed to me → NEWLY YOURS: "${by("assigned")[0].reason}"`);
ok(by("quiet").length === 1 && by("quiet")[0].key === "HIGHCAP-189" && !by("quiet")[0].forYou && by("quiet")[0].reason.startsWith("in progress, nothing for 4 days"), `4 days quiet In Progress → QUIET: "${by("quiet")[0].reason}"`);
ok(!lines.some((l) => l.key === "HIGHCAP-233"), "my own move, and a move 3 days old, make no line");
ok(!lines.some((l) => l.key === "HIGHCAP-206"), "a plain To Do sub-task is no line (it is a count on the plate)");
ok(lines[0].forYou && lines.every((l, i) => i === 0 || (lines[i - 1].forYou || !l.forYou)), "for-you lines first");
ok(jiraForYou(lines) === 3, `3 for you (tagged, sent back, newly yours): ${jiraForYou(lines)}`);
ok(newJiraPings(lines, new Set()).length === 3 && newJiraPings(lines, new Set(["tagged:62786"])).length === 2, "pings once per line id");
const after = jiraLines({ issues, comments, me: ME, now: NOW, seen: new Set(["tagged:62786", "sent-back:HIGHCAP-240:1", "assigned:HIGHCAP-359:3"]), site: SITE });
ok(jiraForYou(after) === 0 && after.some((l) => l.word === "tagged"), "once seen, the lines stay on the page but the flag drops to 0");
const plate = plateCounts(issues, ME);
ok(plate.map((p) => `${p.status} ${p.count}`).join(" · ") === "To Do 2 · In Progress 1 · Review Completed 2 · QA Failed 1", `the plate in board order: ${plate.map((p) => `${p.status} ${p.count}`).join(" · ")}`);
ok(lines.find((l) => l.key === "HIGHCAP-274").url === "https://empat.atlassian.net/browse/HIGHCAP-274", "lines link to the ticket");

console.log("batchHandovers — many tickets from one person are one line (Alona, 25 tickets, 2026-11-05):");
const many = Array.from({ length: 6 }, (_, n) => issue(`HIGHCAP-${300 + n}`, n ? "To Do" : "In Progress", { summary: `T${n}`, histories: [hist(`h${n}`, "alona-id", "Alona", h(2 + n), [{ field: "assignee", from: null, to: ME }])] }));
const batched = jiraLines({ issues: many, comments: {}, me: ME, now: NOW, seen: new Set(), site: SITE });
ok(batched.length === 1 && batched[0].word === "assigned" && batched[0].key === "×6" && batched[0].forYou, "6 hand-overs by Alona on one day → ONE line, for you");
ok(batched[0].reason === "Alona handed you 6 tickets · 1 In Progress, 5 To Do · HIGHCAP-300, HIGHCAP-301, HIGHCAP-302, HIGHCAP-303, HIGHCAP-304…", `batch reason: "${batched[0].reason}"`);
ok(batched[0].url.startsWith("https://empat.atlassian.net/issues/?jql=") && decodeURIComponent(batched[0].url).includes("key in (HIGHCAP-300, HIGHCAP-301"), "the batch line opens a Jira search over those tickets");
ok(batched[0].id === "assigned-batch:Alona:2026-11-05", "one id per person per day — one ping, one seen");
const few = jiraLines({ issues: many.slice(0, 3), comments: {}, me: ME, now: NOW, seen: new Set(), site: SITE });
ok(few.length === 3 && few.every((l) => l.word === "assigned" && l.key.startsWith("HIGHCAP-")), "three or fewer stay separate lines");

console.log("ticketKeyOf / moveAfterMerge — the ticket follows the merge (measured transitions, 2026-11-05):");
ok(ticketKeyOf("feature/HIGHCAP-275-plan-view", "[HIGHCAP-275] Plan tab", "HIGHCAP") === "HIGHCAP-275", "the key from the branch");
ok(ticketKeyOf("fix/miles-when-unset", "fix(HIGHCAP-233): a Runner who never chose a unit", "HIGHCAP") === "HIGHCAP-233", "the key from the title when the branch has none");
ok(ticketKeyOf("chore/harness-x", "tidy", "HIGHCAP") === null && ticketKeyOf("feature/OTHER-1-x", "x", "HIGHCAP") === null, "no key, or another project's key → null");
const ok1 = moveAfterMerge("Code Review");
ok(ok1.ok && ok1.move.transition === "Review approved" && ok1.move.to === "Review Completed", "merged while in Code Review → \"Review approved\" → Review Completed");
ok(!moveAfterMerge("Review Completed").ok && moveAfterMerge("Review Completed").why.includes("already past"), "already Review Completed → nothing");
ok(!moveAfterMerge("Ready for QA").ok && !moveAfterMerge("In QA").ok, "past the review columns → nothing (Ready for QA is the deploy's step, never the town's)");
ok(!moveAfterMerge("In Progress").ok && moveAfterMerge("In Progress").why.includes("not in Code Review"), "merged straight from In Progress → nothing, says why");
ok(!moveAfterMerge(null).ok && !moveAfterMerge("").ok, "unreadable ticket → nothing");
ok(MOVES.start.transition === "Start work" && MOVES.review.transition === "To review" && MOVES.changes.to === "In Progress", "the board's moves by their real transition names");

console.log("sweepBrief — the character's order for the sweep:");
const sb = sweepBrief({ project: "HIGHCAP", site: "https://empat.atlassian.net", plate: [{ status: "To Do", count: 25 }, { status: "Code Review", count: 4 }], open: 29, repos: ["EmpatDevelopment/highcap-mobile", "EmpatDevelopment/highcap-backend"] });
ok(sb.includes("29 open tickets (To Do 25 · Code Review 4)") && sb.includes("project = HIGHCAP AND assignee = currentUser()"), "names the board and the JQL");
ok(sb.includes("\"Start work\"") && sb.includes("\"To review\"") && sb.includes("\"Review approved\"") && sb.includes("\"Changes requested\""), "the only moves, by transition name");
ok(sb.includes("never yours to move") && sb.includes("never create tickets") && sb.includes("never change assignees"), "the never-list");
ok(sb.includes("Ask me ONCE with ask_maksym") && sb.includes("\"Move it\" / \"Leave it\"") && sb.includes("Flag as blocked"), "one question, Move/Leave/Flag per proposal");
ok(sb.includes("gh pr list -R <repo>") && sb.includes("highcap-mobile, EmpatDevelopment/highcap-backend"), "the work is read from both repos");
ok(sb.includes("the board is in order"), "nothing to propose → no question");

console.log("hand a note to a character — tagged / sent-back only, \"X is on it\" until they finish:");
const tagged = { id: "tagged:62694", key: "HIGHCAP-274", title: "US4 [BE]: Produce each day's workout", url: SITE + "/browse/HIGHCAP-274", status: "Code Review", word: "tagged", label: "TAGGED YOU", reason: "Anna: “Two config rows from PR #125 have no reader yet”", forYou: true, since: NOW - 3600e3, who: "Anna", mine: false };
const sentBack = { ...tagged, id: "sent-back:HIGHCAP-233:9001", key: "HIGHCAP-233", word: "sent-back", label: "SENT BACK", reason: "Yaroslav moved it back: In QA → QA Failed", status: "QA Failed", who: "Yaroslav", mine: true };
const handed = { ...tagged, id: "assigned:HIGHCAP-160:1", word: "assigned", label: "NEWLY YOURS" };
const moved = { ...tagged, id: "moved:HIGHCAP-336:2", word: "moved", label: "MOVED", forYou: false };
ok(canHandJira(tagged) && canHandJira(sentBack) && !canHandJira(handed) && !canHandJira(moved), "tagged and sent-back can be handed; a hand-over or an FYI move cannot");
const onIt = new Map([["tagged:62694", { characterId: "pat", name: "Patrick", since: NOW }], ["sent-back:HIGHCAP-233:9001", { characterId: "bob", name: "SpongeBob", since: NOW }]]);
const marked = markJiraOnIt([tagged, sentBack, handed], onIt, (id) => id === "pat");
ok(marked[0].onIt && marked[0].onIt.name === "Patrick" && marked[0].forYou === false, "a handed note says who is on it and stops being for you");
ok(marked[1].onIt === null && marked[1].forYou === true, "a mark whose character is not cooking anymore is ignored — the note is yours again");
ok(marked[2].onIt === null && marked[2].forYou === true, "other notes untouched");
ok(jiraForYou(marked) === 2 && jiraForYou([tagged, sentBack, handed]) === 3, "the flag count drops by the handed note");
const handTowns = [{ path: "/m", repo: "EmpatDevelopment/highcap-mobile" }, { path: "/b", repo: "EmpatDevelopment/highcap-backend" }];
ok(townForTicket("US4 [BE]: Produce each day's workout", handTowns) === "/b", "a [BE] ticket goes to the backend town");
ok(townForTicket("[FE] Plan tab calendar", handTowns) === "/m" && townForTicket("Something plain", handTowns) === "/m", "anything else goes to the first town");
ok(townForTicket("[BE] x", [handTowns[0]]) === "/m" && townForTicket("x", []) === null, "one town → that town; none → null");
const handComments = [
  { id: "62694", created: "2026-11-04T17:44:00.000Z", author: { accountId: ANNA, displayName: "AnnaPinchukO" }, body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: ME, text: "@Maksym" } }, { type: "text", text: " two config rows from PR #125 have no reader yet — intended?" }] }] } },
  { id: "62600", created: "2026-11-03T10:00:00.000Z", author: { accountId: ME, displayName: "Maksym Loia" }, body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "PR is up" }] }] } },
];
const tb = jiraBrief({ line: tagged, comments: handComments, site: SITE, project: "HIGHCAP", me: ME });
ok(tb.startsWith("Anna tagged me on HIGHCAP-274 on Jira (Code Review)"), "a tagged note: who, the ticket, its column");
ok(tb.includes("Maksym (me), 2026-11-03 10:00: “PR is up”") && tb.indexOf("“PR is up”") < tb.indexOf("intended?"), "the thread is in the order, oldest first, me marked");
ok(tb.includes("getJiraIssue HIGHCAP-274") && tb.includes("listJiraIssueComments HIGHCAP-274"), "reads the ticket and the thread through the Atlassian MCP");
ok(tb.includes("post it as a comment on HIGHCAP-274 written as me") && tb.includes("addressed to Anna with an @mention"), "a question → an answer on Jira, as Maksym, to Anna");
ok(tb.includes("the ticket to In Progress when you start") && tb.includes("the ticket to Code Review with the PR link"), "a change request → the work by the ticket rules");
ok(tb.includes("ask me ONCE with ask_maksym") && tb.includes("Never commit me to a date, an amount or an action I did not state"), "a decision → one question; no promises in Maksym's name");
ok(tb.includes("never create tickets") && tb.includes("never Done, the QA columns, assignees"), "the never-list");
ok(tb.includes("Never answer from memory"), "facts from the code");
const sb2 = jiraBrief({ line: sentBack, comments: [], site: SITE, project: "HIGHCAP", me: ME });
ok(sb2.startsWith("HIGHCAP-233 came back to me on Jira: Yaroslav moved it back: In QA → QA Failed. It sits in QA Failed now."), "a sent-back note: what happened and where it sits");
ok(sb2.includes("(no comments read yet — read them on Jira)"), "no comments in hand → says so");
ok(sb2.includes('gh pr list --search "HIGHCAP-233" --state all') && sb2.includes("Move the ticket to In Progress") && sb2.includes("move the ticket to Code Review (\"To review\")"), "find the PR, pick the ticket up, send it on again");
ok(sb2.includes("reproduce it first"), "a QA failure is reproduced before the fix");
ok(!sb2.includes("undefined") && !tb.includes("undefined"), "no holes in either order");

console.log("profile — the jira spec:");
ok(normalizeJira({ project: "HIGHCAP" }).project === "HIGHCAP" && normalizeJira({ project: "bad key" }) === null && normalizeJira({ off: true }).off === true && normalizeJira({}) === null, "project key validated, off kept, empty dropped");
ok(normalizeProfile({ name: "x", jira: { project: "HIGHCAP" } }, "/tmp/x").jira.project === "HIGHCAP", "the profile carries it");

if (fails) { console.log(`\n${fails} check(s) failed`); process.exit(1); }
console.log("\nall jira checks passed");
