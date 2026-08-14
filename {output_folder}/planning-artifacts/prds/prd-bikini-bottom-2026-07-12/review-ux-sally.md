---
title: Bikini Bottom PRD — UX Review (Sally)
reviewer: Sally, UX Designer
date: 2026-07-12
verdict: Strong emotional spine; not yet shootable — the opening scene and one trust-breaking beat are missing.
---

# UX Review: Bikini Bottom PRD

Picture the film this PRD is pitching: a warm street, friends who call your name when dinner's ready, nothing ever lost. I believe in that film. The PRD nails the *middle* of the movie — states, dots, voices, the cozy chat. What it hasn't shot yet is the **opening scene** (Maksym's very first launch) and one beat where the camera lies to him (a cleared dot over an unanswered question). I also read the mockup's script line-by-line — the JS, not just the vibes — and it contradicts the PRD in a few places the PRD claims to match.

I am critiquing coverage, not redesigning. Every finding cites a PRD section.

---

## Critical

### C-1. The cleared dot over an unanswered permission question — "nothing missable" breaks (FR-4, FR-10, §2.1 Trust)
The scene: Squidward asks for an OK. Dot pulses. Maksym opens the Work Window — *the dot clears on open, by FR-4's own rule* — reads the Allow/Deny bubble, gets pulled into a meeting, closes the window without answering. Now the lane is stalled, the question is unanswered, and the street shows **no signal at all**. The one thing §2.1 promises ("never wonder silently") fails exactly at the scariest moment. The PRD defines dot-clearing by *window opened*, but the honest trigger for a permission ask is *question resolved*. FR-4 and FR-10 never reconcile this. One sentence fixes it; its absence is a trust hole.

### C-2. There is no opening scene: first run and Project setup are undefined (FR-13, §4.6, §6.1)
FR-13 says "the one **configured** Project" — configured by whom, where, when, with what words? Maksym is explicitly non-technical (§2). The PRD's first journey (UJ-1) starts with the town already wired to a Project. Nothing covers: first launch (empty town, no Project, macOS asking "allow notifications?" in system dialect), how Maksym points the app at his folder of work without ever seeing the word "repository," or what the Krusty Krab says when no Project exists yet. For a product whose entire audience is one first-run, the first-run is the film's cold open — and it's not in the script.

---

## High

### H-1. UJ-1's core interaction has no visual reference — the binding mockup doesn't show it (FR-12, §0, §8)
§8 declares the mockup the binding visual reference, but open Mr. Krabs in the mockup: it's the same chat window as everyone else — one input, "Tell Mr. Krabs what to do…", **no character picker, no availability display**. FR-12's "chooses among currently-Idle Characters" and "busy Characters are visibly unavailable" is pure prose with zero visual definition. The most important flow in the product (UJ-1, handing out work) is the one scene the locked mockup never storyboarded. The PRD should flag this as a gap for the UX spec instead of implying the mockup covers it.

### H-2. "WAITING" means two different things, and the mockup proves the collision (§3 Glossary, FR-8, addendum design note)
Glossary: the Character State **Waiting** = finished-or-needs-you. Orders Board: status **WAITING** (red) = handed-out-not-yet-started (per the addendum). Same word, opposite meanings — one is "the end, come look," the other is "hasn't begun." And the mockup already tripped on it: its board line "Fix the refund message — waiting" (styled `s-hey`, red) belongs to Squidward, who is in the *needs-you* state, i.e. the mockup uses board-WAITING for the glossary's Character-Waiting. The addendum even admits WAITING may never occur in practice. §3 orders downstream docs to use terms verbatim — this term will be used verbatim *wrongly*. Rename one of them or cut board-WAITING for v1.

### H-3. Voice on *every* state change contradicts the source inputs and risks noise fatigue (FR-5, §4.3 vs CONTEXT.md)
CONTEXT.md scoped voices to "finishes **or needs you**." REQUIREMENTS.md item 5 loosened it to every state change; the PRD followed. Play the day forward: Maksym hands out three jobs — three voice lines. Each finishes — three more. Each follow-up flips COOKING again — more. With five lanes, the street becomes a doorbell choir. The PRD's own §4.3 says the finished-call "is the most prominent," implicitly admitting a hierarchy it never specifies. Coziness (SM-C1) needs the *quiet* transitions (Idle→Working, Waiting→Idle) defined as soft or silent — one line in FR-5 would do it.

### H-4. The Job lifecycle has no failure beat (§3 Job, FR-8, FR-3)
WAITING → COOKING → SERVED assumes every dish comes out of the kitchen. What's on screen when a Lane errors, the session dies, or Claude gives up mid-job? No State picture, no board status, no notification rule covers it. For a non-technical user the worst UX is a Character frozen in "Working" forever while nothing is actually cooking — it silently violates SM-2's "nothing missable." The PRD needs at least: a failed Job surfaces as Waiting + plain-language explanation in the chat. (It may reuse the Waiting state — but say so.)

### H-5. Waiting→Idle transition timing is ambiguous, and the mockup behaves differently than FR-4 reads (FR-4)
FR-4: opening the Work Window clears the dot "and the Character returns to Idle (job served) or shows the permission question." In the mockup's `openLane()`, opening removes only `unseen` — Squidward keeps his *waiting* picture indefinitely after being seen. So: does the street flip to Idle the instant the window opens (Maksym looks up mid-read and his friend has already walked away — cold), when the window closes, or when a follow-up/no-follow-up decision resolves? Three defensible films; the PRD shot none of them, and its binding mockup contradicts the FR's letter.

---

## Medium

### M-1. Board lines: the mockup closes, the PRD navigates (FR-8 assumption vs mockup)
FR-8 assumes clicking a Job line opens that Character's Work Window. In the mockup, *any* click inside the board — lines included — closes the board (`board.addEventListener('click', …remove('show'))`). The PRD tags this [ASSUMPTION] honestly, but should note it *conflicts with*, not merely "isn't demonstrated by," the binding reference — otherwise a literal-minded implementer has two truths.

### M-2. No mute, no volume, no quiet hours (§4.3, §9)
A product whose signature feature is *sound* has zero words about controlling it. One line buys years of goodwill: a mute/volume affordance (even just respecting system volume plus one visible mute) and whether voices play while the Work Window for that Character is already open and focused. Comfort basics; absence will be felt in week one.

### M-3. On-street labels: the mockup shows them, the PRD's principle half-forbids them (§4.2, FR-1)
The mockup renders "Patrick · working…" captions under every Character. §4.2 says State is expressed "never by labels or pills **as the primary signal**." So are the captions in or out? They're in the binding visual reference, they're helpful for early days (before Maksym learns each picture), and no FR mentions them. Decide their fate in one sentence — keep as secondary signal, or cut.

### M-4. The empty town has no feeling assigned (§4.1, FR-7)
First launch aside (C-2): what does an all-Idle town with zero Jobs feel like? What does an empty Galley Grub board say — a blank paper menu reads as broken, not cozy. ("No orders yet — ring the Krusty Krab!" is one line of copy the PRD never asks for.) Empty states are where coziness is cheapest to win and the PRD spends nothing there.

### M-5. App quit / Mac sleep mid-COOKING is unspecified (FR-9, FR-4)
FR-9 covers closing the *window* ("never stops the Job") and FR-4 covers dot persistence across restart — but quitting the *app* mid-job is between the two and covered by neither. Does the job pause, die, or resume on relaunch? For SM-2's promise, the PRD owes a product-level sentence (architecture can decide *how*, product must decide *what Maksym experiences*).

### M-6. "Drop files in" — where, and how does he find it? (FR-14, FR-2)
Asset Slots are "named file locations" Maksym fills — but nothing says how a non-technical user discovers the folder, learns the required names, or verifies success beyond relaunching. FR-2 assumes "guided help" for characters; FR-14 has no equivalent. Even "the app offers a 'show me where pictures go' button that opens the folder" as a requirement would close it.

### M-7. Does the Orders Board ever clear? (FR-8, FR-11)
Jobs accumulate; SERVED lines apparently live forever, and FR-11 can resurrect them. After two weeks the paper menu is a scroll. Retention/archival of served orders is a product decision (the diner metaphor even suggests one — yesterday's menu gets thrown away), and the PRD is silent.

---

## Low

### L-1. The M hotkey fires while typing (FR-7, mockup script)
The mockup's keydown listener has no focused-input guard: typing "make the title bigger" in the Work Window toggles the Orders Board on the "m". A mockup bug, but FR-7 canonizes the hotkey without scoping it ("M when no text field is focused"). One clause.

### L-2. The 🎭 preview button's fate is unstated (§8, mockup)
The mockup's mood-preview button is demo scaffolding, but the PRD says the app "should look and behave like" the mockup and never excludes it. Say it's out (or, honestly, it's a lovely hidden toy — but *say*).

### L-3. Reduced motion is in the mockup, not the PRD (§4.2)
The mockup already respects `prefers-reduced-motion` — stopping the pulsing dot and bouncing bubble. The PRD dropped this. One line preserves it (and note the dot must remain *visible* when its pulse stops, or the accessibility fallback breaks SM-2).

### L-4. First macOS notification-permission ask isn't staged (FR-6)
macOS will interrupt the very first session with a system permission dialog — the least cozy possible moment left undirected. Worth one line on when it's triggered (ideally right after the first job is handed out, when a notification has obvious value) so it lands in-world rather than as a cold system jump-scare. (Pairs with C-2.)

### L-5. Nudge persistence tone (FR-4, §4.2)
The Waiting combo — pulsing dot + bouncing bubble + hopping picture, forever, plus a notification — is a friend waving; left unbounded it's a friend *nagging*. The PRD should state the voice line plays once per transition (not on repeat) and that the visual nudge is the only persistent element. The mockup already behaves this way; the PRD should lock it in words.

---

## Tally

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 5 |
| Medium | 7 |
| Low | 5 |

## Closing note

The PRD's assumption-tagging discipline is genuinely excellent — every leap is labeled and indexed, which made this review fast. The vision, glossary, and anti-goals are the strongest I've seen at this scale of product. Fix the two Criticals before UX spec work begins (both are one-scene additions, not redesigns), reconcile the five mockup-vs-PRD contradictions explicitly, and this becomes a script worth shooting.

— Sally
