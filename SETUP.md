# Setup and daily use

## What it is

- **Skills** (in `skills/`) do the work: `scout` finds and scores roles, `package` drafts an
  application, `submit` prefills it in Chrome and waits for your yes, `sync` reads Gmail and
  Calendar for replies, `learn` turns a week of feedback into a proposal.
- **The mod** (`hooks/register.tsx`) is the interface: the `/jobs` kanban pane, the band above
  the prompt, one short mention of new leads per conversation, and the tools `list_leads`,
  `update_lead` and `record_feedback` the model uses.
- **The CLI** (`bin/jobs.ts`) is the only writer of the data files (lock and atomic rename), used
  by the skills, the pane and the tools.

## How it loads

The mod loads from this checkout into every Claude Code session, desktop and terminal alike,
through the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\repo\\job-tracker-workspace\\job-tracker",
    "JOB_TRACKER_HOME": "C:\\repo\\job-tracker-workspace\\job-tracker",
    "JOB_TRACKER_DATA": "C:\\repo\\job-tracker-workspace\\data"
  }
}
```

- `CLAUDE_CODE_PLUGIN_DIRS` loads the folder as a plugin (several folders are separated by `;` on
  Windows, `:` elsewhere). Edits to it reload in a running interactive session; a new desktop
  session picks them up when it starts.
- `JOB_TRACKER_HOME` is where the skills find `bin/jobs.ts`.
- `JOB_TRACKER_DATA` is the data folder (below).

The checkout stays on the `staging` branch; after a PR merges, `git pull` in it updates every new
session. It needs Node 24 or newer on `PATH` (the CLI is TypeScript run by Node directly) and, for
résumés, a LaTeX install with `pdflatex`, `pdfinfo` and `pdftocairo` (MiKTeX ships all three).

## Where the data lives

`JOB_TRACKER_DATA` (here `C:\repo\job-tracker-workspace\data`), outside every git repository.
The repo's `.gitignore` and the `check:personal-data` CI job keep it out of git.

| Path                  | What                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leads.json`          | The board: one entry per posting, its column, score, reason and history                                                                                                                                                                                             |
| `applications.json`   | One entry per package and its files                                                                                                                                                                                                                                 |
| `feedback.json`       | Passes, score corrections, moves, snoozes and outcomes, for `learn`                                                                                                                                                                                                 |
| `proposals.json`      | Weekly learning proposals and their status                                                                                                                                                                                                                          |
| `packages/<lead-id>/` | `resume.tex`, `resume.pdf`, `cover-letter.md`, `answers.md`, `company-brief.md`, `warm-intro.md`, `posting.md`, `sources.md`, `preview/` (the pane's résumé pages) and `.draft/` (the draft as written, so `learn` can see your edits)                              |
| `profile/`            | The career record copied from the Resume Revamp folder, plus `preferences.md`, `learnings.md`, `target-companies.md`, `ats-boards.json`, `OPEN-QUESTIONS.md` and `knowledge-base/application-answers.md` (your answers to application questions, saved by `submit`) |
| `scout/`              | Each run's raw candidates, `runs.md` (one line per run), `signals.md` (funding news), `gmail-cursor.json` (where Gmail reading stopped) and learn's proposal files                                                                                                  |

The types of every file are in `types/index.d.ts`.

## Using it

- `/jobs` opens the board on tabs, one stage at a time: New → Drafting → Ready to review →
  Applied → Interviewing → Offer, with Passed and Archived behind "Passed & archived". New shows
  the ten best first ("Show more" adds ten). Each card is three lines: a coloured fit badge (green
  90+, amber 75–89, grey below) with company and role; age, source and location (remote or
  where); and a one-line tagline of about 40 characters saying what the company makes or what
  the role is (the fit reason until scout has written one; a longer one ends in "…"). Under them
  are its stage's next steps as labelled buttons: New: Draft package · Pass — Drafting: Back to
  New — Ready: Review · Approve and submit — Applied: Got interview · Rejected · Ghosted — Interviewing: Got offer ·
  Rejected — Offer: Accepted · Declined. Company decisions (Got interview, Got offer, Rejected,
  Ghosted, Accepted, Declined) move the card and record an outcome for the weekly review, never a
  pass; an archived or passed card offers "Back to <where it was>" to undo a mis-click. Click a card's name to open it: the same next steps, then
  Pass… · Archive · Draft package, then feedback (Score too high / too low, Snooze).
- **Scores age.** The badge shows the scout's fit score less points for the posting's age, so
  stale postings sink: 10 points a day, worked out by the hour (a day old is 10 off, two days
  20), at most 70 off. A New lead whose posting is over 7 days old moves to Archived on its own
  (history says `tracker: moved → Archived (posted over 7 days ago)`, and no feedback is
  recorded); Drafting and Ready leads stay where you put them. Age counts from the posting date when the source gives one (Greenhouse,
  Lever and Ashby boards do), else from when scout found it. Only New, Drafting and Ready age; once applied, a lead keeps its fit score. Opening an aged lead shows both, e.g.
  `Fit 86 → 66, posted 2d ago`. The fit score in `leads.json` never changes with age: score
  corrections, feedback and the weekly `learn` review use it, while sorting, the nudge,
  `list_leads` (its `score` field and `minScore`) and scout's add threshold use the aged score.
  Nothing runs on a timer; scores are worked out each time the board draws or refreshes, and
  New leads posted over a week ago or scoring below 50 as aged are archived when the board
  refreshes and on every `jobs add` (or by hand with `jobs archive`); snoozed leads and leads
  moved back to New by hand are left alone. The curve is the `DECAY_*`, `ARCHIVE_AFTER_DAYS` and
  `ARCHIVE_BELOW_SCORE` constants in `hooks/lib/model.ts`.
- **Draft package** moves the card to Drafting at once and builds the package in a background
  subagent, never in your conversation, so you keep triaging while it runs and several build side
  by side (each takes several minutes). A toast says when one starts and when it ends; the card
  moves to Ready to review unless you moved it meanwhile. Redraft package does the same. If the
  engine will not start a subagent, the button asks your conversation to start one instead,
  queued until the current reply ends. Asking in chat ("draft a package for Acme") uses the
  `draft_package` tool, which starts the same background build.
- **Review** shows the résumé PDF drawn in the pane (desktop), "Résumé vs master" (the
  diff against the master résumé), the cover letter, answers, company brief and warm-intro note.
  "Open PDF" opens the file in your PDF viewer.
- **Approve and submit** asks Claude to run `submit` in your conversation: it fills in the form
  in Chrome and attaches the PDF, asks you in one message for anything the package and your
  saved answers do not cover, then shows what it entered and asks "Submit it now?". It clicks
  submit only after your yes. Every answer you give is saved word for word, with the question
  and date, in `profile/knowledge-base/application-answers.md`; `package` and `submit` read it
  first, so a question you have answered once is not asked again. Account creation, sign-ins,
  passwords, CAPTCHAs and agreements are handed back to you with everything ready to paste.
- The band above the prompt reads `● N new leads · M ready to review · K follow-ups due`; click it
  to open the board. It is hidden when all three are zero.
- In an unrelated conversation, the first reply ends with one short line naming the top new leads,
  at most once per conversation and never within three hours of the last mention.
- On mobile the board and packages are view-only.

## Running each skill by hand

Ask in any session:

- "Use the job-tracker:scout skill" — find and score new roles now.
- "Draft a package for lead `<id>`" — or press Draft package on the card. Either way it runs in
  a background subagent.
- "Use the job-tracker:submit skill for lead `<id>`" — or press Approve and submit.
- "Use the job-tracker:sync skill" — check Gmail and Calendar for replies; it proposes moves and
  waits for your confirmation.
- "Use the job-tracker:learn skill" — write this week's learning proposal now; approve it under
  "Learning proposals" in `/jobs`.

## Editing preferences

Edit `profile/preferences.md` (roles, level, location, pay floor, dealbreakers and the scoring
rubric) directly; the next scout run uses it. `profile/learnings.md` holds the adjustments you
approved from `learn` proposals; edit or delete lines there too. Answer or delete items in
`profile/OPEN-QUESTIONS.md` as you settle them. To add a company with a public Greenhouse, Lever or
Ashby board, add `{ "company", "ats", "slug" }` to `profile/ats-boards.json`
(`node bin/jobs.ts probe <slug>` finds which one it uses).

## The schedule

Two desktop scheduled tasks run the skills in their own sessions:

- `job-tracker-scout`: weekdays at 8:00, 12:00 and 16:00 local time (`0 8,12,16 * * 1-5`).
- `job-tracker-learn`: Sundays at 18:00 (`0 18 * * 0`).

To pause, open the desktop app's scheduled tasks (sidebar → Scheduled) and turn the task off, or
ask Claude to disable `job-tracker-scout`. Turn it back on the same way. Deleting the task stops it
for good; re-create it with the same prompt ("Use the job-tracker:scout skill.") and cron.

## Developing

```bash
npm ci
npm run ci
claude plugin validate .
claude plugin test .
```

`npm run ci` is format, lint (zero warnings), types, unit tests with the coverage floor, and the
personal-data scan. `claude plugin test` mounts the pane and band on the terminal, desktop and
mobile surfaces through the engine. The plugin API is `vendor/claude-code.d.ts`, from the engine
version pinned in `.github/workflows/ci.yml`. Delivery: branch from `origin/staging`, PR to
`staging` with the local checks green, squash-merge. GitHub CI runs only for PRs and pushes to `main`.
