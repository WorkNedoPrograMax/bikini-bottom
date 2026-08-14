# Architect Review — Bikini Bottom UX Spine (Buildability)

**Reviewer:** Winston (System Architect)
**Date:** 2026-07-12
**Inputs reviewed:** `DESIGN.md`, `EXPERIENCE.md`, `.working/mock-{firstrun,handout,sendback,burned}.html`, PRD `prd.md` + `addendum.md` (Agent SDK notes), my own PRD review for continuity.
**Question asked:** can architecture and stories implement this spec without hitting contradictions?

**Stance.** This spine is better than most: the component table gives behavioral rules, not vibes; the sound matrix is a real matrix; the ASSUMPTION tags are honest. My PRD review asked for failure modes to be named — several were (quit/relaunch is now a defined flow, the conversation-lifetime bound exists, the M-key/field conflict is handled). What remains is a different class of problem: the spine makes **event-level promises** ("dot clears when the result is seen", "work stops within seconds", "silently prepares the folder") whose *resolving events* are either undefined, defined two contradictory ways, or defined in a way the underlying machinery (Agent SDK, git, macOS) does not offer. Those are exactly the gaps a story developer fills by inventing — and inventions at the resolve-to-clear seam are inventions in the product's core trust guarantee. As before: I critique, I don't design.

---

## Critical

### C-1. Resolve-to-clear has no consistent event model — the spine and its own mock define "seen" differently, and the burned case leaves a Character/board state that is flatly undefined. (EXPERIENCE §State Patterns "Unseen Dot resolve-to-clear"; §UJ-2 step 4; `.working/mock-sendback.html`; §State Patterns "Orders Board statuses")

The whole product hangs on FR-4, and the spine gives it three different resolving events without noticing:

1. **The spine text** says a finished result is resolved when "the resolving content was actually displayed" (scrolled into view) — a passive, render-tracking definition.
2. **The sendback mock** resolves it *actively*: an explicit **"👍 Looks good"** button, whose click "marks as seen" and clears the dot. That button appears nowhere in EXPERIENCE.md's component table — it's a whole affordance the mock has and the spec doesn't.
3. **The burned case** says "a choice made, *or* the burned explanation scrolled into view" — two resolving events for one need, with wildly different consequences.

Pick (3)'s scroll branch and follow it: the explanation scrolls into view → need resolved → per the spine, "on resolve, the Character returns to Idle." But the order is still BURNED (only Try again / Scrap it move it, per the same document's Try again/Scrap it rule), the board retires only "SERVED and scrapped" lines, and one-Job-per-Character means it's undefined whether this Idle Character with a live BURNED order can even take a new Job from Mr. Krabs. That's not underspecification; it's a contradiction — an Idle Character chained to an unresolved order the state model says can't exist.

Underneath all three variants sits an unnamed entity: the **need** itself. Resolve-to-clear requires a durable per-need record (what kind of need, which message anchors it, what event resolves it, persisted across restart per FR-4's "survives app restart"). Nothing in the spine names it, so every story that touches a dot will invent its own version. And scroll-into-view as a resolving event is the expensive choice besides — intersection observers, per-bubble anchors, "displayed for how long?", reduced-window edge cases — for a benefit the mock itself abandons in favor of a button.

**What the spine needs:** one sentence per need-type naming the exact resolving event (my read of the mock: finished = an explicit acknowledgment — Looks good / Send it back; ask = Allow or Deny clicked; burned = Try again or Scrap it clicked; drop scroll-into-view entirely), plus one sentence on what a resolved-but-not-retired BURNED order means for the Character's availability. Until then FR-4's "testable consequences" cannot be tested against this spec.

### C-2. The landing-collision ask — the hardest interaction in the product — has no UX definition at all. (EXPERIENCE §Key Flows — absent; §Component Patterns — absent; PRD FR-16)

PRD FR-16 is explicit: "If landing work collides with something another Character changed, the Character pauses instead of landing silently: it goes Calling and asks in plain language which version should win." My PRD review called this the critical product decision (C-1 there); the PRD kept it as a requirement. The UX spine — the document whose job is to define every ask a Character can make — covers Allow/Deny, Try again/Scrap it, Send it back, Send-it-back *entanglement*… and skips the landing collision entirely. No flow, no component row, no copy, no board status while the landing is paused (WAITING? a sixth state?), no statement of what happens to the losing side's work, no answer to whether the *other* Character (whose served work is the collision partner) is implicated in the conversation.

Send-it-back entanglement at least gets a row and an honest deferral to Open Question 4. The landing collision gets nothing, and it is the more frequent case — it happens on the happy path whenever two lanes' honest work touches the same file, no undo required. A story developer reaching FR-16 will have to invent the interaction Maksym's trust most depends on. This is a hole, not an ambiguity: add the flow (it can reuse the either/or bubble pattern the entanglement row already establishes) or explicitly defer it with the same [ASSUMPTION]/Open-Question rigor the rest of the document practices.

---

## High

### H-1. "Folded technical detail" has no mapping onto the actual SDK message stream — nobody has said what a bubble is, what folds, or who writes the plain line. (EXPERIENCE §Component Patterns "Folded technical detail"; DESIGN §Components "Folded technical detail"; addendum SDK notes)

The real stream is assistant messages containing text and `tool_use` blocks, interleaved `tool_result` messages, thinking blocks, and a per-turn result message. The spine says "raw output (paths, commands, code) folds behind one plain line **per bubble**" — which presumes a bubble model it never defines. Unanswered, and all load-bearing for FR-11's "progress is visible as it happens":

- **What is a bubble?** One assistant message? One turn? A turn with twelve tool calls — twelve folds, one fold, or one bubble with a growing fold?
- **What exactly folds?** Tool calls and results, clearly. But Claude's *prose* routinely contains backticked paths and code fences — is assistant text content-classified and partially folded (expensive, fragile), or shown raw (violating the no-jargon voice), or does a system prompt instruct the Lane to keep prose plain (cheap, but then say so — it's a spec-level rule)?
- **Who authors the plain line?** My PRD review raised this (M-3); it is still unanswered. Claude-authored per fold costs tokens/latency and can be wrong; app-synthesized from tool names ("Edited menu.html") is exactly the technical residue the fold exists to hide.
- **The tool-only stretch:** Claude often works for a minute emitting nothing but tool calls. If all of that folds, an open Work Window on a Working Character shows… nothing moving. That contradicts "a running Job's progress is visible as it happens" (FR-11), and no spinner/progress bar is allowed to paper over it (DESIGN's own Don't).

One paragraph fixes this: a bubble = X; folds contain Y; the plain line is authored by Z with fallback text W; during tool-only stretches the window shows V. Without it, this component will be reinvented per story.

### H-2. Cancel: the stop is buildable, but the spine is silent about everything cancel leaves behind. (EXPERIENCE §Component Patterns "Cancel an order"; §Key Flows Cancel flow; addendum "streaming-input mode")

"Work stops within seconds" is achievable — SDK `interrupt()` exists, and the addendum correctly notes it requires streaming-input sessions, so no contradiction there (architecture just must not use string prompts, ever). The gaps are after the stop:

- **The worktree.** Cancel leaves half-done changes sitting in the Lane's worktree. The spine promises "nothin' from it will land in the Project" — good — but doesn't say whether the leavings are discarded or kept. This matters because…
- **The conversation.** FR-13 says a Character's conversation persists until a *new* Job. Does it survive a cancel? If yes, a follow-up message resumes a session whose cwd contains (or mysteriously lost) half-done work — either way the Character's memory and its files disagree. If no, say so: "cancel ends the conversation" is one sentence.
- **Cancel while WAITING.** A Job paused on a permission ask is blocked inside a pending `canUseTool` promise, not a running stream. Cancelling means resolving/rejecting that promise, and the ask bubble with its live Allow/Deny buttons is still in the chat — do they disable? The spine covers the answered-ask history rule but not the cancelled-ask one.
- **Interrupt granularity, honestly stated.** `interrupt()` stops at message boundaries; an in-flight bash command may run to completion first. "Within seconds" is the right promise; "instantly" would not be. Keep the copy ("Scrap this order? Nothin' from it will land") pointed at the *landing* guarantee, not a stopped-mid-keystroke guarantee — the current copy is fine; a story note should pin it.

### H-3. First Run's "silently prepares the folder" asserts silence over machinery with known, named failure modes. (EXPERIENCE §Key Flows First Run steps 2–3; PRD FR-17/FR-19; addendum Conductor gotcha; my PRD review H-1)

The addendum itself records that worktrees don't carry untracked files (Conductor hit this) and the isolation hypothesis is git worktrees — which presuppose a repo with commits. The spine's entire treatment is Krabs saying "you won't have to touch a thing." Undefined, and every one of these is a first-launch scenario for this specific user:

- **Plain folder (the stated default!):** the app runs `git init` and makes an initial commit of Maksym's files under an app-authored identity. That is a product behavior — invisible version control imposed on his folder — and the spine should own it in one Krabs sentence, plus define what happens when it *fails* (folder is read-only, is inside another repo, is an iCloud-synced path that TCC blocks mid-flow — the picker succeeding does not guarantee the preparation succeeds).
- **Existing repo, dirty tree, or heavyweight contents** (node_modules with no .gitignore — who authors one?): worktree creation semantics differ per case; the *experience* when preparation stalls or errors needs a defined Krabs line, not an invented one.
- **The untracked-files gotcha as UX:** a Lane starting work in a worktree missing files Maksym can see in Finder reads as data loss to him. The spine should at least assert the bar ("a Lane always sees everything in the Project folder") so architecture designs to it.
- **Abandoned first run:** quit between step 2 and step 6 — next launch resumes where? The mock's Back/Next stepper implies resumable steps; the spine doesn't say.

None of this needs design here. It needs the failure-mode *experience* named, per the spine's own "never hide that something failed" rule — which First Run, as written, violates by construction.

### H-4. Send it back: the button's lifetime is unspecified, and the spine's surfaces can't honor the PRD's durability promise. (EXPERIENCE §Component Patterns "Send it back"; §Key Flows Send-it-back flow; PRD §9 Reliability, FR-13)

The button sits "directly under a served order's result summary." For how long, and through what?

- **Through a follow-up?** FR-13 flips the same Job back to COOKING and produces a *second* result summary. Two Send-it-back buttons now exist in one conversation — does the older one still work, and does it revert the follow-up too?
- **Through a new Job?** A new Job starts a fresh conversation — the old conversation, and the button in it, leave the Work Window. But PRD §9 lists "each order's Send-it-back ability" among state that survives, and the board keeps ~10 retired lines whose click target is the Character's *current* Work Window. Net: the spine provides no surface from which an order older than the current conversation can be sent back. Either Send it back is scoped to "the latest served order per Character, until the next Job" — a perfectly good v1 answer that should be written down — or the board's retired lines need a path to it that doesn't exist in this spec.
- The entanglement options are deferred to architecture (fine, tagged) — but the *availability window* above is pure UX and can't be deferred; a story developer must know when the button dies.

---

## Medium

### M-1. The sound stagger contradicts itself: "0.55s apart" and "never overlapping" cannot both be true for catchphrase-length clips. (EXPERIENCE §State Patterns, Sound & notification matrix; PRD §3 "Voice Line")

Voice Lines are "Warcraft-peon-style" catchphrases — realistically 1–3 seconds. Two starts staggered 0.55s apart overlap for most of their duration. The intended rule is presumably *end-of-clip + gap* (queue, not offset) — say which, because they're different implementations. And my PRD-review L-3 remains unanswered here: three Lanes calling together — how deep does the queue go, and does a queued line still play for a Character whose need Maksym already resolved while it waited? One sentence ("serial queue, 0.55s gap after each clip ends, drop queued lines whose need is already resolved") settles it.

### M-2. Notification click-through needs its edge cases defined, not just its happy path. (EXPERIENCE §Interaction Primitives "Notification click-through"; §Foundation "one overlay at a time"; DESIGN §Components "Notification content")

Buildable — each notification carries a Character payload; click raises the app and opens that Work Window (and pause-on-quit conveniently means notifications only exist while the app runs, so the cold-launch-via-notification case never arises — worth one sentence stating that). Undefined: clicking a *stale* notification whose need was already resolved (open the window anyway? Notification Center keeps them around); clicking while another Work Window or the Orders Board is open (the one-overlay rule implies swap — say it); clicking during First Run (can't happen only if no Lane can run before First Run completes — assert that ordering). Cheap sentences, but each is currently a story-time invention.

### M-3. WAITING-as-"handed out" still has no moment to exist, and the spine's instant street flip papers over a real spin-up delay. (EXPERIENCE §State Patterns "Orders Board statuses"; §UJ-1 step 5; PRD FR-3; addendum design notes)

UJ-1 has the board showing COOKING immediately on handout; the status table says WAITING covers "handed out." Both can't be the default. Meanwhile the real handout path — create worktree, start SDK session, first prompt — can take seconds on a big repo, and UJ-1's climax has Patrick's picture flip "through the closing window." Fine, if the flip is deliberately optimistic (street leads the machinery); the addendum already suspected jobs go straight to COOKING. Pick: either delete handed-out-WAITING (keeping WAITING solely for paused-on-OK, which is its only load-bearing use), or define WAITING as the spin-up status. My PRD-review L-1 flagged this vocabulary collision; it survived into the spine intact.

### M-4. "Quitting mid-COOKING pauses the Job" promises a pause the SDK doesn't have — the recovery flow is right, the verb is oversold. (EXPERIENCE §State Patterns "App quit / relaunch"; addendum "Sessions" per-cwd gotcha)

Quit kills the process; there is no pause. "Keep cooking" is `resume: session_id` with a continuation prompt — from the *same worktree cwd*, or the per-cwd session store silently starts a fresh conversation (the addendum's own gotcha; worktree paths must therefore survive relaunch, which constrains any tidy-up-on-quit instinct). Resume replays the conversation; it does not resurrect a half-executed action, so "pick this back up" may re-do or partially-redo work — acceptable at hobby stakes, but the Krabs-tone copy should stay honest about "I'll pick up where I left off, more or less." Also: the spine defines this flow only for *quitting*; the PRD's reliability NFR includes crash and sleep. Presumably the same relaunch flow covers a crash — one word ("quit or crash") closes it.

### M-5. Denied notification permission has no degraded state — and the mock quietly makes permission mandatory. (EXPERIENCE §Key Flows First Run step 4; `.working/mock-firstrun.html`; PRD FR-7, SM-2)

The spine has Krabs ask nicely; the mock disables "Open the town!" until Allow is clicked — an OS permission as a gate, which macOS doesn't even guarantee (the system dialog can be denied, or the request auto-denied if previously refused). Neither artifact says what the town does when permission is denied: SM-2's "nothing missable in the background" silently loses its background channel. Needed: the mock's gate removed or justified, and one defined behavior for the denied state (e.g., Krabs notes it once, Voice Lines + dots carry the load, and a re-ask path exists in the mute-button's corner of the world). My PRD-review M-1 raised this; the spine's step 4 cites review L-4 but doesn't answer it.

---

## Low

### L-1. The mute control's volume slider is reachable only by "long-hover/secondary" — which the same document bans. (EXPERIENCE §Component Patterns "Mute / volume" vs §Interaction Primitives "Banned")

"Banned: right-click-only actions… hover-only information." The slider is a control, not information, and there are two routes — but both routes are from the banned family, and neither is a plain click. Cheapest fix: click toggles a small popover containing both mute and the slider.

### L-2. The Home Base picker's spine and mock disagree on the input bar, and the zero-idle-crew case is undefined. (EXPERIENCE §Component Patterns "Character picker"; §UJ-1 failure case; `.working/mock-handout.html`)

The spine's failure case ("sending with no Character picked → Krabs asks") implies the input is live before a pick; the mock hides the input until a pick is made (which makes that failure unreachable). Pick one. And when *every* Character is busy, the picker is a row of gray — Krabs should have a line for it ("Me whole crew's cookin' — check the board"), or handing-out is a dead end that reads as broken.

### L-3. "The app icon is an Asset Slot" doesn't survive contact with macOS notifications. (DESIGN §Components "Notification content")

Notification banners show the *bundle* icon; runtime dock-icon swaps (Electron's `app.dock.setIcon`) don't change it. Honoring this slot means writing the asset into the app bundle and re-registering — disproportionate. Scope the slot to the dock icon, or drop the claim.

### L-4. The handout "acknowledgment tick" is a bundled sound in a product whose rule is every-sound-is-Maksym's-file. (EXPERIENCE §Sound matrix row 1 [ASSUMPTION]; DESIGN §Do's and Don'ts)

Either the tick gets an Asset Slot with a labelled stand-in like everything else, or it's dropped (the street flip is already the acknowledgment). Don't let the first shipped sound be the one that breaks the asset covenant.

### L-5. First Run mock and spine disagree on step count and introduce unspecced chrome. (EXPERIENCE §Key Flows First Run; `.working/mock-firstrun.html`; DESIGN §Components)

The spine has five beats including the assets offer; the mock has three steps and omits assets entirely. The mock's Back/Next stepper bar and step-dots exist in no DESIGN component. Reconcile before a story developer treats the mock as binding — the spine says the *bikini-town* mockup is binding; the status of these scene mocks should be stated in one line.

### L-6. Deny's aftermath is inferable but unstated. (EXPERIENCE §Component Patterns "Allow / Deny"; §State Patterns resolve-to-clear)

"Deny keeps the conversation going — the Character explains and adjusts": presumably the answer resolves the need (dot clears), the Character returns to Working, and the board goes WAITING→COOKING. All consistent with the resolve rule — but "presumably" is the word this review exists to delete. One clause: "Deny resolves the need; the Character resumes Working."

---

## Summary of counts

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 4 |
| Medium | 5 |
| Low | 6 |
| **Total** | **17** |

## Closing note

The spine's shape is right and most of the PRD-review debts were paid. The two criticals are the same lesson at two scales: **name the resolving event**. C-1 because the document names it three contradictory ways; C-2 because it doesn't name it at all. Both are paragraphs, not redesigns — and both sit directly on the "nothing is ever missable, nothing ever lies" promise, which is the one place this product cannot afford story-time invention. Fix those two, spend an afternoon on the four highs, and this pair is buildable with boring technology and no heroics — which is the highest compliment I give a spec.
