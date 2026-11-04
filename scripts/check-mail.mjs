// Checks the Mailbox's PURE parts (GitHub's answers → the kitchen words, the
// merge guard, the ping-once rule, the brief) against dist/, with plain node —
// no Electron, no gh, no network. The fixtures are trimmed real answers from
// highcap-mobile on 2026-11-04 (me = WorkNedoPrograMax). Run after `npm run build`:
//   node scripts/check-mail.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { mailLineFor, mailLines, forYouCount, newPings, pingKey, mergeRefusal, briefFor, repoFromRemote, checksWord, latestVerdicts, firstName } = require("../dist/main/domain/mail.js");
const { normalizePulls, normalizeProfile } = require("../dist/main/config/townProfile.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const ME = "WorkNedoPrograMax", ANNA = "AnnaPinchukO";
const pr = (o) => ({ title: "t", url: `https://github.com/EmpatDevelopment/highcap-mobile/pull/${o.number}`, author: { login: ME }, isDraft: false, headRefName: "feature/x", baseRefName: "dev", createdAt: "2026-11-04T07:00:00Z", updatedAt: "2026-11-04T14:00:00Z", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", statusCheckRollup: [{ conclusion: "SUCCESS" }], reviews: [], commits: [{ committedDate: "2026-11-04T10:00:00Z" }], ...o });
const rv = (who, state, at) => ({ author: { login: who }, state, submittedAt: at });
const th = (who, resolved = false, body = "please fix") => ({ isResolved: resolved, comments: [{ author: who, body, path: "lib/a.dart", line: 3 }] });

console.log("checksWord — the checks in one word:");
ok(checksWord([{ conclusion: "SUCCESS" }]) === "green", "SUCCESS → green");
ok(checksWord([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]) === "red", "any FAILURE → red");
ok(checksWord([{ status: "IN_PROGRESS", conclusion: null }]) === "pending", "a running check → pending");
ok(checksWord([]) === "none" && checksWord(null) === "none", "no checks → none");

console.log("latestVerdicts — the latest verdict per reviewer, the author ignored:");
const v = latestVerdicts([rv(ME, "CHANGES_REQUESTED", "2026-11-04T07:58:00Z"), rv(ME, "DISMISSED", "2026-11-04T15:23:00Z"), rv(ME, "APPROVED", "2026-11-04T15:51:00Z"), rv(ANNA, "COMMENTED", "2026-11-04T14:00:00Z")], ANNA);
ok(v.get(ME).verdict === "APPROVED", "CHANGES_REQUESTED → DISMISSED → APPROVED reads APPROVED");
ok(!v.has(ANNA), "the author's own comments are not a review");
ok(latestVerdicts([rv(ANNA, "APPROVED", "2026-11-04T10:00:00Z"), rv(ANNA, "DISMISSED", "2026-11-04T11:00:00Z")], ME).get(ANNA).verdict === null, "a DISMISSED approval is no verdict (the repo throws reviews away on push)");

console.log("mailLineFor — my PRs (highcap-mobile, 2026-11-04):");
// #102: Anna asked for changes, 3 open threads of hers, collides with dev → SENT BACK
const l102 = mailLineFor(pr({ number: 102, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-11-04T14:36:00Z")] }), [th(ANNA), th(ANNA), th(ANNA)], ME);
ok(l102.word === "sent-back" && l102.forYou && l102.canHandOff && !l102.canMerge, "#102 changes requested + collision → SENT BACK, for you, hand-off, no merge");
ok(l102.reason === "Anna asked for changes · 3 comments to answer · also collides with dev", `#102 reason: "${l102.reason}"`);
// #87: Anna approved, but CONFLICTING and 2 of her threads open → ALMOST
const l87 = mailLineFor(pr({ number: 87, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-10-29T15:32:00Z"), rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] }), [th(ANNA, true), th(ANNA), th(ANNA)], ME);
ok(l87.word === "almost" && l87.forYou && l87.canHandOff && !l87.canMerge, "#87 approved but colliding with open comments → ALMOST (no Merge button)");
ok(l87.reason.startsWith("Anna approved ✓ · but it collides with dev and 2 comments still open"), `#87 reason: "${l87.reason}"`);
// #87 once fixed: approved, clean, threads closed → CLEAN PLATE with Merge
const l87b = mailLineFor(pr({ number: 87, reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] }), [th(ANNA, true)], ME);
ok(l87b.word === "clean-plate" && l87b.forYou && l87b.canMerge, "#87 fixed: approved + green + clean → CLEAN PLATE, Merge it");
ok(l87b.reason === "Anna approved ✓ · checks green ✓ · no collisions ✓", `#87 fixed reason: "${l87b.reason}"`);
// approved but checks still running → ALMOST, not for you
const lp = mailLineFor(pr({ number: 1, statusCheckRollup: [{ status: "IN_PROGRESS" }], reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] }), [], ME);
ok(lp.word === "almost" && !lp.forYou && !lp.canMerge, "approved, checks running → ALMOST, nothing to do yet");
// nobody looked, nothing wrong → WAITING, not for you
const lw = mailLineFor(pr({ number: 2 }), [], ME);
ok(lw.word === "with-reviewer" && !lw.forYou && lw.status === "WAITING", "no review yet, clean → WAITING (with the reviewer)");
// Anna only commented (no verdict) and left 2 threads → SENT BACK (comments to answer)
const lc = mailLineFor(pr({ number: 3, reviews: [rv(ANNA, "COMMENTED", "2026-11-04T14:00:00Z")] }), [th(ANNA), th(ANNA)], ME);
ok(lc.word === "sent-back" && lc.forYou && lc.reason.startsWith("2 comments to answer"), `comments without a verdict → SENT BACK: "${lc.reason}"`);
// a collision with no review yet → SENT BACK, "fix it before anyone looks"
const lx = mailLineFor(pr({ number: 4, mergeable: "CONFLICTING" }), [], ME);
ok(lx.word === "sent-back" && lx.forYou && lx.reason.includes("collides with dev") && lx.reason.includes("before anyone looks"), `collision, unreviewed → SENT BACK: "${lx.reason}"`);
// my draft → DRAFT, not for you
const ld = mailLineFor(pr({ number: 5, isDraft: true }), [], ME);
ok(ld.word === "draft" && !ld.forYou && !ld.canMerge && !ld.canHandOff, "a draft → DRAFT, nothing to do");

console.log("mailLineFor — Anna's PRs:");
// #94: I approved after her last push, clean → THEIRS
const l94 = mailLineFor(pr({ number: 94, author: { login: ANNA }, reviews: [rv(ME, "CHANGES_REQUESTED", "2026-11-03T14:27:00Z"), rv(ME, "DISMISSED", "2026-11-04T07:58:00Z"), rv(ME, "APPROVED", "2026-11-04T15:23:00Z")], commits: [{ committedDate: "2026-11-04T14:56:00Z" }] }), [], ME);
ok(l94.word === "theirs" && !l94.forYou && !l94.canMerge, "#94 I approved after her push → THEIRS, no Merge button (hers to merge)");
ok(l94.reason === "you approved · Anna's to merge", `#94 reason: "${l94.reason}"`);
// #96: I approved, but 9 of MY threads are open → THEIRS yet for you (close them)
const l96 = mailLineFor(pr({ number: 96, author: { login: ANNA }, mergeStateStatus: "BLOCKED", reviews: [rv(ME, "APPROVED", "2026-11-04T15:51:00Z")], commits: [{ committedDate: "2026-11-04T15:25:00Z" }] }), Array.from({ length: 9 }, () => th(ME)), ME);
ok(l96.word === "theirs" && l96.forYou && l96.reason.includes("9 of your comments are still open"), `#96 my open threads block her merge → for you: "${l96.reason}"`);
// she pushed after my approval → LOOK AGAIN
const la = mailLineFor(pr({ number: 7, author: { login: ANNA }, reviews: [rv(ME, "APPROVED", "2026-11-04T10:00:00Z")], commits: [{ committedDate: "2026-11-04T12:00:00Z" }] }), [], ME);
ok(la.word === "look-again" && la.forYou && la.canHandOff, "a push after my review → LOOK AGAIN");
// my review got dismissed by her push → LOOK AGAIN too
const lb = mailLineFor(pr({ number: 8, author: { login: ANNA }, reviews: [rv(ME, "APPROVED", "2026-11-04T10:00:00Z"), rv(ME, "DISMISSED", "2026-11-04T12:00:00Z")], commits: [{ committedDate: "2026-11-04T09:00:00Z" }] }), [], ME);
ok(lb.word === "look-again" && lb.forYou, "my review dismissed → LOOK AGAIN");
// never reviewed by me → YOUR TURN
const lt = mailLineFor(pr({ number: 9, author: { login: ANNA }, reviews: [rv("mbr-cloud", "APPROVED", "2026-11-04T10:00:00Z")] }), [], ME);
ok(lt.word === "your-turn" && lt.forYou && lt.canHandOff && !lt.canMerge, "never reviewed by me → YOUR TURN (no Merge button on hers)");
ok(lt.reason === "Anna's · waiting for your review · mbr-cloud approved already", `YOUR TURN reason: "${lt.reason}"`);
// I asked for changes, she hasn't pushed → THEIRS (waiting on her)
const lr = mailLineFor(pr({ number: 10, author: { login: ANNA }, reviews: [rv(ME, "CHANGES_REQUESTED", "2026-11-04T10:00:00Z")], commits: [{ committedDate: "2026-11-04T09:00:00Z" }] }), [], ME);
ok(lr.word === "theirs" && !lr.forYou && lr.reason === "you asked for changes · waiting on Anna", "I asked for changes, no push since → THEIRS, waiting on her");

console.log("mailLines — the paper's order and the flag's number:");
const lines = mailLines([pr({ number: 2 }), pr({ number: 9, author: { login: ANNA } }), pr({ number: 102, mergeable: "CONFLICTING", reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-11-04T14:36:00Z")] }), pr({ number: 87, reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] })], {}, ME);
ok(lines.map((l) => l.number).join(",") === "102,87,9,2", `needs-you first, sent-back before clean-plate before your-turn: ${lines.map((l) => `#${l.number} ${l.word}`).join(" · ")}`);
ok(forYouCount(lines) === 3, "3 need you (the WAITING one does not count)");

console.log("newPings — the phone is told once per PR per word:");
const already = new Set([pingKey(lines[0])]);
const fresh = newPings(lines, already);
ok(fresh.map((l) => l.number).join(",") === "87,9", "an already-pinged line is skipped; the rest are new");
ok(pingKey(l87) !== pingKey(l87b), "the same PR going ALMOST → CLEAN PLATE pings again (a new word)");

console.log("mergeRefusal — the guard before `gh pr merge`:");
ok(mergeRefusal(null, null) !== null, "a line that is gone refuses");
ok(mergeRefusal(l94, pr({ number: 94, author: { login: ANNA } })).includes("Anna's"), "a teammate's PR refuses (hers to merge)");
ok(mergeRefusal(l87b, null) !== null, "no fresh answer from GitHub refuses");
ok(mergeRefusal(l87b, pr({ number: 87, mergeable: "CONFLICTING", reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] })).includes("collides"), "a collision that appeared since refuses");
ok(mergeRefusal(l87b, pr({ number: 87, reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z"), rv(ANNA, "DISMISSED", "2026-11-04T16:00:00Z")] })).includes("no approval"), "an approval dismissed since refuses");
ok(mergeRefusal(l87b, pr({ number: 87, statusCheckRollup: [{ status: "IN_PROGRESS" }], reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] })).includes("still running"), "checks running refuses");
ok(mergeRefusal(l87b, pr({ number: 87, mergeStateStatus: "BLOCKED", reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] })).includes("blocked"), "BLOCKED on GitHub (open threads) refuses");
ok(mergeRefusal(l87b, pr({ number: 87, reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:15:00Z")] })) === null, "own PR, approved, green, clean → allowed");

console.log("briefFor — the character's order:");
const b = briefFor(l102, [th(ANNA, false, "Rename this to miles"), th(ANNA, true, "done")], "EmpatDevelopment/highcap-mobile");
ok(b.includes("#102") && b.includes("git fetch origin feature/x") && b.includes("Never merge it"), "a sent-back PR: the branch, the fetch, the never-merge rule");
ok(b.includes("Open review comments (1)") && b.includes("Rename this to miles") && !b.includes("done"), "only OPEN threads are quoted");
ok(b.includes("collision") , "the collision with dev is a task");
const br = briefFor(lt, [], "EmpatDevelopment/highcap-mobile");
ok(br.includes("my turn to review") && br.includes("Post NOTHING on GitHub"), "a teammate's PR: read and draft, never post");

console.log("repoFromRemote / firstName / profile pulls:");
ok(repoFromRemote("git@github.com:EmpatDevelopment/highcap-mobile.git") === "EmpatDevelopment/highcap-mobile", "ssh remote → Owner/repo");
ok(repoFromRemote("https://github.com/EmpatDevelopment/highcap-backend") === "EmpatDevelopment/highcap-backend", "https remote → Owner/repo");
ok(repoFromRemote("https://gitlab.com/x/y.git") === null && repoFromRemote("") === null, "not GitHub → null");
ok(firstName("AnnaPinchukO") === "Anna" && firstName("mbr-cloud") === "mbr-cloud" && firstName("WorkNedoPrograMax") === "Work", "a login's first name");
ok(normalizePulls({ repo: "a/b", everySec: 10, merge: "merge", off: true, junk: 1 }).everySec === 30, "everySec never under 30; unknown fields dropped");
ok(normalizePulls({ repo: "not a repo" }) === null, "a malformed repo is dropped (defaults apply)");
ok(normalizeProfile({ name: "x", pulls: { off: true } }, "/x").pulls.off === true, "profile carries pulls.off");
ok(normalizeProfile({ name: "x" }, "/x").pulls === undefined, "no pulls block → defaults (nothing written)");

console.log(fails ? `\n${fails} check(s) failed` : "\nall mail checks passed");
process.exit(fails ? 1 : 0);
