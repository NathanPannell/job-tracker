---
name: learn
description: Weekly review of the job search — pass reasons, score corrections, the person's edits to drafted packages and outcomes by source — written as a reviewable proposal of changes to learnings.md and preferences.md plus a short funnel summary, shown on the job board for approval. Also revises a proposed change the person clarified on the board. Runs on a weekly schedule; also on request.
---

# Learn

Turn a week of the person's feedback into small, explicit changes to how leads are scored and
packages are written. You propose; the person approves in /jobs. Never edit a profile file
yourself.

## Inputs

- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`; data folder `$JOB_TRACKER_DATA`.
- `feedback.json`: pass reasons, score corrections, moves and outcomes. Older events may include
  `snooze` or name a `shortlisted` column, both since removed: count a shortlisted lead as kept by
  the person. An outcome with `by: "tracker"` is the board marking an application ghosted a month
  after submitting with no reply: count it as ghosted, apart from Ghosted marked by hand, and not
  at all when it was undone or a later outcome for the lead followed.
- `leads.json` (source, score, column, history), `applications.json`, `jobs edits` (diffs between
  each drafted package and the person's edited version), `scout/runs.md`, `scout/signals.md`,
  `profile/preferences.md`, `profile/learnings.md`, and earlier proposals in `proposals.json`.
- Each change in a proposal has its own `status` (`pending`, `approved`, `rejected`; an old
  proposal may have one `status` for all its changes) and may hold `clarifications`, the person's
  own words on it: `text`, `was` (the change's text then) and `revisedAt` (absent while it waits).
  Never re-propose a change that is approved or pending, nor a rejected one without strong new
  evidence, nor what a clarification corrected. A clarification outweighs event counts.

`fitScore` is the scout's judgement of the person's chance at an interview, and scores never
age. A score correction means that judgement was wrong. Never propose a rule that scores a lead
down for its posting's age: scout and the board handle age.

## Revise a clarified change

On Clarify in /jobs the person types what should change on a pending change. It stays pending and
cannot be approved until revised. The board starts a background subagent for it; a weekly run
first revises every pending change with a clarification that has no `revisedAt`. A run told to
revise one change does only that, then stops: no funnel, no new proposal.

1. Read the change and its clarifications in `proposals.json`, and read `profile/learnings.md` and
   `profile/preferences.md` so the revision does not repeat or contradict them, except where the
   person's words say to.
2. Rewrite the change to say what they meant, as one small standalone learning in the same short,
   imperative, testable style, in the change's own voice. Their words outrank your evidence. Ask
   nothing. Approving only appends, so where their words override a rule already in a profile
   file, say so in the text.
3. Save it with `jobs revise '<json>'` or `jobs revise @<file>`:
   `{ "proposal": "<id>", "change": "c2", "answers": "<that clarification's at>", "text": "<new Markdown>" }`,
   adding `title`, `rationale` or `file` when those change (a stated preference may move to
   `preferences.md`). The limits in step 3 below apply. `revise` refuses a change decided, revised
   or clarified again since you read it: leave it and go on.

## Steps

1. Funnel for the last 7 days and all time, by source (each Gmail source on its own): found,
   still New, drafted, applied, replies, interviews, passed. Note which sources produce leads the
   person keeps and which produce passes. From `scout/signals.md`, list strong-fit companies; a
   change may add them to `learnings.md` as companies to watch.
2. Patterns, each needing at least two events (say how many): clustered pass reasons, score
   corrections by kind and source, low-scored leads the person moved forward, and edits to
   packages (what they cut, added or reworded). A move into Rejected is the company's decision,
   never a lead moved forward, and one from Archived is no new outcome.
3. Write 3 to 10 changes. Each is one small learning that stands alone: it makes sense whether or
   not any other change is approved, never refers to another, and never merges two rules. Each
   has a target file (`learnings.md` for scoring and writing adjustments, `preferences.md` only
   for a stated preference change), a title, a one-line rationale with the evidence counts, and
   the exact Markdown to append (short, imperative, testable: "Treat roles asking 4+ years as a
   dealbreaker unless the posting welcomes new grads"). Never pad: with evidence for fewer than
   three, propose fewer (none is fine) and say why in `fewerReason` and the summary. `jobs propose`
   refuses more than 10 changes, fewer than 3 without a `fewerReason`, and a title over 120
   characters, rationale over 300 or text over 1,200.
4. Save the proposal as
   `{ "summary": "<2-3 sentences>", "funnel": "<Markdown table>", "fewerReason": "<only with fewer than 3 changes>", "changes": [ { "file", "title", "rationale", "text" } ] }`
   to `$JOB_TRACKER_DATA/scout/proposal-<YYYY-MM-DD>.json` and run `jobs propose @<that file>`.
   Saving again the same day replaces that day's proposal until one of its changes is decided or
   clarified; then add `"id": "proposal-<YYYY-MM-DD>-2"`. It appears in /jobs under "Learning
   proposals", where approving a change appends its text to its file.
5. Reply with the summary and the number of proposed changes.

## Rules

- Never write to `profile/learnings.md` or `profile/preferences.md` yourself.
- Never invent feedback; quote counts from the files.
