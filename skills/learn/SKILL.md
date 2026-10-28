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
  may include `snooze`, from before snoozing was removed). An outcome with `by: "tracker"` was
  recorded by the board itself: an application ghosted a month after submitting with no reply.
  Count it as ghosted, not as a rejection anyone reported, and keep it apart from Ghosted marked
  by hand. A ghosting that was undone (the lead moved out of Archived after it, see its history)
  or followed by a later outcome for the same lead (a late reply) is not a ghosting: count the
  later outcome instead,
  `leads.json` (source, score, column, history), `applications.json`, `jobs edits` (diffs between
  each drafted package and the person's edited version), `scout/runs.md`, `scout/signals.md`
  (funding and hiring news the scout found, with or without a public job board),
  `profile/preferences.md`, `profile/learnings.md`, and earlier proposals in `proposals.json`.
  The person decides each change on its own, so one proposal can hold approved, rejected and
  still-pending changes: each change has its own `status` (`pending`, `approved`, `rejected`).
  A proposal saved before per-change decisions has a single `status` that applies to all of
  its changes. Do not re-propose a change that was rejected unless new evidence is strong, and
  do not re-propose one that is approved (it is already in the profile file) or still pending.

Scores: `fitScore` in `leads.json` and `feedback.json` is the scout's fit judgement, and the
board shows it as is: scores never age. A score correction means the fit was misjudged. Never
propose rules that score a lead down for its age or its posting's age: `fitScore` is about fit
only, and posting age is handled apart from it (scout skips postings over 14 days old, and the
board archives a New lead once its posting is that old).

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
3. Write 3 to 10 changes. The person approves or rejects each change on its own, so each one
   is a single small learning that stands alone: it makes sense and does what it says whether
   any other change is approved or rejected, never refers to another change, and never merges
   two rules into one (two rules are two changes). Each: the target file (`learnings.md` for
   scoring and writing adjustments, `preferences.md` only for a stated preference change), a
   title, a one-line rationale with the evidence counts, and the exact Markdown to append
   (short, imperative, testable: "Score roles asking 4+ years at most 65 unless the posting
   welcomes new grads"). Never pad with weak changes to reach three: with evidence for fewer,
   propose fewer (none is fine) and give the reason in `fewerReason` and in the summary.
   `jobs propose` refuses more than 10 changes, fewer than 3 without a `fewerReason`, and a
   title over 120 characters, rationale over 300 or text over 1,200.
4. Save the proposal as JSON
   `{ "summary": "<2-3 sentences>", "funnel": "<Markdown table>", "fewerReason": "<only with fewer than 3 changes>", "changes": [ { "file", "title", "rationale", "text" } ] }`
   to `$JOB_TRACKER_DATA/scout/proposal-<YYYY-MM-DD>.json` and run
   `jobs propose @<that file>`. Leave `fewerReason` out with 3 or more changes. Saving again
   the same day replaces that day's proposal while none of its changes is decided; once one
   is, `propose` refuses: add `"id": "proposal-<YYYY-MM-DD>-2"` to the JSON. It appears in /jobs under "Learning proposals" with Approve and
   Reject on every change (and Approve all remaining / Reject all remaining); approving a change
   appends only its text to its profile file.
5. Reply with the summary and the number of proposed changes.

## Rules

- Never write to `profile/learnings.md` or `profile/preferences.md` yourself.
- Never invent feedback; quote counts from the files.
