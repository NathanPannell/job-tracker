---
name: learn
description: Weekly review of the job search — pass reasons, score corrections, the person's edits to drafted packages and outcomes by source — written as a reviewable proposal of changes to learnings.md and preferences.md plus a short funnel summary, shown on the job board for approval. Runs on a weekly schedule; also on request.
---

# Learn

Turn a week of the person's feedback into small, explicit changes to how leads are scored and
packages are written. You propose; the person approves in /jobs. Never edit the profile files
(the submit skill alone appends the person's answers to
`profile/knowledge-base/application-answers.md`; leave that file to it).

## Inputs

- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`; data folder `$JOB_TRACKER_DATA`.
- `feedback.json` (pass reasons, score-too-high / score-too-low, moves, outcomes; older events
  may include `snooze`, from before snoozing was removed),
  `leads.json` (source, score, column, history), `applications.json`, `jobs edits` (diffs between
  each drafted package and the person's edited version), `scout/runs.md`, `scout/signals.md`
  (funding and hiring news the scout found, with or without a public job board),
  `profile/preferences.md`, `profile/learnings.md`, and earlier proposals in `proposals.json`
  (do not re-propose what was rejected unless new evidence is strong).

Scores: `fitScore` in `leads.json` and `feedback.json` is the scout's fit judgement. The board
shows it aged (points off for the posting's age until applied), but age is applied by the board,
not by scoring, so reason about `fitScore` only: a score correction means the fit was misjudged.
Never propose rules that score old postings down; that would count age twice.

## Steps

1. Funnel for the last 7 days and all time, by source: found, still New, drafted, applied,
   replies, interviews, passed. The board once had a Shortlisted column between New and
   Drafting: older history and feedback may name `shortlisted`; count those leads as kept by
   the person (as drafted when they went on to Drafting), never as a stage of their own. Note which sources produce leads the person keeps and
   which produce passes, including each Gmail source (`gmail:viatec`, `gmail:yc`, ...).
   From `scout/signals.md`, list companies that appeared there and look like strong fits; a
   change may add them to `learnings.md` as companies to score up or watch.
2. Patterns, each needing at least two events (say how many): pass reasons that cluster (for
   example several "Too senior" on leads scored 80+), score corrections by kind and source, leads
   the person moved forward that were scored low, and edits to packages (what the person cut,
   added or reworded in résumés and cover letters).
3. Write at most five changes. Each: the target file (`learnings.md` for scoring and writing
   adjustments, `preferences.md` only for a stated preference change), a title, a one-line
   rationale with the evidence counts, and the exact Markdown to append (short, imperative,
   testable: "Score roles asking 4+ years at most 65 unless the posting welcomes new grads").
   With too little evidence, propose no change and say why.
4. Save the proposal as JSON
   `{ "summary": "<2-3 sentences>", "funnel": "<Markdown table>", "changes": [ { "file", "title", "rationale", "text" } ] }`
   to `$JOB_TRACKER_DATA/scout/proposal-<YYYY-MM-DD>.json` and run
   `jobs propose @<that file>`. It appears in /jobs under "Learning proposals" with Approve and
   Reject; approving appends the changes to the profile files.
5. Reply with the summary and the number of proposed changes.

## Rules

- Never write to `profile/learnings.md` or `profile/preferences.md` yourself.
- Never invent feedback; quote counts from the files.
