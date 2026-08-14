---
title: Bikini Bottom UX Spine — UX Review (Sally)
reviewer: Sally, UX Designer
date: 2026-07-12
scope: DESIGN.md + EXPERIENCE.md (this folder) and the four scene mocks in .working/
verdict: The spines are the film I asked for — but two of the four new mocks quietly rewrite the trust rules the spines got right. Reconcile before anything is built.
---

# UX Review: the Bikini Bottom spine pair

Roll the previous reel first: my PRD review asked for an opening scene (First Run), an honest dot (resolve-to-clear), a failure beat (BURNED), and quiet controls. The spines delivered all four — and more: the M-key typing guard, the 🎭 exclusion, reduced-motion with the dot kept visible, empty-board copy, board retention, the staggered voice matrix. That's every Critical, every High, and nearly every Medium/Low from my list, addressed *by name*. This is what "reviews got incorporated" is supposed to look like.

So the spine pair passes as a script. The trouble is the dailies. The four new mocks in `.working/` were shot from the same script, and in two scenes the actors improvised new rules — at exactly the two moments where trust is the whole point: the send-back undo and the first-run permission ask. A literal-minded implementer now has two truths in both places. Also, the mocks revealed states the spines never wrote coverage for — the boring connective tissue (quit mid-walkthrough, a scrapped line's status word) where coziness actually lives or dies.

I am not redesigning the locked look. Every finding cites a spine section or a mock file.

---

## Critical

### C-1. "Looks good" kills "Send it back" — the undo promise breaks on screen (mock-sendback.html vs EXPERIENCE §State Patterns FR-4, §UJ-2, §Send-it-back flow; PRD FR-16)
Play the mock: SpongeBob serves the renamed pages, two buttons appear — **👍 Looks good** and **↩️ Send it back**. Click Looks good and the script's `seen()` disables *both* buttons. The order is now irreversible, in the very scene whose caption promises "the project returns to exactly how it was." EXPERIENCE's UJ-2 climax is "seen, landed, **undoable**, all in one glance," and PRD FR-16 says *every* served order carries the undo. The mock revokes it the moment Maksym is polite. And there's a second contradiction hiding in the same click: the spine's resolve rule (FR-4, my old C-1 fix) says a finished result resolves when it is *seen* — "the resolving content was actually displayed." The mock instead demands an explicit acknowledgment click before the dot clears, and the whole "Looks good" affordance exists in no spine section at all. So the pair's most important trust rule now has two versions: spine says *reading resolves*, mock says *clicking resolves and clicking also destroys the undo*. Pick one (I'd keep the spine's reading rule, and if "Looks good" survives, it must never disable Send it back) — but the artifacts must say the same thing.

### C-2. First Run holds the town hostage for a notification permission (mock-firstrun.html vs EXPERIENCE §First Run flow steps 2–4)
In the mock, **"Open the town!" is disabled until "Allow notifications" is clicked.** There is no "not now," no path for macOS itself saying no (the system dialog can be denied regardless of what our wooden button says). A cozy welcome that won't open the door until you agree to be contacted is a dark pattern wearing a Krabs costume — and if the OS denies, it's a literal trap: the walkthrough can never finish. The spine has the softer half of the same bug: step 4 offers only "Sounds good" with no decline beat. Meanwhile the mock's **Next →** happily skips step 2 without a folder picked, so the one *actually mandatory* input (the Project — nothing works without it) is optional, while the one *genuinely optional* input (notifications) is mandatory. That's the gating exactly inverted. Required: folder gates completion; notifications get a "maybe later" that still opens the town; a denied-permission end-state exists in both artifacts (see also M-6).

---

## High

### H-1. Nobody wrote the scene where Maksym walks out mid-welcome (EXPERIENCE §First Run flow, §Interaction Primitives; mock-firstrun.html)
The prompt-card questions the spine never answers: he picks his folder, then quits before the notification beat — on relaunch, does First Run resume at step 4, restart from "Ahoy," or (worst) never return, leaving a town with a half-configured Project? Is the folder already persisted? Can **Esc** — which the spine globally defines as "close the topmost overlay" — dismiss the First Run window into a dimmed, Project-less street? If so, what does clicking the Krusty Krab do then? The spine says the Town sits dimmed behind Krabs' window (step 1) but never says whether the dimmed street is inert or clickable, or what the actors show before any Project exists. First Run is one scene, but interruption makes it four; only the happy path is scripted.

### H-2. Retired orders have no status word — and the mock invented one (EXPERIENCE §State Patterns FR-10, §Cancel flow, §UJ-4; mock-sendback.html; DESIGN §Colors board statuses)
The board's painted vocabulary is WAITING / COOKING / SERVED / BURNED, full stop. But the spine says scrapped lines "stay visible" in history, the cancel flow says "the board line retires," and send-back leaves… what? mock-sendback answers with a status the design system doesn't own: "the board shows this order as *taken back*." So we have at least three end-states — scrapped, cancelled, sent-back — with zero specced ink. DESIGN even keeps {colors.harbor-blue} "as a token but unassigned," which smells like this exact hole waiting for paint. Decide the words and the color (one shared "retired" word is fine; the diner metaphor offers plenty) and put them in both spines, or the board will grow ad-hoc statuses in code.

### H-3. The First Run mock dropped the assets beat and added wizard furniture (mock-firstrun.html vs EXPERIENCE §First Run flow step 5)
The spine's step 5 — "Got pictures and voices for the crew?" with **Show me where pictures go / Later** — was the fix for my M-6 (asset discoverability for a non-technical user). The mock has three steps and this isn't one of them; if the mock is the beat sheet the implementer follows, the fix silently un-ships and Maksym never learns where his pictures live. In its place the mock added **← Back / Next →** buttons and a "● ○ ○" progress indicator — settings-wizard furniture in the one scene the PRD swore is "a scene, not a settings form," and chrome no spine section specs. The spine's version (Krabs talks, each answer advances the conversation) needs no Next button at all. Restore the beat; decide the nav's fate explicitly.

---

## Medium

### M-1. A fresh order is WAITING in one paragraph and COOKING in the next (EXPERIENCE §State Patterns FR-10 vs §UJ-1 step 5; mock-handout.html)
The spine's own lifecycle line reads "WAITING (handed out or paused for Maksym's OK) → COOKING." But UJ-1's climax says the freshly handed-out order is already COOKING, and mock-handout's confirmation note agrees ("status: COOKING"). Either a handed-out order visibly passes through WAITING (then say for how long and what flips it) or it's born COOKING (then WAITING means only "paused for OK" and the lifecycle line should say so). My old H-2 was about WAITING meaning two things; this is its junior cousin, inside one document.

### M-2. DESIGN paints affirmative buttons in character accents; all four mocks paint everything wood (DESIGN §Components in-chat action buttons; mock-handout / mock-burned / mock-sendback / mock-firstrun)
DESIGN is explicit: Allow / Try again fill with the Character's accent, Deny / Scrap it with plain wood, and the input bar's Go button is a per-accent action button. The mocks render every single button — Try again, Send it back, Hand it out!, all of it — as the same wooden plank. Two truths again. Wood-everywhere is honestly calm and I could be argued into it, but then DESIGN must change; as written, the mocks violate the spec they're meant to demonstrate. One decision, applied to both.

### M-3. One state, three vocabularies (mock-handout.html chips vs EXPERIENCE §Component Patterns character picker vs street labels)
The street label says "working…". The spine's picker spec says busy chips show "working…" / "calling". The mock's chips say "cooking…" and "calling you". A Working SpongeBob is thus "working…" on the street and "cooking…" in the picker, ten feet apart. The glossary discipline this project is rightly proud of (§3 "verbatim") should extend to state words: pick one set, use it everywhere.

### M-4. UJ-1's failure beat can't happen in the mock's staging (EXPERIENCE §UJ-1 failure vs mock-handout.html)
The spine scripts a graceful failure: "sending with no Character picked → Krabs asks, 'Which of me crew is this for?'" But the mock hides the input bar entirely until a character is picked — the failure is unreachable. That's arguably better UX (prevention over recovery), but then the spine's failure beat is dead copy; and if the spine's always-visible input is the truth, the mock is understating a state. Say which staging is real.

### M-5. Relaunch resume is a fourth kind of Calling the sound matrix never scored (EXPERIENCE §App quit/relaunch vs §Sound & notification matrix)
On relaunch, every paused Character comes up Calling with "Want me to pick this back up?" The matrix defines Voice Lines and notifications for exactly three Calling causes — finished, needs-OK, BURNED. So does app launch with three paused lanes open on a staggered three-voice chorus plus three notifications before Maksym has clicked anything? A cozy morning should probably open quiet (dots and bubbles, no voices, no notifications — the app is already frontmost). Whatever the answer, the matrix needs the fourth row.

### M-6. The world after "no" to notifications doesn't exist (EXPERIENCE §First Run step 4, §Sound & notification matrix; mock-firstrun.html)
Beyond the C-2 gating problem: nothing anywhere specs the app in a notifications-denied life. The matrix assumes every Calling event fires a notification; FR-7's promise ("arrives even in background") silently fails if permission was denied, and SM-2's "nothing missable" now rests entirely on the dot — fine, but *say it*, and decide whether Krabs ever gently re-offers ("If ye change yer mind, holler — Settings > Notifications" is one line, in-world).

---

## Low

### L-1. Busy-chip reasons are hover-only tooltips — banned by the spine's own primitives (mock-handout.html `title` attributes vs EXPERIENCE §Interaction Primitives)
"SpongeBob is busy cooking" lives in a `title` tooltip — hover-only information, which the spine explicitly bans. The visible state word under the chip already carries it; cut the tooltips or make the chip say why on click (a Krabs bubble), not on hover.

### L-2. The volume slider skirts the same ban (EXPERIENCE §Component Patterns mute/volume)
"Long-hover/secondary shows a small volume slider" — long-hover is hover-only information and secondary-click is right-click-only action; both are on the spine's own banned list one section later. A plain click cycling mute, with the slider inside a small popover on the *same* click, keeps it legal and simpler.

### L-3. The header dot in mock-sendback is lovely and homeless (mock-sendback.html header vs DESIGN §Unseen Dot; EXPERIENCE §State Patterns)
The mock puts a pulsing Unseen Dot on the Work Window's header portrait while the need is unresolved. Nice continuity touch — but DESIGN pins the dot to the street actor only, and no spine sentence brings it indoors. Spec it (with the same resolve rule and reduced-motion behavior) or cut it; unspecced coral is exactly how the "coral = dot only" law erodes.

### L-4. Small copy drift between spine and mocks (EXPERIENCE §UJ-1, §Component Patterns vs mock-handout.html, mock-burned.html)
"Tell Patrick the job…" (spine) vs "Tell Patrick what to do…" (mock); "Scrap it" (spine, burned + cancel) vs "Scrap this order" (mock-burned). Trivial individually, but this project's whole voice depends on verbatim discipline; align them when the bigger findings are settled.

---

## Tally

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 3 |
| Medium | 6 |
| Low | 4 |

## Closing note

The spines are the best downstream artifacts this project has produced — every one of my PRD findings is visibly, correctly landed, and the assumption-tagging habit carried over. The mocks are 80% faithful set-dressing and 20% quiet rewrites, and the 20% sits on the two beats the whole product's trust depends on: the undo that must never disappear, and a front door that must never be conditional on a permission. Both Criticals are one-decision fixes, not redesigns. Reconcile mocks to spines (or spines to mocks, *explicitly*), write the four missing states (first-run interruption, retired status ink, relaunch chorus, notifications-denied), and this is ready for architecture.

— Sally
