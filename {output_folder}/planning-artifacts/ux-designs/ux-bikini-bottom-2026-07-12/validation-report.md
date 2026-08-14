# Bikini Bottom — UX Design Validation Report

- **Validated artifacts:** `{output_folder}/planning-artifacts/ux-designs/ux-bikini-bottom-2026-07-12/DESIGN.md` + `{output_folder}/planning-artifacts/ux-designs/ux-bikini-bottom-2026-07-12/EXPERIENCE.md`
- **Run:** 2026-07-12
- **Category verdicts:** Flow coverage strong · Token completeness strong · Component coverage adequate · State coverage adequate · Visual reference coverage broken · Bloat strong · Inheritance strong · Shape fit strong
- **Reviewer files:** `review-rubric.md` · `review-ux-sally.md` (UX, Sally) · `review-architect-winston.md` (Architect, Winston) · `review-pm-john.md` (PM, John)

> **Note:** Panel findings are being applied — the spines and mocks are being fixed in the same session; this report records what the panel found.

## Synthesis

A builder can work from this pair of documents with high confidence: every design token they mention actually exists, every color carries a real value, the capture of the reference mockup is faithful to a degree rarely seen (positions, timings, corner radii, even the 0.55-second voice stagger all check out), and the names for things match the PRD word-for-word. Two gaps have real downstream cost: the Character picker — the one screen element the PRD explicitly asked UX to design — has rules for how it behaves but no committed picture of how it looks, and all four working scene mocks are orphans that neither document links, including the one that does show the picker. Fix those two, resolve the wooden-vs-accent button contradiction, and this pair is a clean contract for architecture and story development.

The three-person panel sharpened that picture in one important way: the scene mocks are not just unlinked — two of them quietly contradict trust rules Maksym already decided. The send-back mock adds a "Looks good" approval button that turns automatic serving back into the sign-off gate that was explicitly rejected, and kills the undo the product promises on every order. The first-run mock gets its gating exactly backwards — it holds the front door hostage until notifications are allowed, while letting the one genuinely required step (picking the project folder) be skipped. Beyond the mocks, the panel found that the hardest moment in the product — two Characters' work colliding at landing — was never designed at all, and that the product's core "red dot clears when you've seen the result" rule is currently defined three different, conflicting ways across the spine and its own mock. All of these are one-decision fixes, not redesigns, and they are being applied now.

## Severity counts

| Severity | Count |
|---|---|
| Critical | 5 |
| High | 11 |
| Medium | 23 |
| Low | 23 |

---

## Critical

### [Sally C-1] "Looks good" kills "Send it back" — the undo promise breaks on screen
**Where:** `mock-sendback.html` vs EXPERIENCE §State Patterns FR-4, §UJ-2, §Send-it-back flow; PRD FR-16.
Click "Looks good" and the mock disables both buttons — the order becomes irreversible in the very scene whose caption promises "the project returns to exactly how it was." A second contradiction hides in the same click: the spine says a finished result resolves when it is *seen*; the mock demands an explicit acknowledgment click before the dot clears, and the "Looks good" affordance exists in no spine section at all. The pair's most important trust rule now has two versions: spine says reading resolves, mock says clicking resolves and clicking also destroys the undo.
**Fix:** Pick one (Sally's call: keep the spine's reading rule; if "Looks good" survives, it must never disable Send it back) — the artifacts must say the same thing.

### [Sally C-2] First Run holds the town hostage for a notification permission
**Where:** `mock-firstrun.html` vs EXPERIENCE §First Run flow steps 2–4.
"Open the town!" is disabled until "Allow notifications" is clicked — no "not now," no path for macOS itself saying no. A cozy welcome that won't open the door until you agree to be contacted is a dark pattern wearing a Krabs costume — and if the OS denies, the walkthrough can never finish. Meanwhile "Next →" happily skips step 2 without a folder picked: the one actually mandatory input (the Project) is optional while the genuinely optional one (notifications) is mandatory. The gating is exactly inverted.
**Fix:** Folder gates completion; notifications get a "maybe later" that still opens the town; a denied-permission end-state exists in both artifacts.

### [Winston C-1] Resolve-to-clear has no consistent event model — three contradictory definitions of "seen," and the burned case leaves an undefined Character/board state
**Where:** EXPERIENCE §State Patterns "Unseen Dot resolve-to-clear"; §UJ-2 step 4; `mock-sendback.html`.
The spine text says passive render-tracking ("scrolled into view"); the sendback mock resolves actively via a "Looks good" button that exists in no spec; the burned case says "a choice made, or the burned explanation scrolled into view" — two resolving events for one need. Follow the scroll branch: need resolved → Character returns to Idle — but the order is still BURNED, the board retires only SERVED and scrapped lines, and one-Job-per-Character makes an Idle Character with a live BURNED order a state the model says can't exist. Underneath sits an unnamed entity: the need itself, which must be a durable per-need record surviving restart. Scroll-into-view is also the expensive choice for a benefit the mock itself abandons.
**Fix:** One sentence per need-type naming the exact resolving event (finished = explicit acknowledgment; ask = Allow or Deny clicked; burned = Try again or Scrap it clicked; drop scroll-into-view), plus one sentence on what a resolved-but-not-retired BURNED order means for Character availability.

### [Winston C-2] The landing-collision ask — the hardest interaction in the product — has no UX definition at all
**Where:** EXPERIENCE §Key Flows / §Component Patterns (absent); PRD FR-16.
PRD FR-16 requires the Character to pause instead of landing silently, go Calling, and ask in plain language which version should win. The spine covers Allow/Deny, Try again/Scrap it, Send it back, even send-back entanglement — and skips the landing collision entirely. No flow, no component row, no copy, no board status while the landing is paused, no statement of what happens to the losing side's work. It is the more frequent case — it happens on the happy path whenever two lanes' honest work touches the same file. This is a hole, not an ambiguity.
**Fix:** Add the flow (it can reuse the either/or bubble pattern the entanglement row establishes) or explicitly defer it with the same [ASSUMPTION]/Open-Question rigor the rest of the document practices.

### [John C-1] The sendback mock re-introduces the review gate Maksym explicitly rejected
**Where:** `mock-sendback.html`; PRD §3 Glossary "Serving", §6.2, FR-4, UJ-2.
The confession on file: Maksym was offered a look-first gate and said no — auto-land, undo if unhappy. EXPERIENCE.md honors this; the mock clears the dot only when Maksym clicks "Looks good" or "Send it back," with a note that literally says "✓ Marked as seen." That's not seeing; that's approving — the review gate wearing a thumbs-up emoji as a disguise. Every served order now demands a click before the street goes quiet; the town stops being a friend who waves and becomes a coworker who needs sign-off. Mocks are what builders copy.
**Fix:** The result scrolling into view clears the dot (per EXPERIENCE.md); "Send it back" stays as the only button; "Looks good" is deleted or becomes purely a fun optional reply, never a gate.

---

## High

### [Rubric — Component coverage] The Character picker has no visual spec in DESIGN.md
**Where:** DESIGN.md Components (absent); prd.md FR-15 note; `.working/mock-handout.html`.
The PRD explicitly assigns this design to UX. EXPERIENCE.md gives full behavioral rules and mock-handout.html designs it visually (96px chips, #fffaf0 card, 2px #3a2c14 border, radius 14px, grayscale busy, picked outline) — but DESIGN.md Components has no row, so the one component with no mockup precedent is exactly the one with no committed visual contract.
**Fix:** Add a "Crew chip / Character picker" row to DESIGN.md Components, promoting the mock-handout chip treatment to spec.

### [Rubric — Visual reference coverage] All four `.working/` mocks are orphans
**Where:** `.working/mock-{handout,firstrun,burned,sendback}.html`; both spines.
Each illustrates exactly one spine section (Character picker / UJ-1, First Run flow, UJ-4 + BURNED board line, Send-it-back flow), and neither spine links any of them. A consumer reading the contract will never find the only visual definition of the picker, the BURNED status in situ, or the serve/send-back bubble pattern.
**Fix:** Promote them to `mockups/` and add one "→ Composition reference: … Spine wins on conflict." line at each of the four sections.

### [Sally H-1] Nobody wrote the scene where Maksym walks out mid-welcome
**Where:** EXPERIENCE §First Run flow, §Interaction Primitives; `mock-firstrun.html`.
He picks his folder, then quits before the notification beat — on relaunch does First Run resume, restart, or never return, leaving a town with a half-configured Project? Can Esc dismiss the First Run window into a dimmed, Project-less street? First Run is one scene, but interruption makes it four; only the happy path is scripted.
**Fix:** Script the interruption cases: resume point, folder persistence, Esc behavior, and what the dimmed street does before a Project exists.

### [Sally H-2] Retired orders have no status word — and the mock invented one
**Where:** EXPERIENCE §State Patterns FR-10, §Cancel flow, §UJ-4; `mock-sendback.html`; DESIGN §Colors.
The board's painted vocabulary is WAITING / COOKING / SERVED / BURNED, full stop — yet scrapped lines "stay visible," cancelled lines "retire," and mock-sendback answers with a status the design system doesn't own: "taken back." At least three end-states with zero specced ink; the unassigned harbor-blue token smells like this exact hole waiting for paint.
**Fix:** Decide the words and the color (one shared "retired" word is fine) and put them in both spines, or the board will grow ad-hoc statuses in code.

### [Sally H-3] The First Run mock dropped the assets beat and added wizard furniture
**Where:** `mock-firstrun.html` vs EXPERIENCE §First Run flow step 5.
The spine's "Got pictures and voices for the crew?" beat — the asset-discoverability fix — is missing from the mock's three steps; if the mock is the beat sheet, the fix silently un-ships and Maksym never learns where his pictures live. In its place: Back/Next buttons and "● ○ ○" progress dots — settings-wizard furniture in the one scene the PRD swore is "a scene, not a settings form."
**Fix:** Restore the beat; decide the nav's fate explicitly (the spine's Krabs-conversation version needs no Next button at all).

### [Winston H-1] "Folded technical detail" has no mapping onto the actual SDK message stream
**Where:** EXPERIENCE + DESIGN "Folded technical detail"; addendum SDK notes.
"Raw output folds behind one plain line per bubble" presumes a bubble model never defined. Unanswered and load-bearing for FR-11: what is a bubble? What exactly folds when Claude's prose contains backticked paths? Who authors the plain line (Claude per fold, or app-synthesized from tool names)? And during a tool-only stretch, an open Work Window on a Working Character shows nothing moving — contradicting "progress is visible as it happens," with no spinner allowed to paper over it.
**Fix:** One paragraph: a bubble = X; folds contain Y; the plain line is authored by Z with fallback W; during tool-only stretches the window shows V.

### [Winston H-2] Cancel: the stop is buildable, but the spine is silent about everything cancel leaves behind
**Where:** EXPERIENCE "Cancel an order"; Cancel flow; addendum "streaming-input mode".
SDK `interrupt()` exists (requires streaming-input sessions — architecture must never use string prompts). Gaps after the stop: are the worktree's half-done changes discarded or kept? Does the conversation survive a cancel (FR-13)? Cancel while WAITING means resolving a pending `canUseTool` promise — do the live Allow/Deny buttons disable? And `interrupt()` stops at message boundaries, so keep the copy pointed at the landing guarantee, not a stopped-mid-keystroke guarantee.
**Fix:** State the worktree and conversation aftermath, the cancelled-ask button rule, and pin the "within seconds" honesty in a story note.

### [Winston H-3] First Run's "silently prepares the folder" asserts silence over machinery with known, named failure modes
**Where:** EXPERIENCE §First Run steps 2–3; PRD FR-17/FR-19; addendum Conductor gotcha.
Plain folder (the stated default!) means the app runs `git init` and commits Maksym's files under an app-authored identity — a product behavior the spine should own in one Krabs sentence, plus a defined experience when preparation fails (read-only folder, nested repo, iCloud path). Existing repos, dirty trees, node_modules with no .gitignore each differ. The untracked-files gotcha reads as data loss to Maksym — assert the bar ("a Lane always sees everything in the Project folder"). And abandoned first run: quit between steps — next launch resumes where? First Run, as written, violates the spine's own "never hide that something failed" rule by construction.
**Fix:** Name the failure-mode experiences; no design needed here, just the named states.

### [Winston H-4] Send it back: the button's lifetime is unspecified, and the spine's surfaces can't honor the PRD's durability promise
**Where:** EXPERIENCE "Send it back"; Send-it-back flow; PRD §9 Reliability, FR-13.
Through a follow-up, two Send-it-back buttons exist in one conversation — does the older one still work? Through a new Job, the old conversation leaves the Work Window, yet PRD §9 lists per-order Send-it-back among surviving state and the board's retired lines click through to the current window only. Net: no surface exists from which an order older than the current conversation can be sent back.
**Fix:** Either scope Send it back to "the latest served order per Character, until the next Job" — a perfectly good v1 answer that should be written down — or give the board's retired lines a path to it.

### [John H-1] "Trouble acknowledged by scrolling" sends the Character Idle while the BURNED order is still open — and breaks one-Job-per-Character
**Where:** EXPERIENCE §State Patterns "Unseen Dot resolve-to-clear"; PRD FR-4, FR-5, Glossary "Job".
Patrick burns an order; the explanation scrolls into view; per this spine the dot clears and Patrick returns to Idle — but nobody clicked Try again or Scrap it. The order is still BURNED, still active. The picker now shows Patrick full-color while he holds an open Job: either Home Base hands him a second Job (violates the one-Job decision) or the picker silently refuses (an invisible, unwritten rule). An Idle Patrick next to a BURNED board line breaks FR-3's guarantee that the street never lies.
**Fix:** For BURNED, resolution = a choice made, full stop. Patrick stays Calling (or at minimum non-Idle, non-pickable) until Try again or Scrap it.

### [John H-2] The landing-collision ask — FR-16's other half — is nowhere in the spines
**Where:** EXPERIENCE Key Flows / Component Patterns / sound matrix (absent); PRD FR-16, FR-17, UJ-2.
FR-16 made two promises; the second — what happens when two Characters' finished work collides at landing — has vanished. This is the single scariest moment in the whole product for a non-technical user: the one place where "isolated Lanes" stops being invisible. Whoever builds this will improvise, and improvised merge UX is how you get a technical merge screen with a wooden border.
**Fix:** Add a "Two orders collide at serving" key flow mirroring UJ-3's shape — Calling + Voice Line + notification, one either/or bubble, board shows WAITING, choice recorded in chat.

---

## Medium

### [Rubric — Flow coverage] FR-13's conversation-lifecycle rule is missing
**Where:** EXPERIENCE.md IA / State Patterns; prd.md FR-13.
The PRD says a follow-up continues the same conversation but a new Job from Home Base starts a fresh conversation, with the old outcome kept as board history. EXPERIENCE.md mentions follow-ups only in passing — the fresh-conversation reset and what Maksym sees when it happens appear nowhere.
**Fix:** Add a Component Patterns row (or a short Key Flow) for follow-up vs. new-Job: what the Work Window shows when a new Job wipes the chat, and where the old conversation goes.

### [Rubric — Flow coverage] FR-16's landing collision has no experience treatment
**Where:** EXPERIENCE.md Key Flows (absent); prd.md FR-16.
Only the Send-it-back entanglement case is covered; the collision-at-landing bubble — its copy shape, its Calling trigger, its board status while paused — is unspecified. (Escalated by Winston C-2 and John H-2.)
**Fix:** One row or one flow-step: "Landing collision → Character goes Calling, order WAITING, one either/or bubble; either pick lands consistently."

### [Rubric — Token completeness] No contrast target is stated for any load-bearing combination
**Where:** DESIGN.md Colors; EXPERIENCE.md Accessibility Floor.
E.g. the paper-sub subtitle (#7a5c26) at 12px on the paper gradient, the four status inks on paper, caption-glow on deep-sea. A consumer restyling any surface has no floor to verify against.
**Fix:** One sentence: minimum contrast for board text/status words and chat ink against their papers.

### [Rubric — Component coverage] "Cancel this order" has behavioral rules but no visual definition
**Where:** EXPERIENCE.md Component Patterns "Cancel an order"; DESIGN.md (absent).
DESIGN.md never says what a "quiet affordance near the input bar" looks like, and its placement is itself tagged [ASSUMPTION].
**Fix:** One line in DESIGN.md Components committing its form.

### [Rubric — State coverage] Notification permission denied is unhandled
**Where:** EXPERIENCE.md First Run flow step 4; prd.md FR-7.
Nothing says what happens if Maksym declines — and FR-7's notification click-through is a primary reentry path. The sound/notification matrix assumes notifications always fire.
**Fix:** One line: denied → Voice Lines and street signals carry the load; where (if anywhere) Krabs mentions it can be re-enabled.

### [Rubric — Visual reference coverage] Precedence is stated ambiguously, and never as a rule
**Where:** DESIGN.md Brand & Style; EXPERIENCE.md "Orders Board toggle".
DESIGN.md calls the mockup "binding" while EXPERIENCE.md deliberately overrides mockup behavior in at least one place. No sentence says which document wins when they diverge.
**Fix:** One statement, once: "The mockup binds the look; these spines bind the behavior; on conflict the spines win."

### [Rubric — Visual reference coverage] mock-sendback.html diverges from the committed contract in product behavior, unflagged
**Where:** `.working/mock-sendback.html` vs EXPERIENCE.md State Patterns FR-4; DESIGN.md "In-chat action buttons".
It adds a "👍 Looks good" approve button and clears the dot on button press, while the spine commits to passive resolution; the burned/sendback mocks also render all choice buttons as plain wood while DESIGN.md specs Allow/Try-again as accent-filled. Promoted as-is they contradict FR-4 semantics and the button spec.
**Fix:** When promoting, either annotate the divergences or bring the mocks in line.

### [Rubric — Inheritance discipline] EXPERIENCE.md calls every in-chat choice a "wooden button"; DESIGN.md specs Allow/Try-again as accent-filled
**Where:** EXPERIENCE.md UJ-3, UJ-4, Component Patterns vs DESIGN.md "In-chat action buttons".
A consumer reading EXPERIENCE.md alone builds all-wood buttons — exactly what the working mocks did.
**Fix:** In EXPERIENCE.md, replace "wooden buttons" with "action buttons (per DESIGN.md)" in the four places.

### [Sally M-1] A fresh order is WAITING in one paragraph and COOKING in the next
**Where:** EXPERIENCE §State Patterns FR-10 vs §UJ-1 step 5; `mock-handout.html`.
The lifecycle line reads "WAITING (handed out or paused for Maksym's OK) → COOKING," but UJ-1's climax says the freshly handed-out order is already COOKING, and mock-handout agrees.
**Fix:** Either a handed-out order visibly passes through WAITING (say for how long and what flips it) or it's born COOKING (then WAITING means only "paused for OK" and the lifecycle line should say so).

### [Sally M-2] DESIGN paints affirmative buttons in character accents; all four mocks paint everything wood
**Where:** DESIGN §Components in-chat action buttons; all four mocks.
Two truths again. Wood-everywhere is honestly calm and could be argued for, but then DESIGN must change; as written, the mocks violate the spec they're meant to demonstrate.
**Fix:** One decision, applied to both.

### [Sally M-3] One state, three vocabularies
**Where:** `mock-handout.html` chips vs EXPERIENCE §Component Patterns vs street labels.
A Working SpongeBob is "working…" on the street and "cooking…" in the picker, ten feet apart; the mock's chips also say "calling you" where the spine says "calling."
**Fix:** Extend the glossary discipline to state words: pick one set, use it everywhere.

### [Sally M-4] UJ-1's failure beat can't happen in the mock's staging
**Where:** EXPERIENCE §UJ-1 failure vs `mock-handout.html`.
The spine scripts "sending with no Character picked → Krabs asks"; the mock hides the input bar entirely until a character is picked — the failure is unreachable. Arguably better UX, but then the spine's failure beat is dead copy.
**Fix:** Say which staging is real.

### [Sally M-5] Relaunch resume is a fourth kind of Calling the sound matrix never scored
**Where:** EXPERIENCE §App quit/relaunch vs §Sound & notification matrix.
The matrix defines Voice Lines and notifications for exactly three Calling causes. Does app launch with three paused lanes open on a staggered three-voice chorus plus three notifications? A cozy morning should probably open quiet.
**Fix:** Add the fourth row to the matrix.

### [Sally M-6] The world after "no" to notifications doesn't exist
**Where:** EXPERIENCE §First Run step 4, §Sound & notification matrix; `mock-firstrun.html`.
Nothing specs the app in a notifications-denied life: FR-7's "arrives even in background" silently fails and SM-2's "nothing missable" now rests entirely on the dot — fine, but say it.
**Fix:** Spec the degraded state and decide whether Krabs ever gently re-offers.

### [Winston M-1] The sound stagger contradicts itself: "0.55s apart" and "never overlapping" cannot both be true
**Where:** EXPERIENCE Sound & notification matrix; PRD §3 "Voice Line".
Catchphrase-length clips (1–3s) staggered 0.55s apart overlap for most of their duration. The intended rule is presumably end-of-clip + gap (queue, not offset). And: how deep does the queue go; does a queued line still play for an already-resolved need?
**Fix:** One sentence: "serial queue, 0.55s gap after each clip ends, drop queued lines whose need is already resolved."

### [Winston M-2] Notification click-through needs its edge cases defined, not just its happy path
**Where:** EXPERIENCE "Notification click-through"; §Foundation "one overlay at a time".
Undefined: clicking a stale notification whose need was already resolved; clicking while another Work Window or the Orders Board is open (the one-overlay rule implies swap — say it); clicking during First Run. Pause-on-quit means notifications only exist while the app runs — worth one sentence stating that.
**Fix:** Cheap sentences for each case; each is currently a story-time invention.

### [Winston M-3] WAITING-as-"handed out" still has no moment to exist, and the instant street flip papers over a real spin-up delay
**Where:** EXPERIENCE "Orders Board statuses" vs §UJ-1 step 5; PRD FR-3.
UJ-1 shows COOKING immediately on handout; the status table says WAITING covers "handed out." Both can't be the default — and the real handout path (create worktree, start SDK session) can take seconds on a big repo.
**Fix:** Either delete handed-out-WAITING (keeping WAITING solely for paused-on-OK, its only load-bearing use) or define WAITING as the spin-up status.

### [Winston M-4] "Quitting mid-COOKING pauses the Job" promises a pause the SDK doesn't have
**Where:** EXPERIENCE "App quit / relaunch"; addendum "Sessions" per-cwd gotcha.
Quit kills the process; "keep cooking" is `resume: session_id` from the same worktree cwd (so worktree paths must survive relaunch). Resume replays the conversation, not a half-executed action — the Krabs copy should stay honest. And the flow is defined only for quitting; the reliability NFR includes crash and sleep.
**Fix:** One word ("quit or crash") closes the scope gap; keep the copy honest about the resume, not a literal pause.

### [Winston M-5] Denied notification permission has no degraded state — and the mock quietly makes permission mandatory
**Where:** EXPERIENCE §First Run step 4; `mock-firstrun.html`; PRD FR-7, SM-2.
The mock disables "Open the town!" until Allow is clicked — an OS permission as a gate, which macOS doesn't even guarantee. Neither artifact says what the town does when permission is denied.
**Fix:** Remove or justify the mock's gate; define one behavior for the denied state (Krabs notes it once, Voice Lines + dots carry the load, a re-ask path exists).

### [John M-1] First Run has no path for "Don't Allow" — and the mock holds the town hostage
**Where:** EXPERIENCE First Run step 4; `mock-firstrun.html`; PRD FR-19, FR-7, §2.
The mock gates entry behind granting notifications — coercion, not a polite ask, and exactly the dark-pattern texture this product exists to avoid. And neither spine says what happens when Maksym hits Don't Allow on the real macOS dialog.
**Fix:** The town opens regardless; Krabs reacts warmly to a denial ("No hollerin', then — watch for me red dots!") and the spec says where to re-ask later.

### [John M-2] The first-run mock dropped the assets step
**Where:** `mock-firstrun.html`; PRD FR-19, FR-18; EXPERIENCE First Run step 5.
Every picture and sound being Maksym's own is the emotional heart of this product — the moment that invites him to bring his art is not a step you trim for a cleaner wizard.
**Fix:** Mock gets the fourth step back, matching EXPERIENCE.md.

### [John M-3] Placeholder Voice Lines aren't specced as per-Character distinct — so "know by ear" is dead at launch
**Where:** DESIGN.md (generic stand-ins); EXPERIENCE sound matrix; PRD FR-6, §2.1, §6.2.
The MVP ships with placeholder sounds; real clips come later. If all three Characters fall back to the same labelled tick, on day one Maksym cannot tell by ear who's calling. The by-ear promise is one of the four Jobs To Be Done.
**Fix:** One line: placeholder sounds are per-Character distinct (three different neutral tones is enough), just as picture stand-ins are per-Character emoji.

### [John M-4] What does the board say after "Send it back"? The mock invented a fifth status
**Where:** `mock-sendback.html` ("taken back"); EXPERIENCE Orders Board statuses; PRD FR-10, §3.
"Taken back" exists nowhere in the PRD's binding status set, and EXPERIENCE.md never says what a sent-back order shows: stay SERVED (a lie), vanish, or a new word?
**Fix:** Decide in EXPERIENCE.md — recommendation: sent-back orders join the retired history like scrapped ones, with the chosen word added to FR-10's set deliberately, not by mock accident.

---

## Low

### [Rubric — Token completeness] spacing.1 and spacing.2 are defined but never referenced
**Where:** DESIGN.md frontmatter, spacing block.
**Fix:** Reference them (e.g. label gap 4px, bubble padding) or note them as reserved scale steps.

### [Rubric — Token completeness] A few needed mockup values aren't tokenized or stated
**Where:** DESIGN.md Components/Typography vs mockup CSS.
Top-button font-size (14px), street speech-bubble text size (clamp(10px,1.3vw,13px)), menu subtitle size (12px).
**Fix:** Add the three sizes to the typography block or component tokens.

### [Rubric — Component coverage] The volume slider has no visual spec
**Where:** EXPERIENCE.md "Mute / volume". The only slider in the product, in a world with no slider vocabulary.
**Fix:** A token-level note (wood track? parchment?) or simplify to mute-toggle-only in v1.

### [Rubric — Component coverage] Disabled state for in-chat action buttons is behavioral only
**Where:** EXPERIENCE.md "Allow / Deny"; DESIGN.md action-button tokens. The mocks improvise `opacity:.45; grayscale(.6)`.
**Fix:** Add a disabled appearance to the action-button component tokens.

### [Rubric — Component coverage] First Run chrome (stepper, progress dots, green done-state) is unspecced
**Where:** DESIGN.md (absent); `.working/mock-firstrun.html` (green #6f9a4e).
**Fix:** Either spec the stepper or state that First Run is one continuous Krabs conversation with no stepper.

### [Rubric — State coverage] Home Base with zero Idle Characters is unspecified
**Where:** EXPERIENCE.md "Character picker"; UJ-1 failure.
**Fix:** One Voice-and-Tone line, e.g. "Whole crew's busy — check the board."

### [Rubric — State coverage] The Work Window's fresh state for a never-used Character is unspecified
**Where:** EXPERIENCE.md IA / State Patterns. Empty parchment, or a greeting bubble?
**Fix:** One State Patterns row.

### [Rubric — Inheritance discipline] Review IDs are cited without a path
**Where:** EXPERIENCE.md ("review C-1", "review M-1", …).
**Fix:** Name the file once at first citation.

### [Sally L-1] Busy-chip reasons are hover-only tooltips — banned by the spine's own primitives
**Where:** `mock-handout.html` title attributes vs EXPERIENCE §Interaction Primitives.
**Fix:** Cut the tooltips or make the chip say why on click (a Krabs bubble), not on hover.

### [Sally L-2] The volume slider skirts the same ban
**Where:** EXPERIENCE §Component Patterns mute/volume. Long-hover and secondary-click are both on the banned list one section later.
**Fix:** A plain click cycling mute, with the slider inside a small popover on the same click.

### [Sally L-3] The header dot in mock-sendback is lovely and homeless
**Where:** `mock-sendback.html` header vs DESIGN §Unseen Dot; EXPERIENCE §State Patterns.
DESIGN pins the dot to the street actor only; no spine sentence brings it indoors. Unspecced coral is exactly how the "coral = dot only" law erodes.
**Fix:** Spec it (with the same resolve rule and reduced-motion behavior) or cut it.

### [Sally L-4] Small copy drift between spine and mocks
**Where:** EXPERIENCE §UJ-1, §Component Patterns vs `mock-handout.html`, `mock-burned.html`.
"Tell Patrick the job…" vs "Tell Patrick what to do…"; "Scrap it" vs "Scrap this order."
**Fix:** Align them when the bigger findings are settled.

### [Winston L-1] The volume slider is reachable only by "long-hover/secondary" — which the same document bans
**Where:** EXPERIENCE "Mute / volume" vs §Interaction Primitives "Banned".
**Fix:** Click toggles a small popover containing both mute and the slider.

### [Winston L-2] The Home Base picker's spine and mock disagree on the input bar, and the zero-idle-crew case is undefined
**Where:** EXPERIENCE "Character picker"; §UJ-1 failure; `mock-handout.html`.
**Fix:** Pick one input-bar staging; give Krabs a whole-crew-busy line ("Me whole crew's cookin' — check the board").

### [Winston L-3] "The app icon is an Asset Slot" doesn't survive contact with macOS notifications
**Where:** DESIGN §Components "Notification content".
Notification banners show the bundle icon; runtime dock-icon swaps don't change it.
**Fix:** Scope the slot to the dock icon, or drop the claim.

### [Winston L-4] The handout "acknowledgment tick" is a bundled sound in a product whose rule is every-sound-is-Maksym's-file
**Where:** EXPERIENCE §Sound matrix row 1 [ASSUMPTION]; DESIGN §Do's and Don'ts.
**Fix:** Give the tick an Asset Slot with a labelled stand-in, or drop it (the street flip is already the acknowledgment).

### [Winston L-5] First Run mock and spine disagree on step count and introduce unspecced chrome
**Where:** EXPERIENCE §Key Flows First Run; `mock-firstrun.html`; DESIGN §Components.
Five beats in the spine including the assets offer; three in the mock. The Back/Next stepper and step-dots exist in no DESIGN component.
**Fix:** Reconcile before a story developer treats the mock as binding; state the scene mocks' status in one line.

### [Winston L-6] Deny's aftermath is inferable but unstated
**Where:** EXPERIENCE "Allow / Deny"; §State Patterns resolve-to-clear.
**Fix:** One clause: "Deny resolves the need; the Character resumes Working."

### [John L-1] Volume-by-long-hover violates the spine's own banned list
**Where:** EXPERIENCE Mute/volume vs Interaction Primitives; PRD FR-8.
**Fix:** Make volume a plain click affordance (click opens a tiny wooden slider popover) and the file agrees with itself.

### [John L-2] Relaunch-resume has no row in the sound matrix
**Where:** EXPERIENCE "App quit / relaunch" vs Sound & notification matrix; PRD §9, FR-6.
**Fix:** Relaunch-resume should be dot + bubble only (Maksym is already looking at the app); say so.

### [John L-3] FR-2's drop-in flow has no UX beyond a reserved accent and a street position
**Where:** DESIGN.md (Sandy's tokens); EXPERIENCE IA table; PRD FR-2.
Sandy's out of MVP, but "guided help" is a UX surface; a paragraph now saves a redesign when her pictures arrive.
**Fix:** A short paragraph on where the Character list lives and what the guidance looks like.

### [John L-4] Handout mock makes EXPERIENCE's failure case unreachable
**Where:** `mock-handout.html` vs EXPERIENCE §UJ-1 failure.
**Fix:** Align spine and mock on one staging — the failure copy only exists in one of them.

### [John L-5] Mocks render Allow/Try-again in plain wood; DESIGN.md says Character accent
**Where:** DESIGN.md In-chat action buttons vs `mock-burned.html`, `mock-sendback.html`.
**Fix:** Align one to the other — DESIGN.md is the token law; the mocks are supposed to demonstrate it.

---

## Mechanical notes

- Frontmatter drift from the format examples: EXPERIENCE.md uses `title:` where the examples use `name:`; DESIGN.md carries both but no `sources:` key. Consider adding `sources:` to DESIGN.md and `name:` to EXPERIENCE.md for uniform machine-reading.
- Both spines are `status: draft`. Flip to `final` once the findings are resolved — downstream consumers should not have to guess whether a draft is binding.
- Naming consistency is otherwise excellent; the mockup's legacy state name "waiting" is correctly translated to Glossary "Calling" everywhere, with the rename documented in PRD §3.
- Verbatim capture verified: all hex values, radii, typography sizes, actor positions, animation names/durations, and the 0.55s stagger match `mockup/bikini-town.html` exactly. The BURNED color is a flagged [ASSUMPTION] (#3a3a3a) and mock-burned.html already uses it consistently.
- The `imports/` folder beside the spines is empty; `.memlog.md` is working memory — neither is referenced by the spines, no action needed.
