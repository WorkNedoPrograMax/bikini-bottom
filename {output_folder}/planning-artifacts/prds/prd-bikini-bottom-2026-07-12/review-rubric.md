# PRD Quality Review — Bikini Bottom

Reviewed 2026-07-12 against the PRD quality rubric. Stakes calibration: hobby/personal, single user, chain-top (feeds UX → architecture → stories). A 2–4 page PRD is the correct size here; length is not a finding.

## Overall verdict

This is a strong hobby-stakes PRD: it has a real thesis ("The point is not efficiency; it's affection," §1), disciplined assumption tagging (10 inline, all indexed), honest de-scoping, and FRs whose consequences are mostly genuinely testable. What's at risk is the Job lifecycle's semantics — SERVED vs. work-actually-landed is undefined, the WAITING status the PRD asserts may never occur per the addendum's own note, and COOKING-Job survival across app quit is unstated — exactly the seams story creation will hit first. Fix those three and correct two mislabeled FR cross-references, and this is ready to feed downstream.

## Decision-readiness — strong

Decisions are stated as decisions, not hedged: one shared Project is named as "deliberate v1 cut (Maksym chose one shared Project)" (§6.2); one-Job-per-Character with "unavailable rather than queueing" is committed in the Glossary (§3 Job); "folded technical detail (FR-9) is the ceiling" (§5) draws a hard line on the terminal question. The one `[NOTE FOR PM]` sits at a real tension — Sandy's deferral is called "emotionally load-bearing" (§6.2) rather than quietly parked. Open Questions 3 and 4 are genuinely open with owners and a product bar ("preserves 'Maksym never merges'", §10.4). Open Questions 1 and 2 are asset-delivery reminders rather than decisions, but at these stakes that's a reasonable use of the section.

## Substance over theater — strong

No persona theater — exactly one user, and §2.1's Jobs To Be Done each drive visible features (the "Trust" job maps directly to FR-4/FR-6/FR-10). The Vision could not swap into another PRD: "each parallel lane of work is a Character standing on Conch Street" and "every picture and sound is Maksym's own" (§1) are this product only. No NFR boilerplate — constraints (§9) are product-specific (Nickelodeon copyright, macOS-only, no metering). The counter-metric SM-C1 ("does the town stay cozy?") is an unusually honest guard for a hobby PRD. SM-3 ("Maksym smiles. Genuinely.") is unfalsifiable as written, but at single-user hobby stakes it is honest rather than theatrical, and it's flanked by two checkable metrics.

## Strategic coherence — strong

The thesis is explicit and load-bearing: coziness-over-efficiency (§1), with the "never missable" trust guarantee as its spine. Feature ordering follows the thesis — the Town, States, and Voice Lines (the affection layer) are in MVP alongside the functional core, while Sandy, night street, and multi-Project are cut with stated reasons (§6.2). SM-1 validates the bet directly (Maksym "hasn't gone back to terminals" after a month) rather than measuring activity, and SM-C1 is a real counter-metric. MVP scope kind is coherently *experience*: the cuts are cosmetic-or-asset-blocked, never trust-guarantee cuts.

### Findings
- **low** SM-2 has an unfalsifiable escape clause (§7 SM-2) — "without Maksym having chosen to ignore it" makes any miss excusable after the fact. *Fix:* restate as the mechanism guarantee it already implies: "no SERVED Job's Unseen Dot or Orders Board line ever disappears without Maksym opening that Work Window" — which FR-4 makes checkable.

## Done-ness clarity — adequate

Most FRs carry genuinely testable consequences — "within a second" (FR-3), "the dot never clears by itself — not on app restart, not with time" (FR-4), "staggered, never overlapping" (FR-5), "closing the window never stops the Job" (FR-9). The mockup as binding visual reference (§8) does real work absorbing what would otherwise be adjective-only aesthetics. But the Job lifecycle — the PRD's central noun — has three soft spots a story writer will trip on, listed below. This is the dimension the rubric says to be unforgiving on, hence adequate rather than strong.

### Findings
- **medium** SERVED is ambiguous between "Claude finished" and "work landed in the Project" (§3 Job; FR-8; FR-13) — the lifecycle "WAITING → COOKING → SERVED" is defined by Lane completion, but FR-13 separately requires results to "land back in the Project" via an undecided mechanism (Open Question 4). An engineer cannot tell whether a Job may show SERVED (green) while its work hasn't landed yet. *Fix:* one sentence in §3 Job pinning SERVED's meaning (e.g. "SERVED means the result is readable in the Work Window; landing in the Project is part of SERVED / happens by [architecture decision] before SERVED shows").
- **medium** WAITING may be an unreachable status the PRD nonetheless mandates (FR-8; §3 Job; addendum "Design notes") — FR-8 requires rendering "WAITING (red)", yet both UJ-1 and FR-12 have new Jobs appear "as COOKING", and the addendum itself says "in practice Jobs may go straight to COOKING… UX spec should decide whether WAITING ever appears in v1." The build contract asserts a state its own addendum doubts. *Fix:* either define when a Job is WAITING (e.g. handed out while the Lane is still spinning up) or move WAITING to an explicit open question in §10 rather than leaving the contradiction split across the two documents.
- **medium** COOKING-Job behavior on app quit is unspecified (FR-4; UJ-1) — FR-4's restart consequence covers only Waiting Characters ("After a restart, a Character that was Waiting is still Waiting"), and UJ-1 promises "the job keeps cooking" only for closing the *window*. Whether quitting the app (or the Mac sleeping) kills, pauses, or resumes a COOKING Job is a product-level trust question, not an architecture detail — it decides whether Maksym can close the app mid-Job. *Fix:* one consequence line stating the intended behavior (even "quitting the app pauses cooking Jobs; they resume on relaunch" or an honest `[NOTE FOR PM]`).
- **low** FR-1's "no other chrome that reads as 'tech tool'" is subjective as a testable consequence — largely mitigated by the binding mockup (§8), so acceptable, but the phrase itself can't be verified. *Fix:* anchor it to the mockup explicitly: "no chrome beyond what the mockup shows."
- **low** Unspecified edges: what Home Base shows when zero Characters are Idle (FR-12), and what happens when Maksym sends a follow-up to a *Waiting* (unseen) Character rather than an Idle one (FR-11's consequence covers only "an Idle Character with a past conversation"). *Fix:* one line each, or defer explicitly.

## Scope honesty — strong

The Non-Goals section (§5) does real work — each entry blocks a plausible silent assumption ("Not a Claude Code replacement for programmers… no tabs, panes, keybinding systems"). All 10 `[ASSUMPTION]` tags are inferences the user plausibly didn't confirm (queueing behavior, who writes the notification summary, clickable board lines), tagged where they bite and indexed in §11 — the roundtrip is clean. De-scoping is done in the open with reasons and revisit triggers (§6.2). Open-items density (4 OQs + 10 assumptions + 1 NOTE FOR PM) is appropriate for hobby stakes on a chain-top PRD; the two OQs that gate build (3 and 4) both name where they get resolved.

## Downstream usability — strong

The Glossary (§3) is the PRD's best downstream feature: capitalized terms (Character, Lane, Job, State, Unseen Dot, Asset Slot, Risky Action) are used verbatim and consistently across FRs, UJs, and SMs, with the explicit instruction "Downstream documents must use these terms verbatim." IDs are contiguous and unique (FR-1..14, UJ-1..3, SM-1..3 + SM-C1). Each feature section stands alone with "Realizes UJ-n" back-references. UJs all have a named protagonist (Maksym). The addendum correctly quarantines SDK/worktree depth out of the build contract while keeping it findable — including the session-per-cwd gotcha that directly protects FR-11. The blemishes are the mislabeled cross-references below (in Mechanical notes) — they resolve to *existing but wrong* FRs, which is worse than a dead link for a source-extracting workflow, but they're two-character fixes.

## Shape fit — strong

Correctly shaped for a hobby/solo, single-operator, chain-top product: capability-spec FRs with exactly three UJs, all load-bearing (handout, callback, permission — the three interaction loops the whole app consists of). No UJ padding, no persona roster, no compliance scaffolding. Success metrics are appropriately operational/personal rather than market-facing. Deferring the Safe/Risky boundary and merge mechanics to architecture while pinning the product bar ("Maksym never merges") is the right division of labor for a PRD that feeds BMAD architecture next.

## Mechanical notes

- **Wrong FR cross-references in FR-1 (§4.1):** "Characters open their Work Window (FR-10)" should be **FR-9** (FR-10 is Permission asks); "the Krusty Krab opens Home Base (FR-13)" should be **FR-12** (FR-13 is One shared Project). Both point at the right *sections* but the wrong FR numbers — silently misleading for extraction.
- **§0 section pointer stale:** "indexed in §9" — the Assumptions Index is **§11**; §9 is Constraints and Guardrails.
- **SM-3 reference loose:** "Validates §Aesthetic" — section is titled "§8 Aesthetic and Tone"; resolvable but should be "§8".
- **Assumptions Index roundtrip: clean.** 10 inline `[ASSUMPTION]` tags ↔ 10 index entries in §11; every entry names its home section/FR.
- **Glossary drift: none found.** "Job (aka Order)" alias is declared in §3 and "Order" appears only inside "Orders Board"; diner statuses (WAITING/COOKING/SERVED) are cased consistently everywhere.
- **ID continuity: clean.** FR-1..FR-14 contiguous, UJ-1..UJ-3, SM-1..SM-3 + SM-C1; no duplicates.
- **Fidelity to locked inputs:** PRD matches REQUIREMENTS.md's nine commitments; the only additions beyond the lock (folded technical detail, clickable board lines, follow-up-reuses-Job) are all correctly `[ASSUMPTION]`-tagged.
