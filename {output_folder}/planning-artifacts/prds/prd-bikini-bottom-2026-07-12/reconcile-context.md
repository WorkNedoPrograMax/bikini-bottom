# Reconciliation: CONTEXT.md → PRD (prd.md + addendum.md)

Date: 2026-07-12
Source: `/Users/maksymloia/development/code/bikini-bottom/CONTEXT.md`
Targets: `prd.md`, `addendum.md` (this folder)

Known deliberate deviations excluded per task brief: "waiting"→"Calling" rename; Sandy deferred to drop-in; auto-land serving + "Send it back"; BURNED/trouble handling added; v1 scope = 3 characters + Mr. Krabs.

## Gaps found

### GAP-1. "How to talk to Maksym" guidance dropped entirely
CONTEXT.md §"Who it's for, and how to talk to him" gives three explicit rules for any session working with Maksym:
- **Plain language, product-first, no jargon, no code or file names in chat** — he'll ask if he wants technical detail.
- **Show, don't tell** — he reacts best to seeing and clicking live mockups; build/open things for him rather than describing.
- **Be honest about what's possible; don't oversell.**

The PRD covers plain/warm *product-generated* text (§8 Aesthetic) and honesty inside the app (FR-11 folded detail), but the guidance about how *the people/agents building the app should communicate with Maksym* appears nowhere in prd.md or addendum.md. Downstream BMAD workflows (UX spec, architecture, story review) will read the PRD, not CONTEXT.md, and will lose the "show, don't tell / no jargon in chat / don't oversell" working style. This is exactly the kind of qualitative content the task flagged.
**Suggested fix:** a short "Working with Maksym" note in the PRD (or addendum) carrying the three rules forward for downstream phases.

### GAP-2. Warcraft-peon "catchphrase energy" for Voice Lines weakened
CONTEXT.md: sounds are each character's "own voice line / **catchphrase (Warcraft-peon-style energy)**".
PRD FR-6 keeps "own Voice Line... distinct enough to identify the Character by ear" but drops both the *catchphrase* framing and the *Warcraft-peon energy* reference. That reference is the creative brief for what the clips should feel like (short, characterful, slightly absurd, repeat-summon charm) — useful to whoever selects placeholder clips and to Maksym when he records/collects real ones (Open Question 2). Losing it flattens the requirement to "any distinct sound".
**Suggested fix:** add the flavor to FR-6 / §8 Aesthetic: Voice Lines are catchphrases with Warcraft-peon-style energy.

### GAP-3. One-cohesive-world principle not carried as a guardrail
CONTEXT.md: "Mixing other franchises was considered and rejected — **one cohesive world feels cozier**." The PRD names the cast and says "one world" implicitly, but never records the decision or the principle. This matters most for FR-2 (drop-in Characters): as written, nothing stops a future drop-in from being a non-Bikini-Bottom character, which the source explicitly rejected. The counter-metric SM-C1 ("does the town stay cozy?") is adjacent but doesn't encode the specific ruling.
**Suggested fix:** one line in §5 Non-Goals or FR-2: drop-in Characters stay within the Bikini Bottom world; mixing franchises was considered and rejected.

### GAP-4. Character/lane personalities dropped
CONTEXT.md assigns each lane a personality: **SpongeBob — the eager lane, ready for anything; Squidward — the grumpy "teal" lane; Patrick — the easy lane, simple jobs; Sandy — the science/research lane**. The PRD's Glossary and FR-1 list the characters and houses but carry none of the lane flavor (only a stray "barnacle-head" in UJ-3 and generic "per-Character accent colour" — Squidward's *teal* being the one concrete colour the source named). The personalities inform UX copy (nudge bubbles, trouble jokes per §8), placeholder voice selection, and even how Maksym intuitively routes jobs ("Patrick for simple jobs"). FR structure dropped them.
**Suggested fix:** carry the four one-line personas into the Glossary's Character entry or §8, and note teal as Squidward's accent colour.

### GAP-5. Unseen-marker clearing rule silently changed (source says opening clears it)
CONTEXT.md: the seen/unseen marker "**clears when he opens that lane**". PRD FR-4 deliberately strengthens this: the dot clears only when the *need is resolved* — "Opening and closing the Work Window without resolving the need... leaves the dot in place." This is a genuine contradiction of the source's stated behaviour, not on the known-deviations list, and nothing in the PRD marks it as a change from CONTEXT/REQUIREMENTS (unlike the Calling rename, which is annotated). It is very likely an intentional improvement from the review round (it serves "nothing missable" better), but it should be recorded as a deviation or confirmed by Maksym, since for the common case (finished result, he opens and reads it) the source's simpler rule and the PRD's rule agree — they diverge only for unanswered asks/unacknowledged trouble.
**Suggested fix:** annotate FR-4 the same way the Calling rename is annotated ("CONTEXT/REQUIREMENTS said clears-on-open; strengthened to clears-on-resolve because..."), or get Maksym's explicit OK.

## Checked and NOT gaps (carried faithfully or covered by known deviations)

- Cozy/personal/fun "not a tech tool" spine — Vision, §8, SM-3, SM-C1, Non-Goals all carry it strongly.
- "Person + house, you see the character not just a building" — FR-1 verbatim in spirit.
- 3 states shown by behaviour, not labels/pills — FR-3 + §4.2 description.
- Nothing finished ever missable — FR-4 consequences, SM-2, UJ-2.
- Orders list hidden by default, button or hotkey, Krusty Krab menu/chalkboard style — FR-9/FR-10 (Galley Grub styling matches the locked mockup, which superseded the chalkboard idea).
- Work window = dressed-up Claude conversation, paste a task, warm chat bubbles, never terminal — FR-11, §8, Non-Goals.
- Distinct-per-character sound so you know by ear — FR-6.
- Bring-your-own assets, swappable slots, no hand-drawn art in final product — FR-18.
- Copyright: private/personal, never publish, never fetch/AI-generate show art — FR-18, §5, §9.
- Agent SDK / per-lane git worktrees / Electron-vs-Tauri / local audio / macOS — addendum "Agreed technical foundation" + PRD §9 Platform.
- Flexible number of lanes — FR-2 drop-in.
- Mockup as design source of truth, REQUIREMENTS.md as locked contract — §0.
- Tagline "a cozy home for your work" — PRD subtitle.
- Maksym-owed assets (Sandy & Mr. Krabs pictures/houses, real voice clips) — §6.2 + Open Questions 1–2.

## Summary

5 gaps, all qualitative: dropped how-to-talk-to-Maksym guidance; weakened Warcraft-peon catchphrase brief; unrecorded one-cohesive-world ruling; dropped lane personalities (incl. Squidward's teal); unannotated change to the unseen-marker clearing rule. No functional requirement from CONTEXT.md is missing outright.
