---
title: Architecture Spine — Product Value-Fidelity Review
reviewer: John (PM, JTBD-first) with Sally (UX coziness lens)
target: ARCHITECTURE-SPINE.md (bikini-bottom, 2026-07-12)
binding sources: prd.md (final), EXPERIENCE.md (final)
date: 2026-07-12
verdict: CHANGES REQUESTED — structurally strong, but three PRD promises are silently weakened and one is unguaranteed
---

# Value-Fidelity Review — Does the spine still deliver the PRD's promises and keep the town cozy?

**The lens.** I'm not grading the engineering. I'm asking one question per invariant: *if this ships exactly as written, does Maksym get what the PRD and EXPERIENCE promised him — no jargon, nothing missable, no lost work, cozy from minute one?* Where architecture's convenience quietly bought itself simplicity at the cost of Maksym's experience, I flag it. Severity = size of the dent in the promised experience, not engineering effort.

**Headline.** The spine's spine is good. AD-1/AD-2/AD-4 (main-authoritative, event-sourced, intents-in/snapshots-out) make "nothing missable" and "survives quit/crash/sleep" *structural* rather than best-effort — exactly right, and better than the PRD dared hope for. But four things trade away value Maksym cares about, three of them at the two scariest, most trust-loaded moments in the product: paying for Claude, and two Characters' work colliding.

---

## Findings

### F1 — [HIGH] AD-8 quietly changes the cost model AND smuggles a technical step into a First Run the UX spec says has none

**Promise at risk:** FR-19 ("goes from first launch to handing out a first Job *without touching anything technical or reading documentation*"); §9/§11 cost assumption ("Maksym's existing Claude Code subscription/limits apply and suffice; the app adds no separate metering"); SM-1 ("a month later he uses it daily instead of terminals").

AD-8 is honest *to the builders* — it flags that the SDK forbids the claude.ai subscription auth model for third-party apps, and it puts a `safeStorage`-held `ANTHROPIC_API_KEY` in. Good that it surfaced. But three consequences are under-weighted, and the spine files the whole thing under "auth *ergonomics*" (Deferred) when it is not ergonomics — it is product substance:

1. **It is a technical step, and the UX spec has no slot for it.** EXPERIENCE.md's First Run flow is six steps: folder (mandatory), notifications (optional), assets (optional), done. There is *no API-key step anywhere in it*. AD-8 mandates one. For a non-technical user, "paste an API key" is the *most* technical thing in the whole product — and obtaining one (console signup, org, generate key, attach a credit card) is worse than pasting it. This is a direct contradiction of FR-19's "not one technical word was seen," and the architecture introduced it without the UX spine having a design for it. That contradiction is currently invisible — it lives only in the spine.

2. **It changes the cost model from flat to metered.** The PRD's binding assumption is that his *existing Claude Code plan* covers usage. An API key is pay-per-token against a balance he funds himself — a different wallet, with marginal cost on every Character-hour. That is precisely the kind of quiet anxiety that erodes SM-1 ("he uses it *daily*"): daily use now has a running meter he didn't have in the terminal.

3. **It makes shipped product copy false.** UJ-4 and EXPERIENCE.md's burned-order example both say, verbatim, *"I hit Claude's hourly limit. It'll reset within the hour."* "Hourly limit that resets" is *subscription* language. Under an API key there is no resetting hourly limit — there's a credit balance and rate limits. The town would tell Maksym a comforting lie. The Voice-and-Tone table's own rule ("system facts are always honest underneath the flavor") breaks here.

**Why HIGH:** this is the one place the spine itself admits "the product premise depends on an external policy," yet it's labeled a convenience deferral. It touches the entry moment (First Run), the daily-use metric (SM-1), and truthful copy (§8) simultaneously. It is surfaced to *us* but there is no plan to surface it *to Maksym honestly in-product*, and the UX contradiction is unowned.

**What I'm NOT asking for:** a redesign. I'm asking that this be reframed from "deferred ergonomics" to "a PRD-assumption break that needs Maksym's eyes now," with (a) the First Run step reconciled with the UX spine and (b) the "hourly limit" copy family corrected to match the real auth model.

---

### F2 — [HIGH] AD-5's "pick a side" can silently discard work Maksym already accepted — the collision either/or has no "keep both"

**Promise at risk:** FR-16 ("picking either option leaves the Project consistent"); §2.1 Trust JTBD ("never lose work to an invisible technical accident"); SM-3 (the collision is called "the scariest moment in the product" — it must feel *safe*).

AD-5 models a landing collision as an integration conflict "surfaced as one plain either/or (this Character's vs the other's), resolved by choosing a side." EXPERIENCE.md renders this as two buttons: *Keep SpongeBob's / Keep Squidward's* — and its own example is telling: *"Squidward's renames the dishes; mine recolors them. Which stays?"*

Look at that example. **Both changes are desirable and non-contradictory** — a rename and a recolor could happily coexist. Git sees textual overlap and forces a choice; the architecture faithfully passes that forced binary choice up to Maksym. So the "cozy either/or" *manufactures* a loss that didn't need to happen: picking "Keep SpongeBob's" throws away Squidward's recolor — **work that was already SERVED, i.e. already accepted by Maksym.** Re-litigating and discarding already-accepted work, dressed as a friendly two-button question, is exactly the "consistent but lossy" outcome that satisfies FR-16's letter ("leaves the Project consistent") while violating its spirit and the Trust JTBD.

Two structural gaps behind this:
- **No "keep both" affordance.** Tellingly, the *Send-it-back* entanglement bubble in EXPERIENCE.md *does* offer "Send back both, or keep everything?" — but the *collision* choice offers only "Keep X's / Keep Y's." The two overlapping features model conflict differently, and the collision one is the lossier of the two.
- **"A side" is undefined scope.** Is a "side" the file, the hunk, or the *whole order*? Picking a side *per conflicting file* preserves each Character's non-conflicting work; picking a side *per order* can wipe out an entire order's-worth of already-served, non-conflicting changes. AD-5 doesn't say, and "either pick leaves the Project consistent" reads very differently under each. This is precisely the kind of decision the spine exists to pin so story devs don't each invent it.

**Why HIGH:** this is the product's self-declared scariest moment, it touches the Trust JTBD head-on, and the architecture's convenience (conflict ≈ binary choice) directly beats Maksym's experience (he loses good, already-accepted work with no way to keep it). The question in the task — "what if a conflict is genuinely unresolvable by picking a side?" — is answered by the spine's own example: it *forces* resolution by loss.

---

### F3 — [HIGH] Pause-on-quit "resume" is conversation-resume, not turn-resume — a mid-flight turn is killed, and the spine doesn't say what "pick this back up" recovers

**Promise at risk:** §9 ("A COOKING Job *pauses* when the app quits and *offers to resume* on relaunch"; confirmed by Maksym); EXPERIENCE.md relaunch flow ("Want me to pick this back up?" → Keep cooking / Scrap it); FR-11 ("closing the window never stops the Job").

AD-3 pins the resume mechanism well *for conversations*: stable cwd so SDK `resume` reliably finds the session (the per-cwd storage gotcha is a real one and good to have caught). But the PRD promise is about a **Job that was mid-COOKING** — i.e. a turn in flight. The SDK's `resume` restores *conversation history*; it does not restore *an interrupted turn*. When the app quits, the process dies mid-generation / mid-tool-execution — there is no "pause," there's a kill. On relaunch:

- What does "Keep cooking" actually *do*? Re-send the last user message? Nudge the resumed session? The spine is silent.
- Partial work may sit in the worktree (Claude edited 2 of 5 files before the kill). The resumed session doesn't necessarily know it was interrupted, so it may redo, skip, or double up — invisible half-done state, which is the exact thing §9 ("nothing works invisibly") and FR-14 ("no half-done work ever lands") were written to prevent.

AD-2 guarantees the *domain state* around the turn survives (the Job is still COOKING on replay — good). What's unaddressed is the *SDK-turn boundary*: the spine treats "pause/resume" as solved by session-resume when the hard part is turn-level recovery. The word "pauses" in the PRD implies a graceful suspend the SDK does not offer, and the spine neither reconciles that nor flags it.

**Why HIGH (borderline; could be MED with a caveat):** it's a confirmed-by-Maksym reliability guarantee at the center of the "cozy = I can close my laptop and trust it" feeling. If "Keep cooking" silently duplicates or drops work, trust erodes quietly. At minimum this needs an explicit invariant for turn-level recovery, or an honest downgrade of the promise (e.g. "on resume the Character re-reads where it got to and continues" with defined semantics).

---

### F4 — [MEDIUM-HIGH] No watchdog/heartbeat invariant — a *silent* SDK stall leaves a Character "Working" forever, which is exactly what FR-5 forbids

**Promise at risk:** FR-5 ("Killing a Lane's ability to work ... results in a Calling Character and a BURNED order *within a reasonable time* — never a forever-'Working' Character"); §2.1 Trust ("never miss anything ... in trouble"); SM-2 (zero missed needs).

The spine's error story is: "Adapter errors are caught in main and translated to domain events (`JobBurned`)." That covers *thrown errors*. It does **not** cover a *silent stall* — a dropped socket with no exception, an SDK call that hangs, a usage-limit wait that never returns. No exception means no `JobBurned`, means the Character sits Working indefinitely. There is no timeout, heartbeat, or watchdog invariant anywhere in the spine. FR-5's testable consequence ("network off → BURNED within reasonable time") is therefore not structurally guaranteed — it depends on the SDK always throwing, which it won't always do.

**Why MED-HIGH:** "nothing missable" has three cases (finished / asking / trouble); the spine nails the first two structurally but leaves the trouble case exposed to the one failure mode (silence) that FR-5 was specifically written against. Needs an explicit "a Lane that goes quiet past a threshold is auto-BURNED" invariant.

---

### F5 — [MEDIUM] Integration mechanism is unspecified, so "Send it back = revert the Job's commits" and collision behavior are under-defined

**Promise at risk:** FR-16 ("'Send it back' *restores the Project to how it was before that order*"); the "no technical merge, ever" bar.

AD-5 says landing = "integrate its worktree commits into the main line" and Send-it-back = "revert that Job's commit(s)." But it never says *how* the worktree integrates — merge, squash-merge, or cherry-pick. This isn't pedantry; it decides whether Send-it-back is clean:
- Squash-merge → one commit per Job → revert is clean and matches "that order's changes" one-to-one. Cozy.
- Plain merge / multiple commits → reverting an *old* Job's commits when newer served commits touched the same lines produces a *revert conflict* → back to a "pick a side" that, per F2, can discard newer accepted work.

The spine defers "Send-it-back mechanics" (Open Q4) at the *product-choice* level but leaves the *integration model* — which determines whether the clean path is even available — unfixed. Since the spine's whole job is to fix invariants so stories don't each reinvent them, the integration model belongs here.

**Why MED:** doesn't break a promise outright, but it's the load-bearing decision under two features (Serving + Send-it-back) and its absence lets F2's lossiness leak into the undo path too.

---

### F6 — [MEDIUM] The "Project may be a plain folder" case is handled; the "Project is already a real git repo" case is not — and auto-landing writes to the user's history

**Promise at risk:** FR-17 / FR-19 (First Run "silently prepares isolation ... without Maksym doing technical steps"); §2.1 Trust ("never lose work to an invisible technical accident").

The spine handles the plain-folder path (First Run `git init`). But nothing addresses the case where Maksym points the folder picker at a directory that is *already* a git repo with his own history, branches, uncommitted changes, or a remote. In that case the app will, invisibly: create worktrees under it, and — because Serving auto-lands — **auto-commit onto his existing main line** on every finished Job. For a non-technical user who happened to pick a real project, that's the app silently rewriting real git history / colliding with his own uncommitted work. Auto-land (a deliberate, Maksym-approved decision) is fine over app-managed history; over the user's *pre-existing* history it's a trust hazard the spine doesn't fence.

**Why MED:** narrow trigger (he'd have to pick a repo), but the failure is exactly the "invisible technical accident" the Trust JTBD names, and First Run currently has no branch for detecting/handling it.

---

### F7 — [LOW] Append-only event log, never compacted, replayed every launch — cozy should stay *instant*

AD-2 + Consistency ("single event log per app install") + Stack ("append-only JSON ... no DB") means the log grows forever and is folded on every launch. The *board* is capped at 10 lines (good), but the *log* is not. After a year of daily use that's a slow cold start — a small, steady erosion of "cozy = the town is just *there* when I open it." Not a promise-breaker; worth a compaction/snapshot-checkpoint note so launch stays snappy. (Sally's lens: coziness includes *responsiveness*; a spinner on launch is a tiny betrayal.)

---

### F8 — [LOW] New-Job-vs-resume session disambiguation in a shared cwd is asserted, not detailed

AD-3 leans on stable cwd for `resume`; FR-13 also needs a *fresh* conversation on a new Job in that *same* cwd, and Send-it-back/follow-ups need the right prior session. Selecting resume-vs-fresh and tracking which session id belongs to the current Job is a real seam given the per-cwd storage gotcha the spine itself cites. The event log plausibly holds the mapping, but the spine states the outcome without the rule. Low risk; worth one sentence so a story dev doesn't resume when they should start fresh (which would surface to Maksym as "Patrick remembers a job I never gave him").

---

## What the spine gets *right* (so it isn't lost)

- **AD-1 + AD-2 + AD-4** turn "nothing missable" and "survives quit/crash/sleep" from aspiration into structure. Writing the event *before* acknowledging the effect means the visual backstop (dot + board) always survives even if the notification/voice never fired — this is the correct architecture of the promise, and it's genuinely better than "best effort."
- **AD-6** maps Risky/Safe to the exact `canUseTool` seam and defaults safe-narrow to the worktree — faithfully realizes FR-12's "Safe everyday actions never interrupt" without hand-waving.
- **AD-7** (asset resolver + labelled stand-in, never fetch/generate) is a clean, exact realization of FR-2/FR-14/FR-18 and the copyright guardrail. Drop-in Sandy = files + one row is real.
- **Naming discipline** (Glossary verbatim, past-tense events / imperative intents, raw errors never crossing IPC) directly protects §8 tone — no stack trace can reach a cartoon bubble by construction.

---

## Severity counts

| Severity | Count | Findings |
|---|---|---|
| HIGH | 3 | F1 (API-key cost/step/copy), F2 (collision discards accepted work), F3 (turn-resume) |
| MEDIUM | 3 | F4 (no stall watchdog — MED-HIGH), F5 (integration model unspecified), F6 (pre-existing repo) |
| LOW | 2 | F7 (log compaction), F8 (session disambiguation) |

## Verdict

**CHANGES REQUESTED.** The spine is architecturally sound and, on persistence and tone, admirably faithful. But it silently weakens three promises at the product's highest-trust moments — the cost/auth model behind daily use (F1), no-lost-work at a collision (F2), and seamless pause/resume (F3) — and leaves the "never forever-Working" trouble guarantee unstructural (F4). None require a redesign; all require the spine to *pin the invariant or honestly flag the break to Maksym* rather than defer it as convenience. Fix F1–F4 and reconcile F1's First Run step with the UX spine, and this earns a pass.
