---
title: Bikini Bottom — EXPERIENCE.md
status: final
created: 2026-07-12
updated: 2026-07-12
sources:
  - '{output_folder}/planning-artifacts/prds/prd-bikini-bottom-2026-07-12/prd.md'
  - mockup/bikini-town.html
---

# Bikini Bottom — Experience Spine

> How it works. How it looks lives in `DESIGN.md` (same folder); [mockup/bikini-town.html](../../../../mockup/bikini-town.html) is the binding visual reference, and four scene mocks in `.working/` illustrate single flows (linked at their sections below). **The spines win on conflict with any mock or import.** Glossary terms are used verbatim from PRD §3. One user (Maksym), hobby stakes, macOS only.

## Foundation

macOS desktop app, single main window: the **Town**. No UI system is inherited — every surface is bespoke, specced in `DESIGN.md`. The Orders Board and Work Windows are overlays summoned from the Town, never separate OS windows [ASSUMPTION: matches the mockup's in-scene modals; keeps the world one stage]. Native macOS is used only where it must be: notifications, the folder picker, and system reduced-motion/volume settings. Behind the dressing, each Character's Work Window is a real Claude Code conversation (one Lane, per PRD §9).

## Information Architecture

| Surface | Reached from | Purpose | Realizes |
|---|---|---|---|
| Town | App launch (resting screen) | See every Character's State at a glance; summon everything else | FR-1, FR-2, FR-3, FR-4 |
| Work Window (per Character) | Click Character or house · notification click · Orders Board line click | The Lane's live chat: results, permission asks, trouble, follow-ups, cancel, Send it back | FR-11, FR-12, FR-13, FR-14, FR-16, FR-5 |
| Home Base window (Mr. Krabs) | Click the Krusty Krab | Hand out Jobs: character picker + plain-language Job entry | FR-15 |
| Orders Board overlay | 📋 button · **M** key | Every Job across all Lanes, one paper menu | FR-9, FR-10 |
| First Run walkthrough | First launch only (inside Mr. Krabs' window) | Project folder (mandatory), notification permission (optional), optional assets | FR-19, FR-17 |

One overlay at a time: opening a Work Window closes the Orders Board and vice versa. Modal depth is one — never a window on a window.

## Voice and Tone

Plain, warm, show-tone. The product talks like the town, thinks like a diner, and never talks like a computer. Character-flavored lines are welcome (Squidward grumbles, Patrick is cheerfully unsure); system facts are always honest underneath the flavor.

| Do | Don't |
|---|---|
| "Order's up! The new sign-up screen is done — come see." | "Task completed successfully." |
| "This order got burned — I hit Claude's hourly limit. Try again, or scrap it?" | Stack traces, error codes, "Error: rate_limit_exceeded" |
| "Need your OK, barnacle-head: I want to install a new tool kit." | "Permission required: npm install" |
| "No orders yet — ring the Krusty Krab!" (empty board) | A blank paper menu that reads as broken |
| "Sent it back. The Project is just as it was before this order." | "Rollback complete." |
| "Me work bumped into Squidward's — come pick which stays!" | "Merge conflict in 3 files." |
| Diner vocabulary everywhere: order, cooking, served, burned, scrapped, sent back | Jargon: repo, branch, merge, session, token, worktree |

Trouble is explained gently — a burned order is a joke about the kitchen, followed by an honest plain sentence about what actually happened and two clear choices. Never blame Maksym; never hide that something failed.

## Component Patterns

Behavioral rules. Visual specs live in `DESIGN.md` Components.

| Component | Use | Behavioral rules |
|---|---|---|
| Actor (Character + house) | Town | Whole figure and its house are one click target → opens that Character's Work Window (Krusty Krab → Home Base). Hover scales the figure; street label ("Patrick · working…") is a secondary signal only — the picture is the primary one (FR-3). |
| Orders Board toggle | Town | 📋 button or **M** opens; **M**, **Esc**, the button, or a click on the scrim closes. **M is ignored while any text field is focused.** Clicking a Job line opens that Character's Work Window (closing the board) — this deliberately overrides the mockup, where any click closes the board (FR-10 [ASSUMPTION], review M-1). |
| Work Window close (✕ / Esc) | Work Window | Closing never stops the Job (FR-11). Closing with an unresolved need — an undisplayed result summary, an unanswered Allow/Deny or collision choice, or an open BURNED choice — leaves the Character Calling and the Unseen Dot in place (FR-4). |
| Folded technical detail | Work Window | Each Character reply turn is **one chat bubble**. Tool/command activity within a turn folds behind **one plain-language line** in that bubble, in friendly-verb phrasing ("rummaging through the kitchen…"); the app maps tool activity to a small phrase set [ASSUMPTION: exact mapping is architecture's]. The line **updates live** during tool-only stretches, so a Working Character's progress is always visible (FR-11). Click expands the raw detail inline; click refolds. Collapsed by default, always. |
| Allow / Deny | Work Window | Rendered as wooden buttons inside the ask bubble (FR-12). One click resolves the need either way: Allow resumes Working; Deny keeps the conversation going — the Character explains and adjusts. The chosen answer stays visible in history; the buttons then disable. |
| Collision choice | Work Window | When a finished order can't land because it collides with another Character's served work (FR-16): the order flips to WAITING, the Character goes Calling, and the Work Window shows **one** plain either/or bubble — a sentence naming what both touched in plain words, plus two wooden buttons, one per version ("Keep {this Character}'s" / "Keep {other}'s"). A pick lands the order → SERVED, and either pick leaves the Project consistent. Never a technical merge view; never more than one either/or at a time [ASSUMPTION: multi-file collisions are batched into a single choice; architecture may split into at most a handful of sequential asks]. |
| Send it back | Work Window | A wooden button sitting directly under a served order's result summary (FR-16). It stays available for the lifetime of that conversation and survives quit/relaunch (PRD §9); handing that Character a *new* Job retires it (FR-13 reset) [ASSUMPTION]. Click → one confirmation bubble ("Send it back? I'll put the Project back how it was.") with Yes / Keep it. After use, the buttons are replaced by the Character's confirmation and the board line flips to SENT BACK. Entanglement with newer served work surfaces as one plain either/or bubble — never a technical merge view. Illustrated: [mock-sendback.html](mockups/mock-sendback.html). |
| Try again / Scrap it | Work Window | The two wooden buttons under a burned order's explanation (FR-5). Try again → Character back to Working, board line back to COOKING. Scrap it → board line flips to SCRAPPED, Character to Idle. Until one is clicked the Character stays Calling (see State Patterns). |
| Cancel an order | Work Window | A small wooden "Cancel this order" link-button in the input-bar area, visible only while that Character's order is COOKING or WAITING [ASSUMPTION: placement and visibility window]. One confirmation bubble; work stops within seconds; cancellation is written into the chat; the board line flips to SCRAPPED (FR-14). |
| Character picker | Home Base window | Mr. Krabs opens with "Ahoy Maksym! What job are we handin' out today, and to which of me crew?" Below his bubble sits a row of Character portraits [ASSUMPTION: layout — one row inside the chat, before the input bar]. Idle Characters are full-color and clickable; unavailable ones are grayed out with the reason under the portrait ("working…", "calling", "burned order needs you"). Pick one → the input bar reads "Tell {Character} the job…"; sending hands out the Job (FR-15) and **starts a fresh conversation** — the prior conversation's outcome stays on the board as history (FR-13). Illustrated: [mock-handout.html](mockups/mock-handout.html). |
| Mute / volume | Town | One unobtrusive wooden button, top-left [ASSUMPTION]. Click toggles mute; long-hover/secondary shows a small volume slider. Persists across restarts. Visual signals never mute (FR-8). |

## State Patterns

**Street States (per Character, FR-3):** exactly one at all times, shown by the picture from that Asset Slot.

| State | Meaning | Street treatment |
|---|---|---|
| Idle | No Job | Idle picture. Stand-in emoji sways. |
| Working | Job COOKING | Working picture. Stand-in emoji bobs. |
| Calling | Finished-unseen, needs an OK, or in trouble | Calling picture + Unseen Dot + nudging speech bubble ("All done — come see!" / "Need your OK!" / "Me work bumped into {other Character}'s — come pick!" / "Somethin' burned — come quick!"). Stand-in emoji hops. |

**Unseen Dot resolve-to-clear (FR-4):** the dot clears only when the *need* is resolved, and each of the three need types has exactly one resolving event — this model governs every other mention in both spines:

1. **Finished order** — resolved when the result summary is **displayed** in the open Work Window. No button; reading resolves, matching the auto-land decision (PRD §3 Serving).
2. **Permission ask** (including a collision choice) — resolved when **Allow or Deny** (or a collision pick) is clicked.
3. **BURNED order** — resolved **only** when Maksym picks **Try again or Scrap it**. Until then the Character **stays Calling** — never Idle with an open BURNED order (one Job per Character holds; the Home Base picker shows them unavailable as "burned order needs you").

Opening and closing a window without resolving keeps the dot. The dot survives app restart and never times out. On resolve, the Character returns to Idle — or Working, if the answer resumed the Job.

**Orders Board statuses (FR-10):** WAITING (handed out, or paused for Maksym's OK — a permission ask or a collision at landing) → COOKING → SERVED, with BURNED as the failure exit; SCRAPPED marks cancelled or scrapped orders and SENT BACK marks undone ones [ASSUMPTION: both words and their shared ink are new to FR-10's set — added deliberately, inks in `DESIGN.md`]. Statuses update live while the board is open. A follow-up (FR-13) flips the same Job line back to COOKING. The board keeps a modest history: retired lines (SERVED / SCRAPPED / SENT BACK) stay visible, newest first, capped at the last 10 [ASSUMPTION: retention number]; older ones fall off the menu — yesterday's paper gets thrown away.

**Sound & notification matrix (FR-6, FR-7, FR-8):**

| Event | Voice Line | Notification |
|---|---|---|
| Job handed out (Idle → Working) | None — at most a subtle acknowledgment tick [ASSUMPTION] | None |
| Character starts Calling — finished | Yes, once | "{Character} finished: {one-line summary}" |
| Character starts Calling — needs OK | Yes, once | "{Character} needs your OK: {plain line}" |
| Character starts Calling — collision at landing | Yes, once | "{Character} needs your OK: his work bumped into {other Character}'s" |
| Character starts Calling — BURNED | Yes, once | "{Character} got stuck: {plain line}" |
| Need resolved / follow-up / cancel | None | None |
| Two Lanes start Calling together | Staggered **0.55s** apart, never overlapping | Both fire |

Voice Lines play once per transition — the persistent signals are visual (dot + bubble), so a waving friend never becomes a nagging one. Notifications are delivered silently (the Voice Line is the sound), arrive even with the app in background, and clicking one brings the app forward with that Character's Work Window open. Muted: no sounds, but notifications and all visual signals remain.

Until Maksym's real clips arrive, the **placeholder Voice Lines are per-Character distinct** — the mockup's synth signatures (a distinct base pitch + waveform per Character: SpongeBob high square, Squidward low sawtooth, Patrick mid triangle, Sandy sine, Mr. Krabs deep sawtooth), staggered 0.55s like real clips — so "know by ear who's calling" holds from day one (FR-6).

**Notification permission denied:** the Town behaves normally — Voice Lines and Unseen Dots carry the load, nothing else changes. Mr. Krabs offers a one-time gentle reminder line in his window ("ye can allow later in System Settings; the red dots never lie anyway") [ASSUMPTION].

**App quit / relaunch (PRD §9):** quitting mid-COOKING pauses the Job — nothing works invisibly in the background. On relaunch the Character is Calling with the bubble "Want me to pick this back up?"; the Work Window offers **Keep cooking / Scrap it** [ASSUMPTION: copy]; the board shows the paused Job as WAITING. All state — States, dots, board, conversations, Send-it-back ability — survives quit, crash, and sleep.

## Interaction Primitives

- **Click** — the universal verb: actors, houses, board lines, buttons, notifications.
- **M** — toggle the Orders Board (suppressed while typing in any text field).
- **Esc** — close the topmost overlay (Work Window or Orders Board).
- **Notification click-through** — raises the app and opens the calling Character's Work Window (FR-7).
- **Banned:** drag-and-drop as a required step, right-click-only actions, keyboard-only affordances beyond M/Esc, hover-only information. The mockup's 🎭 mood-preview button is demo scaffolding and does not ship.

## Accessibility Floor

Calibrated to a single known user — Maksym — not formal WCAG conformance [ASSUMPTION: no screen-reader or full-keyboard-operation requirement in v1; revisit only if his needs change].

- `prefers-reduced-motion` honored: dot stops pulsing, bubble stops nudging, stand-in loops stop — but the dot and bubble **remain visible**; the "needs you" signal is never motion-only.
- Sound is redundant by design: everything a Voice Line says, the street and board also show. Mute/volume never silences visuals (FR-8).
- Readable type: chat at 14px minimum, board lines at 18px, per `DESIGN.md` typography tokens; no text under 10px anywhere.
- Click targets: whole actor + house, whole board line, generously padded buttons — nothing smaller than the mockup's 32px close button.

## Key Flows

### UJ-1. Maksym hands out an order (FR-15, FR-3, FR-10)

1. Maksym opens the app; the Town is idle.
2. He clicks the Krusty Krab. Mr. Krabs' window opens: "Ahoy Maksym! What job are we handin' out today, and to which of me crew?"
3. The character-picker row shows the crew: Patrick full-color (Idle), others grayed with their state words.
4. He clicks Patrick; the input bar reads "Tell Patrick the job…". He types it in plain words and sends.
5. **Climax:** through the closing window he sees Patrick's street picture flip to his Working slot — the town visibly takes the job. The Orders Board now lists it as COOKING.
6. He closes the window and goes about his day; the Job keeps cooking.

Failure: sending with no Character picked → Mr. Krabs asks in a bubble, "Which of me crew is this for?" — nothing is lost from the input. Illustrated: [mock-handout.html](mockups/mock-handout.html).

### UJ-2. A voice calls him back (FR-6, FR-7, FR-4, FR-16)

1. While Maksym reads email, SpongeBob's Voice Line plays once and a notification appears: "SpongeBob finished: renamed all the product pages."
2. He clicks the notification; the app comes forward — SpongeBob in his Calling picture, Unseen Dot pulsing, bubble nudging — and his Work Window opens.
3. He reads the result as chat bubbles; the work has already landed in the Project (Serving, FR-16).
4. **Climax:** the result summary sits in SpongeBob's bubble with **Send it back** right under it — seen, landed, undoable, all in one glance. The moment the summary is displayed, the need is resolved (resolve-to-clear, need type 1): the dot clears; SpongeBob returns to Idle. No button, no sign-off.
5. Had he ignored the sound: the dot and the Orders Board still show it. Nothing was missable.

### UJ-3. A character asks permission (FR-12, FR-4)

1. Mid-job, Squidward's Lane hits a Risky Action. Squidward goes Calling: dot, Voice Line, bubble "Need your OK, barnacle-head."
2. Maksym opens Squidward's Work Window: a plain-language question in a bubble with **Allow / Deny** wooden buttons; the board shows the order as WAITING.
3. He clicks Allow.
4. **Climax:** Squidward's street picture flips back to Working before the window even closes — the answer visibly un-stalls the kitchen. The choice stays in the chat history.
5. If he'd closed without answering: the question is unresolved, so the dot stays and the order stays WAITING (review C-1). Safe Actions never interrupt at all.

### UJ-4. An order gets burned (FR-5, FR-10, FR-7)

1. Patrick's Job hits a wall (error, or Claude's usage limit).
2. Patrick goes Calling; his Voice Line plays; the notification says "Patrick got stuck: couldn't finish the renaming."
3. On the Orders Board, the line's status turns BURNED in charcoal.
4. Maksym opens Patrick's window: a gentle, plain explanation — "This order got burned — I hit Claude's hourly limit. It'll reset within the hour." — with **Try again / Scrap it** wooden buttons. Reading it doesn't resolve anything: until he picks, Patrick stays Calling (resolve-to-clear, need type 3) and Home Base shows him as "burned order needs you".
5. **Climax:** one click and the street is honest again — Try again puts Patrick back to Working and the line back to COOKING; Scrap it flips the line to SCRAPPED and Patrick goes Idle. No silent failures, no Character stuck "busy" forever — and no Character shown free while a burned order waits. Illustrated: [mock-burned.html](mockups/mock-burned.html).

### Collision at landing (FR-16, FR-17)

1. SpongeBob finishes his order — but landing it collides with something Squidward already served.
2. Instead of landing silently, the order flips to **WAITING** on the board (paused for Maksym's OK); SpongeBob goes Calling — dot, Voice Line, street bubble "Me work bumped into Squidward's — come pick!" — and the notification fires: "SpongeBob needs your OK: his work bumped into Squidward's."
3. Maksym opens SpongeBob's Work Window: **one** plain either/or bubble names what both touched in plain words — "We both changed the menu page: Squidward's served version renames the dishes; mine recolors them. Which stays?" — with two wooden buttons: **Keep SpongeBob's / Keep Squidward's**.
4. He picks one. The choice stays in the chat history; the order lands; the board line flips to SERVED.
5. **Climax:** the scariest moment in the product — two Characters' work touching the same thing — is a single friendly either/or, and either pick leaves the Project consistent. Never a technical merge view; never more than one either/or at a time [ASSUMPTION: multi-file collisions are batched into a single choice; architecture may split into at most a handful of sequential asks].

### First Run flow (FR-19, FR-17)

1. First launch: the Town appears dimmed and **non-clickable** — the street stays inert until the walkthrough completes. Mr. Krabs' window opens itself: "Ahoy! Welcome to Bikini Bottom, Maksym. Before me crew can cook, I need to know where the work lives."
2. A wooden **Pick the Project folder** button opens the native macOS folder picker [ASSUMPTION: native picker framed by Krabs' bubble copy, not replaced]. This step is **mandatory**: there is no way past it — no Next, and Esc doesn't skip it.
3. Maksym picks a plain folder. Krabs: "Good. I'll set up the kitchen back here — you won't have to touch a thing." The app silently prepares Lane isolation (FR-17). If the folder can't be prepared, Krabs says so plainly ("That drawer's stuck, lad — pick me another?") and lets Maksym pick another; failure specifics are architecture's.
4. Krabs asks for notifications, with the reason first: "When an order's up, I'd like to holler even if you're off doing somethin' else. That OK?" — **Sounds good** triggers the macOS permission dialog; **Not now** declines. This step is **optional**: declining — or macOS itself denying — gets the same warm reassurance ("No hollerin', then. Ye can allow later in System Settings; the red dots never lie anyway.") and the walkthrough continues. Never a trap, never a gate.
5. Krabs offers assets: "Got pictures and voices for the crew? Drop 'em in anytime." — a **Show me where pictures go** button opens the Asset Slots folder in Finder; **Later** skips (review M-6).
6. **Climax:** the dimming lifts and the Town stands ready — every Character Idle (stand-ins where files are missing), the street alive. Krabs: "Ring me bell when you've got work to hand out." First Job is one click away; not one technical word was seen.

Interruption: quitting mid-walkthrough resumes at the same step on relaunch; a folder already chosen is remembered. Illustrated: [mock-firstrun.html](mockups/mock-firstrun.html).

### Send-it-back flow (FR-16)

1. In a served order's Work Window, Maksym clicks **Send it back** under the result summary.
2. The Character confirms in one bubble: "Send it back? I'll put the Project back how it was before this order." — **Yes, send it back / Keep it**.
3. He confirms; the Character removes that order's changes from the Project and says so in the chat. The buttons are replaced by that confirmation; the board line flips to SENT BACK.
4. **Climax:** "Sent it back. The Project is just as it was before this order." — trust in one sentence: nothing Claude serves is ever irreversible. The button was there the whole conversation and would have stayed until the next Job (see Component Patterns).
5. Entanglement: if newer served work is tangled with it, the Character explains and offers one plain either/or choice ("Send back both, or keep everything?" [ASSUMPTION: exact options come from architecture, Open Question 4]); either pick leaves the Project consistent. Never a technical merge screen. Illustrated: [mock-sendback.html](mockups/mock-sendback.html).

### Cancel flow (FR-14)

1. A Job is COOKING (or WAITING) and Maksym changes his mind; he opens that Character's Work Window.
2. He clicks **Cancel this order** near the input bar.
3. One confirmation bubble: "Scrap this order? Nothin' from it will land in the Project." — **Scrap it / Keep cooking**.
4. **Climax:** work visibly stops within seconds; the cancellation is written into the chat; the board line flips to SCRAPPED; the Character walks back to Idle. No half-done work ever lands — landing happens only when a Job finishes (FR-16).
