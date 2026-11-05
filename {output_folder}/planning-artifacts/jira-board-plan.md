# The Notice Board: Jira in the town (plan, 2026-11-05)

Maksym's ask (2026-11-05): "the same thing for Jira tickets as well — not a copy of Jira, an
understanding of which tasks are where, whether someone tagged me in replies, all the updates;
a check button to research whether all tickets are in their places (something should become
blocked, something can be moved); and a stricter Jira policy for highcap so it changes ticket
statuses on its own when needed."

Sibling of the Mailbox (`pr-mailbox-plan.md`): same shape — one prop on the street, one paper,
plain words, buttons for the few things that need Maksym, hand-offs to characters for the work.

## Measured today (2026-11-05, Atlassian MCP as Maksym, site empat.atlassian.net, project HIGHCAP)

- Open tickets assigned to Maksym: **45** — To Do 23 (mostly US-stories and their [FE]/[BE]
  sub-tasks from the epics), Review Completed 9, Code Review 4, Ready for QA 3, In QA 2,
  In Progress 1, plus a "PR Review — Maksym Loia" task.
- The workflow's columns, as seen on 100 recent tickets: To Do → In Progress → Code Review →
  Review Completed → Ready for QA → In QA → QA Failed / Release Ready → Done.
- Comments mentioning Maksym (JQL `comment ~ "<accountId>"`): 7 tickets, newest HIGHCAP-274
  updated 17:44 local today. So "tagged you" is findable; which comment and when needs one
  more read per ticket (comments carry `created` and the mention markup).
- Updated in the last 3 days: 40 tickets, 26 of them Anna's. Movement is mostly other people's.
- The Flutter plugin already knows how to move tickets: `.claude/lifecycle/config.json` in
  highcap-mobile has `jira.writeback.enabled: false`, transitions `kickoff → "In Progress"`,
  `ship → "In Review"` (a name this workflow does not have — it is **Code Review**), and a
  comment on ship. highcap-backend has no lifecycle config at all. So "stricter policy" is
  partly a config flip plus the right column names, and a config for the backend.
- Bikini's own main process has no Jira credential today (GitHub goes through `gh`, which
  is logged in; there is no Jira equivalent on this Mac — probe denied by the guard, so
  `not checked` beyond "nothing in the environment the town launches with").

## The product

**The Notice Board** — a cork board on the street (Bikini's own drawing, or a picture Maksym
supplies), with a pinned-note count. Press **J**. The paper, top to bottom:

1. **Tagged you** — comments that mention you since you last looked: who, the ticket, the
   first line of what they said, when. Click opens the comment on Jira. (This is the one
   thing Jira does not make easy to see.)
2. **Sent back** — your tickets moved backwards by someone else: QA Failed, Review →
   In Progress. Your dish sent back, same red as the mailbox.
3. **Moved** — your tickets moved forward by others in the last day (Anna → Review Completed,
   QA → Release Ready). Just so you know, faint.
4. **Your plate** — one line per column with a count, and the few tickets that are
   *actionable*: In Progress with no commit or comment for 3+ days ("stale"), Review Completed
   with the PR merged ("move to Ready for QA?"), Code Review with no PR ("no PR yet").
   The 23 To Do sub-tasks are one count, never 23 lines.
5. **Out of place** — the sweep's findings (below), each with "Move it" / "Leave it".

Phone: a Telegram ping when you are tagged, when a ticket of yours is sent back, and when the
sweep finds something. Same once-per-ticket-per-word rule as the mailbox.

## The sweep (the "check" button)

A character's order (Mr. Krabs hands it to whoever is idle), on the button and once a morning:
walk every open HIGHCAP ticket of Maksym's (and, optionally, the team's) and check it against
the rules, read from the truth (GitHub, git, Jira links, comments):

| Rule | Evidence | Proposal |
|---|---|---|
| Code Review / Review Completed but the PR is merged | `gh pr list --state merged` by branch key | → Ready for QA |
| To Do but a branch or PR with its key exists | git/gh | → In Progress (or Code Review when a PR is open) |
| In Progress, no commit and no comment for 3+ days | git log, comments | ask: still on it? park it? |
| Blocked by an unfinished linked ticket ("is blocked by" link, or a [BE] sub-task not done for an [FE] one) | Jira links / siblings | flag "Blocked" (the Impediment flag — this workflow has no Blocked column) |
| Sub-tasks all Done, parent not moved | Jira | → parent to the sub-tasks' column |
| A ticket in Code Review whose PR has changes requested | GitHub | nothing to move — but it shows under Sent back on the mailbox already |

The character ends with ONE ask_maksym: the findings as the story, one question per proposal
with "Move it" / "Leave it" (plus "Flag as blocked" where that applies), then applies the picks
with `transitionJiraIssue` and leaves a one-line comment on each moved ticket. Never creates a
ticket (standing rule), never touches Done / QA columns, never reassigns.

## The policy (stricter Jira for highcap)

Written into both highcap overlays and the plugin config, so it holds whether the order comes
from the paper, the mailbox, or chat:

- A ticket job starts → **In Progress** (kickoff writeback on; `.claude/lifecycle/config.json`
  in BOTH repos, `writeback.enabled: true`).
- A PR is opened for review → **Code Review** (ship writeback, name fixed to "Code Review"),
  with a comment carrying the PR link.
- The PR is merged → **Ready for QA** — the Mailbox's Merge button does this itself (it knows
  the ticket key from the branch), and a character that merges by hand does the same.
- A sent-back dish (QA Failed, changes requested) picked up by a character → **In Progress**.
- Never: Done, In QA, Release Ready, reassigning, creating tickets.

## How the town reads Jira (the one real fork)

The main process needs its own way in, like `gh` for GitHub. Options:

- **A — an Atlassian API token** (Maksym makes one at id.atlassian.com, pastes it once into the
  town's settings; stored like the Telegram token). The town calls Jira's REST API directly:
  cheap, every 2 minutes, no character involved for reading. **Default.**
- B — a character reads Jira through the Atlassian MCP on a schedule: no new secret, but a
  Claude session per look (minutes, tokens), and nothing when all characters are busy.

Everything that WRITES (moves, comments) stays with the characters through the Atlassian MCP,
as the plugin already does — the town's token is read-only in practice (the code never calls a
write endpoint; a check script proves it).

## Questions for Maksym (batched; the default is taken unless he says otherwise)

1. **Jira access**: A (token pasted once) or B (a character reads)? Default **A**.
2. **"For you" means**: tagged in a comment · a ticket of yours moved backwards · newly assigned
   to you. Default **all three**; the To Do sub-tasks are a count, not lines.
3. **The sweep**: proposals with buttons only (default), or auto-apply the safe moves
   (PR merged → Ready for QA) and ask for the rest? Default **ask for everything** the first two
   weeks, then revisit.
4. **Policy scope**: characters move In Progress / Code Review / Ready for QA on their own,
   with a one-line comment; never Done, QA columns, assignees. Default **yes**.
5. **Where it lives**: a cork notice board on the street (key J) — default — or a second page
   inside the mailbox paper.

## Build order (each a run of its own)

1. The reader + the paper (Tagged you, Sent back, Moved, Your plate) + the Telegram pings.
   Pure domain `jira.ts` + `check-jira.mjs` on today's real answers, like the mailbox.
2. The policy: both lifecycle configs, both overlays, the Mailbox merge → Ready for QA.
3. The sweep: the character's order + "Out of place" on the paper with Move/Leave buttons.
