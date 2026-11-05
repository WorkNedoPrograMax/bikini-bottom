// Checks the Mailbox's PURE parts (GitHub's answers → the kitchen words, the
// merge guard, the ping-once rule, the brief) against dist/, with plain node —
// no Electron, no gh, no network. The fixtures are trimmed real answers from
// highcap-mobile on 2026-11-04 (me = WorkNedoPrograMax). Run after `npm run build`:
//   node scripts/check-mail.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { mailLineFor, mailLines, forYouCount, newPings, pingKey, mergeRefusal, briefFor, repoFromRemote, checksWord, latestVerdicts, firstName, markOnIt } = require("../dist/main/domain/mail.js");
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
// 2026-11-05 #87 for real: Anna's approval dismissed by a push, then she COMMENTED,
// two open threads — each answered by me (last word mine) → WITH ANNA, not for you
const thA = (last, resolved = false) => ({ isResolved: resolved, isOutdated: true, comments: [{ author: ANNA, body: "Non-blocking. _pairs reads…", path: "lib/a.dart", line: 63 }, { author: last, body: "Fixed in 2de540c", path: "lib/a.dart", line: 63 }] });
const l87r = mailLineFor(pr({ number: 87, reviews: [rv(ANNA, "DISMISSED", "2026-11-04T14:15:20Z"), rv(ANNA, "COMMENTED", "2026-11-04T14:23:49Z"), rv(ME, "COMMENTED", "2026-11-05T06:00:46Z")], commits: [{ committedDate: "2026-11-04T22:38:27Z" }], requested: [ANNA] }), [thA(ME), thA(ME)], ME);
ok(l87r.word === "with-reviewer" && !l87r.forYou && l87r.status === "WITH ANNA" && !l87r.askBack.length, `#87 real 2026-11-05: both threads answered by me, Anna re-asked → WITH ANNA, nothing for you (was: SENT BACK · 2 to answer)`);
ok(l87r.reason === "2 comments answered · Anna asked to look again ✓ — nothing for you", `#87 reason: "${l87r.reason}"`);
// the same #87 with NO pending request → ASK ANNA, for you, the button names her (Maksym 2026-11-05: never answered-and-pushed without a re-review ask)
const l87n = mailLineFor(pr({ number: 87, reviews: [rv(ANNA, "COMMENTED", "2026-11-04T14:23:49Z")], commits: [{ committedDate: "2026-11-04T22:38:27Z" }], requested: [] }), [thA(ME), thA(ME)], ME);
ok(l87n.word === "sent-back" && l87n.forYou && l87n.status === "ASK ANNA" && l87n.askBack.length === 1 && l87n.askBack[0] === ANNA, `#87 answered but Anna not re-asked → ASK ANNA, for you, askBack=[Anna]`);
ok(l87n.reason === "2 comments answered · but Anna wasn't asked to look again", `#87 not-asked reason: "${l87n.reason}"`);
ok(l87n.reviewers.includes(ANNA), "reviewers lists Anna (she opened the threads)");
// one answered, one not → SENT BACK, "1 comment to answer · 1 answered"
const lmix = mailLineFor(pr({ number: 88, reviews: [rv(ANNA, "COMMENTED", "2026-11-04T14:23:49Z")] }), [thA(ME), thA(ANNA)], ME);
ok(lmix.word === "sent-back" && lmix.forYou && lmix.reason === "1 comment to answer · 1 answered, waiting to be closed", `one of two still Anna's → SENT BACK: "${lmix.reason}"`);
// Anna's "changes requested" stands, every thread answered but NOTHING pushed since her look → still SENT BACK, says "push"
const lcr = mailLineFor(pr({ number: 89, reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-11-04T14:23:49Z")] }), [thA(ME)], ME);
ok(lcr.word === "sent-back" && lcr.reason === "Anna asked for changes · all 1 comment answered · push the fix so Anna looks again", `changes requested, answered, not pushed → SENT BACK: "${lcr.reason}"`);
// 2026-11-05 #102 for real: changes requested 14:36, pushed 22:50, 3 threads answered 23:09 → WITH ANNA (a push does not dismiss "changes requested")
const l102r = mailLineFor(pr({ number: 102, reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-11-04T14:36:31Z"), rv(ME, "COMMENTED", "2026-11-04T23:09:04Z")], commits: [{ committedDate: "2026-11-04T22:50:00Z" }], requested: [ANNA] }), [thA(ME), thA(ME), thA(ME)], ME);
ok(l102r.word === "with-reviewer" && !l102r.forYou && l102r.status === "WITH ANNA", "#102 real 2026-11-05: pushed after her verdict, all answered, Anna re-asked → WITH ANNA (was: SENT BACK)");
ok(l102r.reason === "Anna asked for changes · fixed and pushed · 3 comments answered · Anna asked to look again ✓", `#102 reason: "${l102r.reason}"`);
// #102 without the re-ask → ASK ANNA
const l102n = mailLineFor(pr({ number: 102, reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-11-04T14:36:31Z")], commits: [{ committedDate: "2026-11-04T22:50:00Z" }] }), [thA(ME), thA(ME), thA(ME)], ME);
ok(l102n.word === "sent-back" && l102n.forYou && l102n.status === "ASK ANNA" && l102n.askBack[0] === ANNA, "#102 pushed + answered but Anna not re-asked → ASK ANNA");
ok(l102n.reason === "Anna asked for changes · fixed and pushed · 3 comments answered · but Anna wasn't asked to look again", `#102 not-asked reason: "${l102n.reason}"`);
// a thread still to answer never shows the ask button (answer first)
ok(!mailLineFor(pr({ number: 105, reviews: [rv(ANNA, "COMMENTED", "2026-11-04T14:23:49Z")] }), [thA(ANNA)], ME).askBack.length, "a thread still hers → no ask button yet");
// pushed after her verdict but one thread still hers → SENT BACK, no "push" nag
const l102h = mailLineFor(pr({ number: 103, reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-11-04T14:36:31Z")], commits: [{ committedDate: "2026-11-04T22:50:00Z" }] }), [thA(ME), thA(ANNA)], ME);
ok(l102h.word === "sent-back" && l102h.reason === "Anna asked for changes · 1 comment to answer", `pushed, one thread still hers → SENT BACK: "${l102h.reason}"`);
// pushed after her verdict, answered, but collides with dev → SENT BACK for the collision
const l102c = mailLineFor(pr({ number: 104, mergeable: "CONFLICTING", reviews: [rv(ANNA, "CHANGES_REQUESTED", "2026-11-04T14:36:31Z")], commits: [{ committedDate: "2026-11-04T22:50:00Z" }] }), [thA(ME)], ME);
ok(l102c.word === "sent-back" && l102c.reason === "Anna asked for changes · all 1 comment answered · also collides with dev", `pushed, answered, colliding → SENT BACK: "${l102c.reason}"`);
// a thread I answered, approved → still ALMOST (the repo wants threads closed)
const lap = mailLineFor(pr({ number: 90, reviews: [rv(ANNA, "APPROVED", "2026-11-04T14:23:49Z")] }), [thA(ME)], ME);
ok(lap.word === "almost" && lap.forYou && lap.reason.includes("1 comment still open"), `approved with an answered-but-open thread → ALMOST: "${lap.reason}"`);
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

console.log("markOnIt — a character is on it (Maksym 2026-11-05: in progress, not stuck as not-done):");
const onIt = new Map([[102, { characterId: "pat", name: "Patrick", since: 1762330000000 }]]);
const marked = markOnIt([l102, l87], onIt, (id) => id === "pat");
ok(marked[0].onIt && marked[0].onIt.characterId === "pat" && !marked[0].forYou && !marked[0].canHandOff && !marked[0].canMerge && !marked[0].askBack.length, "#102 handed to Patrick → on it, not for you, no buttons");
ok(marked[0].status === "PATRICK IS ON IT" && marked[0].reason.startsWith("Patrick is on it · was: Anna asked for changes"), `#102 on-it line: "${marked[0].status}" / "${marked[0].reason}"`);
ok(marked[0].word === "sent-back", "the word underneath stays (the ping key does not change)");
ok(marked[1].onIt === null && marked[1].forYou === l87.forYou, "#87, not handed → untouched");
ok(forYouCount(marked) === forYouCount([l102, l87]) - 1, "the flag counts one less while Patrick is on it");
ok(!newPings(marked, new Set()).some((l) => l.number === 102), "an on-it line never pings");
const done = markOnIt([l102, l87], onIt, () => false);
ok(done[0] === l102 && done[0].forYou === true, "Patrick finished (not working) → the raw line comes back as it was, yours again until the next look");

console.log("briefFor — the character's order:");
const b = briefFor(l102, [th(ANNA, false, "Rename this to miles"), th(ANNA, true, "done")], "EmpatDevelopment/highcap-mobile");
ok(b.includes("#102") && b.includes("git fetch origin feature/x") && b.includes("Never merge it"), "a sent-back PR: the branch, the fetch, the never-merge rule");
ok(b.includes(`gh pr edit 102 -R EmpatDevelopment/highcap-mobile --add-reviewer ${ANNA}`) && b.includes("never skipped"), "the fix brief orders the re-review ask after the push");
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
