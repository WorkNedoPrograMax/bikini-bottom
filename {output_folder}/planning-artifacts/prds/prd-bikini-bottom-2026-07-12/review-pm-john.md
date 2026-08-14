# PM Review — Bikini Bottom PRD
**Reviewer:** John (PM) · **Date:** 2026-07-12 · **Verdict:** Approve with conditions — fix the criticals before architecture starts.

I read the PRD, the addendum, REQUIREMENTS.md, and CONTEXT.md side by side. Here's my problem with this case file: everybody in this town is having a good day. Three states — Idle, Working, Waiting. Nobody's job ever burns. Nobody's Mac ever sleeps. Nobody ever wants to take an order *back*. A cold case always cracks on the day nobody wrote down. Let's write those days down.

Credit where due: the glossary is tight, the assumptions are indexed and honest, the JTBD framing is real (affection over efficiency — correct call), the non-goals are sharp, and SM-C1 is the best line in the document. This is a good PRD on the happy path. The happy path is not where Maksym loses trust.

---

## Findings

### CRITICAL-1: There is no failure state. A dead Job looks exactly like a working Job.
**Cites:** §3 Glossary (State, Job lifecycle), §4.2 FR-3, §4.4 FR-8.

Walk the scene with me. Patrick is COOKING. The Claude session crashes, the SDK process dies, the network drops, the API errors out. What does Maksym see?

He sees Patrick hammering. Forever.

The State model has exactly three values and the Job lifecycle has exactly three statuses (WAITING → COOKING → SERVED). There is no path for "the kitchen caught fire." For a non-technical user, a Character that *looks* busy while nothing is happening is the single worst trust failure this product can have — worse than a missed result, because SM-2's promise ("nothing finished is ever missable") quietly becomes "nothing *broken* is ever noticeable." The Trust JTBD (§2.1) says "never wonder silently." A stuck lane is exactly that: silent wondering.

**Ask:** Add a fourth outcome to the Job lifecycle (BURNED, or fold it into Waiting with a distinct message — but it must be *distinguishable and testable*), a Character behaviour for it (dot + voice + plain-language "something went wrong, want me to try again?" in the Work Window), and an Orders Board status. One FR, one journey (UJ-4: a job burns), one recovery action (retry in the same conversation). Without this, FR-3's consequence list is untestable against reality.

### CRITICAL-2: Wrong work lands in the Project with no gate and no undo.
**Cites:** §4.6 FR-13, §10 Open Question 4, §2.1 (Trust JTBD).

FR-13 promises "finished work ends up in the Project without Maksym doing technical steps" and Open Question 4 hands the merge *mechanics* to architecture. Fine. But the PRD never answers the *product* question hiding underneath: when Claude's answer is wrong — and it will be, some fraction of the time — does Maksym get a moment to say "no, throw that away"?

As written, the requirement reads as: work lands automatically, Maksym reads a cozy summary he cannot verify (technical detail is folded, FR-9, and he wouldn't parse it anyway), and the shared Project is now silently worse. He has no revert, no "send it back to the kitchen," no product-level concept of rejecting a SERVED order. For a user who *cannot* fix a bad merge himself, an irreversible auto-landing is the most dangerous sentence in the document.

**Ask:** Decide the product stance now, not in architecture: either (a) SERVED work is staged until Maksym says "serve it" (one warm button, still zero technical steps), or (b) auto-land but guarantee a one-click "undo that order" that restores the Project. Either is buildable (the addendum's own SDK notes mention file checkpointing). Pick one and write the FR. Architecture decides *how*; the PRD must decide *whether Maksym gets a say*.

### HIGH-1: Mac sleeps, app quits, laptop lid closes — mid-COOKING behaviour is unspecified.
**Cites:** §2.2 UJ-1 ("closes the window and goes about his day — the job keeps cooking"), §4.2 FR-4, §4.5 FR-9.

FR-4 nails persistence for *Waiting* across restart — good. FR-9 covers closing the *Work Window*. Nobody covered closing the *app*, or the Mac going to sleep, which on a laptop happens every single day without Maksym doing anything. UJ-1's promise ("the job keeps cooking") is only guaranteed for one of the three ways he'll actually walk away. Does quitting the app kill all Lanes? Does sleep suspend a COOKING job and does it resume on wake — or die silently (see CRITICAL-1)? Does a Character that was COOKING at quit come back COOKING, Waiting, or amnesiac?

**Ask:** One testable consequence set: app relaunch and Mac wake each restore every Lane to a truthful State — resumed, or honestly reported as interrupted with a retry offer. "Truthful after sleep" is a product requirement, not an implementation detail.

### HIGH-2: There is no way to stop a Job.
**Cites:** §4.5 FR-9/FR-10/FR-11, §4.6 FR-12.

Maksym hands Patrick an order, and ten seconds later realizes he phrased it wrong — or watches the streaming bubbles go somewhere alarming. His options today: none. There's no cancel, no interrupt, no "belay that order." His only lever is Deny, which requires waiting for Claude to happen to ask permission. The addendum literally documents the SDK's `interrupt()` — the machinery exists; the product requirement doesn't. For a non-technical user, "I can always stop it" is a load-bearing safety feeling; without it, handing out a Job is scarier than it should be, which corrodes the Emotional JTBD.

**Ask:** An FR for stopping a COOKING Job from the Work Window (in-world phrasing welcome), with defined State/Board outcomes.

### HIGH-3: First run is nobody's job. The whole design assumes a git repo Maksym can't create.
**Cites:** §4.6 FR-13 ("the one configured Project"), §9 Platform, Addendum (worktree foundation).

"The one configured Project" — configured by whom, when, how? There's no FR and no journey for the very first launch: pointing the app at a folder, and — the sharper edge — the entire collision-free-Lanes strategy is built on git worktrees, which presume the Project folder *is a git repository*. Maksym does not know what git is; that's the premise of the product. If his folder isn't a repo, day one either fails technically (visible git-speak — violates §5 Non-Goals) or someone else has to set it up off-screen and that dependency is written nowhere. The addendum even records Conductor's untracked-files gotcha and then the PRD stays silent.

**Ask:** A UJ-0 (first launch: pick the Project folder, app makes it Lane-ready itself, in plain words) and an FR with the consequence "a plain folder becomes a working Project with zero technical steps or vocabulary." If the honest answer is "a technical friend does initial setup once," write *that* down as a stated constraint — hidden dependencies are how hobby projects die in week one.

### MEDIUM-1: "Existing plan suffices" is an untested assumption with 3 parallel Lanes — and hitting the limit mid-cook has no defined behaviour.
**Cites:** §9 Cost, §11 Assumptions Index.

Three simultaneous sessions on a personal subscription will meet the rate-limit wall, probably in week one of enthusiastic use. When the wall hits mid-COOKING this collapses into CRITICAL-1's missing failure state — but it deserves its own line because the *message* matters: "Patrick is tired, he'll pick this up in an hour" is a coziness-preserving, honest answer the PRD could specify cheaply. No budgeting UI needed (agreed); a defined limit-hit behaviour is.

### MEDIUM-2: FR-2's "config-plus-files affair Maksym can do" contradicts the product's own premise.
**Cites:** §4.1 FR-2, §11 Assumptions Index, §6.2 (Sandy).

The user is defined as non-technical; the assumption says adding Sandy is "config-plus-files... with guided help, not a code change he must understand." Editing a config file *is* a code change to Maksym. Since the PRD itself flags Sandy as emotionally load-bearing and imminent, this seam will be crossed early. Either the app grows a tiny in-world "new neighbour moves in" flow (drop files in a folder the app watches, matching FR-14's drop-in spirit), or the assumption should honestly read "a technical helper adds Characters." Decide which, and Sandy's arrival stops being a landmine.

### MEDIUM-3: The notification summary is written by the same party being evaluated.
**Cites:** §4.3 FR-6, §11 Assumptions Index, §4.5 FR-9.

The Lane's Claude session writes its own one-line "what I did." Claude sometimes over-claims ("renamed all the product pages" — it did half). Maksym's only verification path is folded technical detail he can't read. Paired with CRITICAL-2 this is compounding: unverifiable claim + auto-landed work. If CRITICAL-2's gate/undo lands, this drops to low. At minimum, add to FR-6: the summary must describe *outcomes in the Project*, not intentions, and the Work Window result must show a plain-language "what changed" list — same honesty, one level deeper than one line.

### LOW-1: If macOS notification permission is denied, FR-6 dies silently.
**Cites:** §4.3 FR-6.

One accidental "Don't Allow" on the first-run permission prompt and a leg of SM-2's "nothing missable" tripod is gone with no symptom (voice + dot survive, so it's a degradation, not a break). Cheap fix: the app notices and asks Maksym, warmly, to switch it on.

### LOW-2: All three Characters busy = Mr. Krabs has nothing to offer, and the PRD shrugs.
**Cites:** §3 (Job assumption: no queueing), §4.6 FR-12, §6.2 (Sandy deferred).

No queueing is a defensible v1 cut — I'm not asking for a queue. But with Sandy deferred, three lanes fill up fast, and the "everyone's busy" moment at the Krusty Krab needs a defined, non-dead-end presentation (who's closest to done? the Board is one key away). One sentence in FR-12 covers it. Watch this as the pressure that makes Sandy's arrival urgent for *capacity* reasons, not just sentiment.

### LOW-3: WAITING status may never actually occur — the Board's red ink might be decorative.
**Cites:** §4.4 FR-8, Addendum (design notes).

The addendum already caught it: assignment starts the Lane, so Jobs may go straight to COOKING and WAITING never renders. Fine to punt to UX spec as the addendum says — I'm logging it so it doesn't get lost, because a status that can never occur will confuse the first person who tests FR-8's colour spec.

---

## What I deliberately did NOT flag

- **Sandy out of MVP** — correct call. Asset-gated, not value-gated; FR-2 is the re-entry ramp and the PRD flags her for revisit. The emotional core ships with the three characters who have real pictures.
- **Placeholder voices in MVP** — matches the mockup Maksym already approved; the *mechanism* (staggered, per-character, prominent finish call) is fully specced, which is what matters.
- **No metrics instrumentation, no analytics, no security section** — hobby stakes, single user. SM-3 ("Maksym smiles") is the right metric for this product and I'll defend it in court.
- **One Project, no multi-project** — Maksym's own choice, cleanly recorded as a v2 door.

## Closing the file

The spine is sound: the metaphor carries real function (states = session status, dot = unread, voices = per-lane alerting), the scope discipline is genuinely good, and the assumptions index shows the author knew where the soft ground was. But every finding above is the same finding wearing different hats: **the PRD specifies a town where nothing ever goes wrong, for a user who can't fix things when they do.** Write the bad days — the burned order, the sleeping Mac, the wrong answer, the stop button, the first launch — and this contract is ready for architecture.

**Conditions to clear before architecture:** CRITICAL-1, CRITICAL-2, and a decision (even a one-line one) on each HIGH.

— John
