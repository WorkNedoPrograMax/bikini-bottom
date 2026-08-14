# Reconciliation: REQUIREMENTS.md vs PRD

Input: `/Users/maksymloia/development/code/bikini-bottom/REQUIREMENTS.md` (locked 2026-07-12)
Against: `prd.md` + `addendum.md` in this folder.
Excluded per instructions (known deliberate deviations): "waiting" → "Calling" rename; Sandy deferred to drop-in; auto-land + "Send it back" serving; BURNED status and Calling-covers-trouble additions.

## Gaps found

### G1. Voice clip on *every* state change was narrowed to Calling-only (contradiction / weakening)
- **Source** (REQUIREMENTS.md §5 Voices): "**When a character changes state** it plays its own voice clip — distinct per character, Warcraft-peon energy."
  Every transition speaks — including idle→working when a job is handed out (very much the Warcraft-peon pattern: "Work work!").
- **PRD** (FR-6, §4.3 description): voice plays only "when it starts Calling"; and the testable consequence *actively contradicts* the source: "Handing out a Job produces **no voice interruption** (a subtle acknowledgment sound at most)."
- **Assessment:** This is not among the listed deliberate deviations. It may well be the right cozy call (don't interrupt on assignment), but the PRD presents it as if it were the source requirement rather than a change. Needs Maksym's explicit sign-off or a "confirmed by Maksym" note like the other decisions carry.

### G2. "Warcraft-peon energy" voice direction dropped (qualitative tone loss)
- **Source** (§5): clips should have "distinct per character, **Warcraft-peon energy**" — a specific creative direction: short, characterful, funny acknowledgment barks.
- **PRD** (FR-6): keeps only the measurable half ("distinct enough to identify the Character by ear") and the prominence of the finished call. The peon-energy vibe — the *feel* of the clips — appears nowhere in prd.md or addendum.md, so whoever sources/records the placeholder or real clips downstream loses the brief.
- **Fix:** one clause in FR-6 or §8 Aesthetic restores it.

### G3. Unseen-dot clearing rule changed from "opening clears it" to "resolved clears it" (unflagged behavioral change)
- **Source** (§3 Seen/unseen): "A finished lane keeps its red dot **until Maksym opens that lane; opening clears it**."
- **PRD** (Glossary "Unseen Dot", FR-4): the dot "clears only when the *need* is resolved... **not merely because a window was opened**"; consequence: opening and closing without resolving leaves the dot.
- **Assessment:** For the finished case this is a strengthening (and follows naturally from the sanctioned permission/trouble additions), and "result seen" on open is nearly equivalent — but "seen **and served/acknowledged**" hints at an acknowledgment step beyond opening, which the source explicitly did not require. The rename deviation was flagged in the glossary; this semantic change was not. Low severity; worth a one-line confirmation.

### G4. The "agreed foundation" was demoted to a non-contractual addendum (silent weakening of status)
- **Source** (§Under the hood — "**agreed foundation**"): Claude Agent SDK (TypeScript), one Claude Code session per lane, ideally per-lane git worktrees, Electron/Tauri shell, local audio, native notifications.
- **PRD:** the content survives verbatim in addendum.md — but the addendum opens with "**Not part of the build contract**." prd.md itself mandates only the observable outcomes (FR-17 isolation, §9 platform) and never binds the Agent SDK or per-lane-session model. Electron-vs-Tauri being open matches the source, but the SDK and session-per-lane items were *agreed*, not open.
- **Assessment:** Architecture could now legitimately pick a different foundation without violating the contract. If the SDK/session-per-lane agreement is meant to bind, it belongs in prd.md §9 Constraints (or the addendum's framing should say "agreed, binding — mechanics only elaborated downstream").

## Verified as fully carried over (no action)
- Street scene: daytime, straight-on, Maksym's background, characters in front of homes; mockup as binding visual source of truth (FR-1, §0, §8).
- Drop-in extensibility for Sandy/Mr. Krabs assets and houses (FR-2, FR-18).
- Three states shown by the picture itself, no labels/pills as primary signal; static pictures as-is (no added wiggle), gifs bring their own motion (§4.2, FR-3).
- Pulsing red dot + nudging speech bubble; "nothing finished may ever be missable" (FR-4, SM-2).
- Asset slots for every visual and sound, one voice clip per character, never fetched/AI-generated, Nickelodeon ownership + private-personal framing (FR-18, §5, §9).
- Finished call most prominent; simultaneous calls staggered, never overlapping (FR-6).
- macOS notifications: who + one-line summary, click brings app/lane forward (FR-7). (The "like Telegram's" simile dropped — treated as an illustrative example, not a requirement.)
- Orders Board: hidden by default, 📋 / M, Galley Grub paper styling (tan paper, nailed corners, dark-red hand-painted title), dotted leaders, WAITING red / COOKING brown / SERVED green (FR-9, FR-10).
- Work Window: wooden frame, parchment, cartoon-outlined bubbles, portrait + per-character accent colour, paste-a-task, real Claude conversation, "must never feel like a terminal" (FR-11, §5, §8).
- Mr. Krabs = home base where work is handed out (FR-15, Glossary).
- Out-of-scope items: night street, wider background, publishing/sharing (§5, §6.2).
- Under-the-hood facts themselves (SDK, worktrees, shell options, local audio, native notifications) present in addendum — see G4 for the status concern only.
