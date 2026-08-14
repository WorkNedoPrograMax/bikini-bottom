---
title: Bikini Bottom — PM Review of the UX Spine Pair (Value Fidelity)
reviewer: John (Product Manager)
reviewed: DESIGN.md, EXPERIENCE.md, .working/mock-handout.html, .working/mock-firstrun.html, .working/mock-burned.html, .working/mock-sendback.html
source-of-truth: prds/prd-bikini-bottom-2026-07-12/prd.md (final)
date: 2026-07-12
verdict: Strong spine, one confession that doesn't match the alibi — the sendback mock quietly re-litigates a decision Maksym already closed.
---

# PM Review — UX Spine Pair, Value Fidelity

Let me tell you what I do with a case like this. I put the PRD on one side of the table, the spines on the other, and I ask each promise: *were you kept, were you bent, or did somebody quietly bury you?* Most of this file is a love letter to the PRD. EXPERIENCE.md reads the Glossary verbatim, the tone table is exactly the diner voice §8 asked for, the character picker the PRD flagged as undesigned (FR-15 note) got designed, and the UJ flows each have a named climax — someone here understands that the product's job is a feeling, not a feature list. SM-3 is alive in these documents.

But I've been doing this long enough to know the tidy files are where the bodies are. I found one contradiction of a signed confession, two promises that went missing between the PRD and the spine, and a handful of seams a non-technical man will catch his sleeve on. Here's the case file, most severe first.

---

## CRITICAL

### C-1. The sendback mock re-introduces the review gate Maksym explicitly rejected
**Where:** `.working/mock-sendback.html` (the "👍 Looks good" button; the `seen()` handler that removes the dot only on button click; the caption "approve it with a thumbs-up"). **PRD:** §3 Glossary *Serving* ("automatic on finish, with a per-order Send it back undo — Maksym's decision, 2026-07-12, chosen over a look-first review gate"), §6.2 ("Look-first serving — considered and not chosen"), FR-4, UJ-2.

Here's the confession on file: Maksym was offered a look-first gate and said no. Auto-land, undo if unhappy. EXPERIENCE.md honors this — UJ-2 step 4 says the dot clears when the result is *seen*, and the State Patterns section defines "seen" as "the resolving content was actually displayed." Then I open the mock and what do I find? The dot only clears when Maksym *clicks a button* — "Looks good" or "Send it back." A note that literally says "✓ Marked as seen." That's not seeing; that's approving. That's the review gate wearing a thumbs-up emoji as a disguise.

Impact on the promised experience: every single served order now demands a click before the street goes quiet. Multiply by every job, every day — the town stops being a friend who waves and becomes a coworker who needs sign-off. SM-C1 fails the "does the town stay cozy" question, and the mock contradicts both the PRD and its own sibling spec. Mocks are what builders copy. Fix: the result scrolling into view clears the dot (per EXPERIENCE.md); "Send it back" stays as the only button; "Looks good" is deleted or becomes purely a fun optional reply, never a gate.

---

## HIGH

### H-1. "Trouble acknowledged by scrolling" sends the Character Idle while the BURNED order is still open — and breaks one-Job-per-Character
**Where:** EXPERIENCE.md § State Patterns, "Unseen Dot resolve-to-clear": *"trouble acknowledged (a choice made, or the burned explanation scrolled into view [ASSUMPTION])"* combined with *"On resolve, the Character returns to Idle."* **PRD:** FR-4, FR-5 ("'scrap' retires the order and returns the Character to Idle" — i.e. Idle comes *after* a choice), Glossary *Job* (one active Job per Character, confirmed by Maksym).

Walk the interrogation with me. Patrick burns an order. Maksym opens the window, the explanation scrolls into view — per this spine, the trouble is now "acknowledged," the dot clears, and Patrick *returns to Idle*. But nobody clicked Try again or Scrap it. The order is still BURNED on the board, still active, still unresolved. Now Maksym rings the Krusty Krab, and the picker shows Patrick full-color and available — while he's holding an open Job. Either Home Base hands him a second Job (violates the one-Job decision) or the picker silently refuses (a rule Maksym can't see and the spec never wrote down). And an Idle Patrick standing next to a BURNED board line breaks FR-3's guarantee that the street never lies about who needs you.

Fix: for BURNED, resolution = a choice made, full stop. The dot can stop being urgent once seen if you like, but Patrick stays Calling (or at minimum non-Idle, non-pickable) until Try again or Scrap it. FR-5's own testable consequence already says so.

### H-2. The landing-collision ask — FR-16's other half — is nowhere in the spines
**Where:** absent from EXPERIENCE.md Key Flows, Component Patterns, and the sound/notification matrix; absent from DESIGN.md Components. **PRD:** FR-16 ("If landing work collides with something another Character changed, the Character pauses instead of landing silently: it goes Calling and asks in plain language which version should win — never a technical merge screen"), FR-17, UJ-2.

The Send-it-back flow got a lovely spec, including its entanglement bubble. But FR-16 made *two* promises, and the second one — what happens when two Characters' finished work collides at landing time — has vanished. This is the single scariest moment in the whole product for a non-technical user: it's the one place where "isolated Lanes" stops being invisible. The PRD demands a Calling state, a plain-language which-version-wins bubble, and consequences that leave the Project consistent either way. The spines give it: nothing. No flow, no bubble copy, no board status treatment (WAITING? something else?), no row in the notification matrix ("{Character} needs your OK"?). Whoever builds this will improvise, and improvised merge UX is how you get a technical merge screen with a wooden border.

Fix: add a "Two orders collide at serving" key flow mirroring UJ-3's shape — Calling + Voice Line + notification, one either/or bubble, board shows WAITING, choice recorded in chat.

---

## MEDIUM

### M-1. First Run has no path for "Don't Allow" — and the mock holds the town hostage
**Where:** EXPERIENCE.md First Run flow step 4 (only a "Sounds good" button); `.working/mock-firstrun.html` (the "Open the town!" button is `disabled` until "Allow notifications" is clicked). **PRD:** FR-19, FR-7, §2 (non-technical user, "no technical steps, ever").

Two problems in one room. First, the mock gates entry to the town behind granting notifications — that's coercion, not a polite ask, and it's exactly the dark-pattern texture this product exists to avoid. Second, neither spine says what happens when Maksym clicks "Sounds good" and then hits **Don't Allow** on the real macOS dialog — or denied it months ago in System Settings. A non-technical user is now stranded with no notifications, no explanation, and no idea the app can't holler. SM-2 (zero missed needs) quietly loses a leg. Fix: the town opens regardless; Krabs reacts warmly to a denial ("No hollerin', then — watch for me red dots!") and the spec says where to re-ask later.

### M-2. The first-run mock dropped the assets step
**Where:** `.working/mock-firstrun.html` — three steps (welcome, folder, notifications; "● ○ ○"), no asset offer. **PRD:** FR-19 ("and (optionally) placing assets"), FR-18; EXPERIENCE.md's own First Run step 5 ("Show me where pictures go" / "Later", review M-6).

EXPERIENCE.md promises a five-beat scene ending with Krabs offering to show where pictures go. The mock ships three beats and buries the assets beat entirely. Every picture and sound being *Maksym's own* is the emotional heart of this product (§1: "Every picture and sound is Maksym's own") — the moment that invites him to bring his art is not a step you trim for a cleaner wizard. Fix: mock gets the fourth step back, matching EXPERIENCE.md.

### M-3. Placeholder Voice Lines aren't specced as per-Character distinct — so "know by ear" is dead at launch
**Where:** DESIGN.md (stand-ins mentioned only generically), EXPERIENCE.md sound matrix (no stand-in sound spec). **PRD:** FR-6 ("clips are distinct enough to identify the Character by ear"), §2.1 contextual JTBD ("know *by ear and by glance* which lane needs attention"), §6.2 (real clips ship *after* v1 — placeholders are the launch experience).

Follow the timeline: the MVP ships with placeholder sounds, real clips come later. If all three Characters fall back to the same labelled placeholder tick, then on day one — the day that decides SM-1 — Maksym cannot tell by ear who's calling. The by-ear promise isn't a nice-to-have; it's one of the four Jobs To Be Done. Fix: one line in the spec — placeholder sounds are per-Character distinct (three different neutral tones is enough), just as picture stand-ins are per-Character emoji.

### M-4. What does the board say after "Send it back"? The mock invented a fifth status
**Where:** `.working/mock-sendback.html` ("↩️ The board shows this order as taken back"); EXPERIENCE.md Orders Board statuses (silent on post-sendback state). **PRD:** FR-10 (the lifecycle is WAITING/COOKING/SERVED/BURNED — a *binding* vocabulary per §3), FR-16.

The mock casually mentions a "taken back" board state that exists nowhere in the PRD's binding status set, and EXPERIENCE.md never says what a sent-back order shows on the paper. Does it stay SERVED (a lie), vanish (history says the board keeps retired lines), or get a new word? Small hole, but it's a hole in a *binding* vocabulary, and the two artifacts already disagree through it. Fix: decide in EXPERIENCE.md — my recommendation: sent-back orders join the retired history like scrapped ones, with whatever word is chosen added to FR-10's set deliberately, not by mock accident.

---

## LOW

### L-1. Volume-by-long-hover violates the spine's own banned list
**Where:** EXPERIENCE.md Component Patterns, Mute/volume ("long-hover/secondary shows a small volume slider") vs. Interaction Primitives ("Banned: … right-click-only actions, … hover-only information"). **PRD:** FR-8.
The detective notes when a witness contradicts himself two paragraphs apart. Make volume a plain click affordance (click opens a tiny wooden slider popover) and the file agrees with itself.

### L-2. Relaunch-resume has no row in the sound matrix
**Where:** EXPERIENCE.md "App quit / relaunch" vs. the Sound & notification matrix. **PRD:** §9 pause-on-quit (confirmed decision), FR-6.
On relaunch, paused Characters go Calling ("Want me to pick this back up?"). Do they each play a Voice Line and fire a notification the moment the app opens — three staggered hollers before Maksym's coffee? The matrix doesn't say. My read: relaunch-resume should be dot + bubble only (Maksym is already looking at the app); say so.

### L-3. FR-2's drop-in flow has no UX beyond a reserved accent and a street position
**Where:** DESIGN.md (Sandy's accent + position tokens); EXPERIENCE.md (FR-2 listed in the IA table, never elaborated). **PRD:** FR-2 + its [ASSUMPTION] ("config-plus-files affair Maksym can do with guided help").
Sandy's out of MVP, so this is low — but FR-2 is an in-PRD feature and "guided help" is a UX surface (where does the Character list live? what does the guidance look like?). A paragraph now saves a redesign when her pictures arrive, which the PRD calls emotionally load-bearing.

### L-4. Handout mock makes EXPERIENCE's failure case unreachable
**Where:** `.working/mock-handout.html` (input bar hidden until a Character is picked) vs. EXPERIENCE.md UJ-1 failure ("sending with no Character picked → Mr. Krabs asks… nothing is lost from the input"). 
Two different designs for the same moment. Either is fine — hiding the input is arguably the cleaner one — but the spine and the mock must tell the same story, because the failure copy ("Which of me crew is this for?") only exists in one of them.

### L-5. Mocks render Allow/Try-again in plain wood; DESIGN.md says Character accent
**Where:** DESIGN.md In-chat action buttons ("Allow / Try again fill with the Character's accent; Deny / Scrap it fill with wood") vs. `.working/mock-burned.html` and `.working/mock-sendback.html` (all buttons plain wood).
Cosmetic, but DESIGN.md is supposed to be the token law and the mocks are supposed to demonstrate it. Align one to the other.

---

## The emotional core — does the town stay cozy?

Mostly, yes, and I want that on the record. Patrick's burned-order copy ("Uh oh. I burned this one — the internet cut out halfway. Nothing broke, your project is untouched") is the PRD's §8 bar hit dead center: joke first, honest sentence second, two plain choices. Krabs' first-run pirate patter is a scene, not a settings form — though the Back/Next/step-dots bar is the one place wizard chrome peeks through the curtain; keep it if it stays this quiet. The Do/Don't tables in both spines actively defend against terminal-ness. The one genuine threat to coziness in this whole file is C-1: a town that demands a thumbs-up for every plate it serves isn't a town of friends, it's a boss. Kill the gate and the case is closed.

## Verdict

**Approve with required changes.** C-1 must be fixed before these mocks inform a single line of build; H-1 and H-2 must be resolved in EXPERIENCE.md before architecture inherits the holes. The mediums are quick edits. The spines' bones are excellent — they didn't just transcribe the PRD, they defended it in most places better than PRDs usually get defended. Now make the mocks tell the same story the spine does.

**Counts:** 1 critical · 2 high · 4 medium · 5 low.
