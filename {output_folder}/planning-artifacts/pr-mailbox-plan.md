# Bikini Bottom — the Mailbox (pull requests on a team repo)

**Date:** 2026-11-04 · **Owner:** Maksym · **Status:** brainstorm + clickable mockup (`mockup/mail-board.html`), awaiting Maksym's answers and go
**Why:** highcap is a team repo now. Pull requests sit for hours with a real reviewer, come back with comments, collide with `dev`, get approved while Maksym is elsewhere. Today none of that is visible in the town; he has to go to GitHub and read six pages to learn that three PRs need him. The town should tell him, in its own words, and let him act from there.
**Shape:** one fresh build session, one branch, one commit, a plain-node check script, no relaunch without Maksym's OK (the Squidward shape). Medium.

---

## Part 1 — for Maksym (plain language)

### The picture

A **mailbox on Conch Street**. When the flag is down, nothing in the repo needs you. When the flag goes up, with a number on it, some mail is for you: a dish was sent back, a teammate's dish is waiting for your tasting, or one of yours got a clean plate and only needs your "merge". Click the mailbox (or press **P**) and the mail is pinned on the same paper as Today's Orders, called **Today's Mail**, sorted so that what needs you is on top, what you are waiting on is at the bottom.

The kitchen words carry over from the Orders board. A pull request is a dish you sent out to the dining room; the reviewer tastes it.

### What you'll see

**On the street**
- A mailbox prop. Flag up + a red number = that many pieces of mail need you. Flag down = nothing. (Maksym's two pictures, cut out 2026-11-04: `mockup/assets/mailbox-empty.png` for flag down, `mockup/assets/mailbox-ready.png` — SpongeBob popping out — for flag up.)
- The top-right row gets a **✉️ Mail** button with the same number, next to Orders.
- The town sign's dropdown counts mail per town too ("highcap-backend · 2 letters"), so mail in the other town is not missed.
- A short **mail chime** when new mail for you arrives (own sound file slot, like the characters' voices).

**On the paper — "Today's Mail"**, three views: **For you** (default) · **Yours** · **Everyone's**. Every line is one PR: its number, its title, a kitchen word on the right, and one plain sentence underneath saying exactly what is going on and what to do. The sections, top to bottom:

| Section | Kitchen word | When | What the line under it says |
|---|---|---|---|
| Fix it | **SENT BACK** | the reviewer asked for changes, or it collides with `dev`, or the checks are red, or comments are still open | "Anna asked for changes · 3 comments to answer · also collides with dev" |
| Fix it | **ALMOST** | approved, but something still blocks the merge | "Anna approved ✓ · but it collides with dev and 2 comments are open — fix those, then it's yours to merge" |
| Ready to merge | **CLEAN PLATE** | approved, checks green, no collisions, no open comments | "Anna approved ✓ · checks green ✓" + a **Merge it** button |
| Your turn | **YOUR TURN** | a teammate's PR nobody has reviewed yet | "Anna's · opened 3 h ago · 14 files" |
| Your turn | **LOOK AGAIN** | a teammate changed their PR after you reviewed it | "Anna pushed since you looked — your old review no longer counts" |
| Waiting on others | **WITH ANNA** | your PR sits with the reviewer; nothing for you | "on Anna's table since 14:15" |
| Nothing for you | **YOU APPROVED · HERS** | you approved, the author merges | "clean, waiting for her to merge" / "9 of your comments still open — she can't merge until they're closed" |
| Nothing for you | **DRAFT** | a draft PR, yours or theirs | faint |

Everything in the first three sections counts toward the number on the flag; the rest does not.

**Acting from the paper**
- **Open on GitHub** — every line, one click.
- **Merge it** — only on CLEAN PLATE lines. A wooden card asks once: "Merge #87 into dev? Anna approved at 14:15 · checks green · no collisions · all comments closed. Squash-merge and delete the branch." Then the town merges, the flag drops by one, a toast says so. The town never merges anything that is not on a clean plate, and never on its own.
- **Hand to a character** — on SENT BACK / ALMOST lines. Opens the Krusty Krab with the brief already written: the PR, its branch, every open comment quoted, the collision with `dev`, and the order: answer each comment, fix the collision, push, say when it is back on the reviewer's table. Patrick or whoever takes it like any other order; it shows on Today's Orders as "FIXING #102". The character uses the same review-fixing skill the project already has.
- **LOOK AGAIN / YOUR TURN** lines can also be handed to a character ("read it with the lead's checklist and write me what to say"), if you want that — see questions.

**On Telegram**
- `/town` gets a `✉️ Mail` block with the same lines.
- A ping when a piece of mail turns into "for you": "📬 Anna approved #87 — clean plate" with a **Merge it** button and an **Open** button, same style as the characters' questions. One ping per change, not a repeat every check.

### How the town knows (and what I measured today)

The town is already logged into GitHub as you (the `gh` tool on this Mac, account WorkNedoPrograMax). Every 2 minutes, and each time you open the paper, it asks GitHub for the open PRs of the town's repo and works out the state itself. I checked the real repo today, 2026-11-04, and the design follows what the team actually does:

- **Nobody uses "request a review".** All six open PRs have an empty reviewer list. So "assigned to me" cannot come from GitHub; the rule is: **any teammate's open, non-draft PR that you have not approved since its last push is your turn.** (Question 1.)
- **The repo's own rules** (on `dev`): zero approvals required, every comment thread must be resolved before merging, the "Analyze PR" check must pass, squash or plain merge allowed, and **a new push throws away earlier reviews**. That last rule is what makes LOOK AGAIN detectable, and the thread rule is why #96 is "blocked" although you approved it: nine of your own comment threads are still open.
- **GitHub's own "review decision" field is unreliable here**: it says nothing on #87 although Anna approved. The town reads the latest review per person, the last push time, the open threads and the collision state itself.
- **Authors merge their own PRs** (29 of the last 30 merges). So the Merge button shows on your PRs only; a teammate's approved PR is shown as hers to merge. (Question 3.)
- **Two towns, two repos**: highcap-mobile (6 open PRs) and highcap-backend (8 open). Each town has its own mailbox for its own repo; the town sign shows the other town's count.

Today's real mail, as the town would say it: three of yours SENT BACK (#102, #101 with Anna's comments and collisions with dev; #87 approved but colliding and two comments open), nothing to merge, nothing to review (you reviewed all three of Anna's today), three of hers waiting on her.

### The rules I assumed (change any)

| Question | Assumed default | Change it by |
|---|---|---|
| Which repo is a town's mail? | The town's own folder's GitHub repo, read off its git remote. | A `repo` line in the town's profile. |
| How often to check? | Every 2 minutes while the app is open, plus on opening the paper. GitHub allows far more. | A number in the profile. |
| Which merge? | Squash, delete the branch after — what the repo allows and what the team does. | One word in the profile. |
| Who may be merged from the town? | Your own PRs only, on a clean plate only. | Question 3. |
| Does a character ever merge? | No. Merging stays a button only you press. Characters still never push to `dev`. | Not changeable in this job. |
| Closed/merged PRs? | Disappear from the paper; a merged one shows as "✓ merged" for a day in the Everyone's view. | — |
| What if GitHub is unreachable? | The paper says "last checked 25 min ago" in the subtitle; the flag keeps its last state; no false alarms. | — |

### What does NOT change

- Today's Orders, the characters, the phone booth, the Ferry: untouched. The mailbox is one more prop, one more paper, one more Telegram block.
- Landing stays "none" on team repos: Bikini still never pushes, rebases or merges a lane by itself. The only merge is the one you press, on GitHub, of a PR GitHub already calls mergeable.
- Scout & Runner and any town without a GitHub remote: no mailbox at all.

### Size

One job, medium. Most of it is a small reader that turns GitHub's answers into the eight kitchen words, plus one prop, one paper, one card, one Telegram block. The "Hand to a character" button reuses the Krusty Krab exactly as it is, with a pre-written brief.

### Left out on purpose (say if you want them)

- Reviewing from inside the town (reading the diff on the paper). Open on GitHub covers it; a character can pre-read it for you.
- Backend's CI details per check; the paper says "checks red", GitHub says which.
- Mail for repos that are not towns.

### Questions for you (answer by number; each has my default)

1. **Your turn to review — the rule.** Default: every teammate's open non-draft PR you haven't approved since their last push is YOUR TURN. Alternative: only PRs where someone explicitly asks you (then it would be empty today, because nobody does).
2. **Hand-off for reviews too?** Default: yes — a LOOK AGAIN / YOUR TURN line gets "Hand to a character", who reads it with the lead's checklist and drafts your review comments for you to approve; the character never posts a review by itself.
3. **Merge button on teammates' approved PRs?** Default: no, hers to merge (team habit). Alternative: show it, behind the same card.
4. **Flag up for "nothing for you" changes?** Default: no — only the three "needs you" sections raise the flag and ping Telegram. Everything else is on the paper when you look.

---

## Part 2 — build notes (for the session that builds it)

- **Reader** (`src/main/adapters/pulls.ts`, pure over injected `gh` output): `gh pr list --json number,title,author,isDraft,headRefName,baseRefName,updatedAt,mergeable,mergeStateStatus,statusCheckRollup,reviews,commits` + one GraphQL call for `reviewThreads{isResolved}` per PR. Derive per PR: `mine`, `latestReviewByUser`, `pushedAfterMyReview`, `unresolvedThreads`, `checks`, `conflicts`, then the word (`sent-back | almost | clean-plate | your-turn | look-again | with-reviewer | theirs | draft`) and the one-line reason. `reviewDecision` is NOT used (measured "" after an APPROVED on #87, 2026-11-04).
- **Snapshot**: `TownSnapshot.mail: MailView | null` (`{ repo, checkedAt, forYou: number, lines: MailLine[] }`), `TownTab.mail?: number`. Fixture hook like `booth` for `scripts/check-mail.mjs` and screenshots.
- **Intents**: `openMail`, `mergePull {number}` (guarded: own PR + word === "clean-plate" at the moment of the click, re-checked against a fresh `gh pr view` before `gh pr merge --squash --delete-branch`), `handOffPull {number}` (opens Home Base with a prefilled brief; the brief quotes unresolved threads from the GraphQL result), `openPullOnGithub {number}`.
- **Renderer**: `#mailbox` prop beside `#booth`; `renderMail()` on the same `.menu-paper`; hotkey **P**; merge card reuses the wooden card styles.
- **Telegram**: `/town` block; a one-shot ping per `(number, word)` transition into a "for you" word, remembered in the event log so a restart does not re-ping.
- **Profile**: `pulls?: { repo?: string; everySec?: number; merge?: "squash" | "merge" }`, defaults as in Part 1.
- **Poll**: `setInterval` 120 s in the town engine, paused while the app is hidden for >10 min (same idea as the phone's bedtime).
- **Checks** (`scripts/check-mail.mjs`, plain node): the eight words from recorded `gh` JSON fixtures taken today (#87 approved+conflicting+2 threads → ALMOST; #96 approved-by-me+9 open threads of mine → THEIRS with the "comments open" reason; #102 changes-requested+conflicting → SENT BACK; a push after my review → LOOK AGAIN; a draft → DRAFT), the merge guard refusing a non-clean-plate and a teammate's PR, and the ping-once rule.
