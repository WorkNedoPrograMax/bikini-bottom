# Architect Review — Bikini Bottom PRD

**Reviewer:** Winston (System Architect)
**Date:** 2026-07-12
**Inputs reviewed:** `prd.md`, `addendum.md`, `REQUIREMENTS.md`, `CONTEXT.md`
**Stance:** This is a well-shaped PRD — the glossary discipline, the assumptions index, and the testable-consequences format are exactly what downstream work needs. My critique is not about the vision; it's about the places where the PRD makes promises the architecture cannot cash without a product decision first, and the invisible NFRs a desktop app quietly requires. I have not designed anything here; every finding is a question the PRD should answer, not an answer I'm supplying.

A framing note before the findings. The whole product rests on two guarantees to a non-technical owner: *nothing finished is ever missable* (SM-2) and *no technical steps, ever* (FR-13, §5). Both are stated as absolutes. Absolutes are cheap to write and expensive to build; several findings below are really the same finding — the PRD asserts an absolute where the underlying machinery (git, long-running processes, macOS, Claude usage limits) only offers a strong default plus failure modes. The honest move, per CONTEXT.md's own "be honest, don't oversell" rule, is to specify the failure-mode experience as product, not leave it to architecture to invent.

---

## Critical

### C-1. FR-13's product bar — "results land back in the Project without technical steps" — is asserted, not established. (§4.6 FR-13, §10 Open Q4, §11)

The PRD defers *how* results land back (auto-merge vs. Maksym-triggered) to architecture, which is fair. What it does not defer — and cannot — is **what happens when parallel results conflict**. Two Lanes on one shared Project, isolated in worktrees, will eventually touch the same files. A textual merge conflict is not a mechanical problem an architecture can silently absorb; it is a *semantic* decision about whose change wins, and today the only entities that can make it are Maksym (who must never see a merge — FR-13's testable consequence) or a Claude session (which means an AI silently rewriting the reconciliation of two pieces of finished work, with no FR governing that behaviour, its failure modes, or how it's surfaced).

The testable consequences as written are contradictory in the hard case: "Two Characters working at once never corrupt or overwrite each other's work" *and* "Maksym never sees or performs a technical merge step." Isolation-while-working gives you the first; landing-back is precisely where the second can force a violation of the first. As written, this consequence is **untestable** — you can always construct two Jobs whose results cannot both land unmodified.

**What the PRD needs (a product decision, not a design):** define the *conflict experience* in product terms. Candidate bars, in increasing ambition: (a) sequential landing — a Lane's result waits its turn, and a conflicting result comes back to the Character as a plain-language "SpongeBob and Squidward both changed the menu page — who's right?" question in the Work Window (this reuses FR-10's ask machinery and keeps the absolute honest by converting a merge into a conversation); (b) the Lane's Claude resolves conflicts itself and *says so* in the chat; (c) true silent auto-merge, which I'd flag as oversold. Pick one and write its testable consequence. Until then, Open Question 4 is not an open question — it's an unwritten requirement blocking architecture.

---

## High

### H-1. "One shared Project" is undefined at the only level that matters: is it a git repository, and who makes it one? (§3 Glossary "Project", §4.6 FR-13, addendum "Agreed technical foundation")

The entire isolation story (per-Lane worktrees, per the addendum and REQUIREMENTS.md) presupposes the Project folder is a git repo with committed content. The PRD defines Project as "the one shared folder of real work" — and the one user is explicitly non-technical, so the realistic default is a plain folder, possibly with binaries, no `.gitignore`, and no repo. The PRD is silent on: who runs `git init` (the app, invisibly? that's a product behaviour — a hidden `.git`, commits authored on Maksym's behalf, his files now under version control without his knowledge); what happens on first launch against a non-repo folder; and the untracked-files gotcha the addendum itself surfaced from Conductor — worktrees don't carry untracked files, so a Lane may start work *missing files Maksym can see in his folder*, which reads as data loss to him. There should be an FR for "adopting a Project folder" with testable consequences (including the not-a-repo, dirty-working-tree, and untracked-file cases). Right now the Glossary's most load-bearing noun has no acceptance criteria at all.

### H-2. FR-4's restart guarantee has no persistence or lifecycle requirement behind it — and the fate of a COOKING Job across restart is unspecified. (§4.2 FR-4, §2.2 UJ-1, §4.5 FR-9)

FR-4's consequence — "After a restart, a Character that was Waiting is still Waiting with its dot" — silently requires a durable state store (Jobs, statuses, unseen flags, session-id↔Character mapping). No NFR states this. Worse, FR-4 only covers *Waiting* across restart; the harder case is **Working**. UJ-1 promises "he closes the window and goes about his day — the job keeps cooking," and FR-9 says closing the *Work Window* never stops the Job — but the Lane's Claude session is a child process of the app. Quit the app (or macOS restarts, or it crashes) mid-Job and the Job dies. The PRD must say what the product truth is then: does a COOKING Job resume automatically on relaunch (SDK `resume` makes this plausible — but "resume" re-prompts, it doesn't rewind a half-done task), or does the Character go Waiting with an honest "I stopped partway — want me to continue?" Either is a fine product; the PRD choosing neither means the first crash produces behaviour nobody signed off on, in the exact spot SM-2 says failure is unacceptable. Add an NFR: *all Town state survives app quit and crash; in-flight Jobs have a defined, honest recovery experience.*

### H-3. The per-cwd session-resume gotcha collides with FR-11 and FR-13's worktree lifecycle — the PRD's two conversation guarantees fight each other. (§4.5 FR-11, §4.6 FR-13, addendum "Sessions" note)

The addendum correctly notes SDK sessions are stored per-`cwd` and resuming from a different cwd silently starts fresh — so FR-11 (follow-ups continue the same conversation) requires each Lane's worktree path to be *stable*. But FR-13 requires finished work to land back in the Project, and the natural worktree lifecycle after landing is teardown or reset. Keep the worktree forever and follow-ups run against a checkout that has diverged from the Project (Maksym says "make the title bigger" and the Character edits a stale copy, or worse, re-lands old changes); recreate it and the conversation silently resets, violating FR-11's testable consequence with no visible error. The PRD needs to bound FR-11 in product terms: does conversational memory survive *landing*? Forever, per-Job, or until the next Job is handed out? My read is the honest bar is "follow-ups work until the Character takes a new Job," with the landing step keeping the worktree synced — but that's a product call about what "the same conversation" means to Maksym, and it must be written down before architecture picks a worktree lifecycle.

### H-4. The three-State model has no home for "something went wrong," and the status vocabulary has no FAILED — yet errors are a daily certainty. (§3 Glossary "State", §4.2 FR-3, §4.4 FR-8, §9 Cost, SM-2)

Idle / Working / Waiting covers the happy path. It does not cover: the SDK erroring mid-Job, the network dropping, or — most predictably — Maksym's Claude plan hitting its usage window mid-afternoon with three Lanes burning tokens in parallel (§9 waves at this with an [ASSUMPTION] that the plan "suffices"; parallel lanes make that assumption optimistic, and when it's wrong there is no State to express it). Presumably a failed Job maps to Waiting-with-a-sad-message, which may be exactly right — the Character *does* need you. But then FR-4 says opening the window clears the dot and the Character "returns to Idle (job served) or shows the permission question" — a third branch (job *failed*, or permission *seen but unanswered*) leaves the Character in an undefined State: dot cleared, Lane still blocked, street signal now lying. The glance-and-ear contract (§2.1) breaks precisely when trust matters most. Also FR-8's status list (WAITING/COOKING/SERVED) needs the unhappy terminal status, in diner vocabulary if you like ("86'D"). One paragraph fixes this: define the error experience as product.

---

## Medium

### M-1. First-run reality on macOS is unspecified: authentication, notification permission, and folder access are all "tech tool" moments the PRD pretends don't exist. (§2, §4.3 FR-6, §9 Platform)

Three unavoidable gates stand between a fresh Mac and UJ-1: (1) **Claude auth** — the Agent SDK rides on Claude Code credentials; if Maksym's machine isn't already logged in, someone runs a terminal/browser auth flow, which is the one thing this product swears off. If the standing assumption is "his machine is already set up," write that as a stated environmental precondition. (2) **Notification permission** — FR-6's consequences are untestable until macOS's own permission prompt is granted; a denied/undecided permission silently guts SM-2, and the app should detect and cozy-splain it. (3) **Folder access** — macOS TCC will prompt (or block) access to Desktop/Documents/iCloud paths where a non-technical user's Project folder will absolutely live. None of these need design now; all three need a sentence in §9 and an FR-level consequence for the degraded states, because "the app can't speak" is a failure of the product's core promise, not an environment nit.

### M-2. FR-10's testable consequences are asserted before the Safe/Risky boundary exists, and "Safe Actions never ask" quietly encodes a permissions posture. (§4.5 FR-10, §10 Open Q3)

"Safe Actions (everyday reading/editing inside the Project) produce no interruptions at all" is a testable consequence of a boundary the PRD explicitly hasn't drawn (Open Q3). Two issues. First, formally: an FR whose acceptance test depends on an open question isn't testable yet — the PRD should say the consequence *binds once OQ3 closes*. Second, substantively: making edits-inside-the-Project silent means auto-approving file writes and, presumably, a good deal of bash — that's a security/blast-radius decision wearing a UX costume. Hobby stakes make the risk acceptable; they don't make it free — the worktree is the blast wall, which circles back to H-1 (no repo, no worktree, no wall). And the boundary's other edge is untouched: network access, package installs, anything *outside* the Project. Fine to settle in architecture, but the PRD should at least state the principle (e.g., "nothing leaves or changes the machine outside the Project without an ask") so architecture has a bar to design to.

### M-3. Every plain-language line in the product is generated by something, and the PRD never says by what — with visible failure modes when it's Claude. (§4.3 FR-6, §4.5 FR-9)

FR-6's notification summary is assumed to be "produced by the Lane's Claude session as part of finishing" — reasonable, but a Job that errors, is interrupted, or hits usage limits finishes *without* a summary; the notification path for those cases is unspecified (ties to H-4). FR-9's folded technical detail sits "behind a plain-language line" — is that line Claude-authored per fold (extra tokens, latency, and it can be wrong) or app-synthesized from tool names ("Edited menu.html" — which is exactly the technical residue the fold is meant to hide)? The testable consequence can't be tested without knowing which, and the two options have different cost and honesty profiles. Cheap fix: state the authorship rule and the fallback text for each.

### M-4. FR-2's "config-plus-files affair Maksym can do with guided help" oversells drop-in Characters to a non-technical user. (§4.1 FR-2, §11)

"An entry in the Character list" is a file edit. For the stated user, editing a config file — key names, a position in some coordinate system, matching filenames to slots — *is* a code change in every way that matters to him. Either the bar is "Claude/the developer does it with him" (then say so and drop the implication of self-service), or v1.x needs a tiny in-app "new neighbour" flow (out of MVP, fine — but then FR-2's consequence should be tested by a developer persona, not by Maksym). Also underspecified: what "a position" means against a fixed-size background picture with finite street frontage — the consequence "without changes to any other feature" is only true until the street runs out of room, which the wider-background item in §6.2 already hints at.

### M-5. Cost and usage limits: the [ASSUMPTION] that the existing plan suffices is the single most likely assumption to be false, and no product behaviour exists for when it is. (§9 Cost, §4.6 FR-12)

Three parallel Lanes multiply burn against Claude's rolling usage windows; a heavy morning can stall the whole town by lunch. No metering UI is the right MVP cut — but "no metering" and "no defined behaviour when limits hit" are different cuts. The minimum product requirement: a limit-stall is surfaced honestly (per H-4's error state) and Mr. Krabs declines new Jobs with a plain reason, rather than lanes silently freezing mid-COOK. One testable consequence under FR-12 covers it.

---

## Low

### L-1. Vocabulary collision: WAITING (Job status: not yet started) vs. Waiting (Character State: finished/needs-you) mean nearly opposite things. (§3 Glossary, §4.4 FR-8, addendum design notes)

The glossary orders downstream docs to use terms verbatim; these two will be confused in every story that touches both. The addendum already doubts WAITING-the-status ever appears (jobs go straight to COOKING per FR-12's consequence). Cheapest fix: rename or delete the Job status — a status that may never render and shadows a core State earns neither its red ink nor its glossary slot.

### L-2. FR-14's test is ambiguous: "relaunching (or a refresh action)" — pick one. (§4.7 FR-14)

An acceptance test with an "or" in it is two tests, and downstream will implement the cheaper one. If live refresh is wanted (it's the nicer experience for an asset-swapping owner), say so; if relaunch is acceptable, say that. One word either way.

### L-3. FR-5's stagger has no policy bounds. (§4.3 FR-5)

"Staggered, never overlapping" is testable; unbounded queueing isn't a policy. Three Lanes finishing together = how many seconds of voice queue, and does a stale line still play after Maksym has already opened the window? A sentence ("queue, max N, drop lines for already-seen Characters") saves a bikeshed later.

### L-4. SM-2 is stated as a metric but is unmeasurable as written. (§7 SM-2)

"Zero missed finished Jobs... without Maksym having chosen to ignore it" has no observation mechanism and an unfalsifiable escape clause. For hobby stakes I wouldn't add telemetry; I'd just relabel it a design principle (it already is one — FR-4 encodes it) rather than a metric, so nobody downstream tries to instrument it.

---

## Summary of counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 4 |
| Medium | 5 |
| Low | 4 |
| **Total** | **14** |

## Closing note

None of this is a rewrite. C-1, H-1, H-2, H-3, and H-4 are each a paragraph of product decision — conflict experience, project adoption, crash/restart truth, conversation-lifetime bound, error state — and every one of them is cheaper to decide now than to reverse-engineer out of an architecture that guessed. The bones are good; the absolutes just need their failure modes named. That *is* the cozy promise, properly kept: the town never lies to Maksym, including about itself.
