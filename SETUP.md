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

| Path                  | What                                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leads.json`          | The board: one entry per posting, its column, score, reason and history                                                                                                                                                                 |
| `applications.json`   | One entry per package and its files                                                                                                                                                                                                     |
| `feedback.json`       | Passes, score corrections, moves, snoozes and outcomes, for `learn`                                                                                                                                                                     |
| `proposals.json`      | Weekly learning proposals and their status                                                                                                                                                                                              |
| `packages/<lead-id>/` | `resume.tex`, `resume.pdf`, `cover-letter.md`, `answers.md`, `company-brief.md`, `warm-intro.md`, `posting.md`, `sources.md`, `preview/` (the pane's résumé strips) and `.draft/` (the draft as written, so `learn` can see your edits) |
| `profile/`            | The career record copied from the Resume Revamp folder, plus `preferences.md`, `learnings.md`, `target-companies.md`, `ats-boards.json` and `OPEN-QUESTIONS.md`                                                                         |
| `scout/`              | Each run's raw candidates, `runs.md` (one line per run) and learn's proposal files                                                                                                                                                      |

The types of every file are in `types/index.d.ts`.

## Using it

- `/jobs` opens the board. Columns: New → Shortlisted → Drafting → Ready to review → Applied →
  Interviewing → Offer, with Passed and Archived behind "Show passed & archived". On a card: ◀ ▶
  move it, the name or Details opens it. In a lead: Pass (pick a reason), Score too high / too low,
  Snooze, Open posting, Draft package, Review package, Approve & submit.
- **Review package** shows the résumé PDF drawn in the pane (desktop), "Résumé vs master" (the
  diff against the master résumé), the cover letter, answers, company brief and warm-intro note.
  "Open PDF" opens the file in your PDF viewer.
- **Approve & submit** asks Claude to run `submit`: it prefills the form in Chrome, attaches the
  PDF and stops; you confirm in chat before anything is sent. Account creation, sign-ins and
  CAPTCHAs are handed back to you.
- The band above the prompt reads `● N new leads · M ready to review · K follow-ups due`; click it
  to open the board. It is hidden when all three are zero.
- In an unrelated conversation, the first reply ends with one short line naming the top new leads,
  at most once per conversation and never within three hours of the last mention.
- On mobile the board and packages are view-only.

## Running each skill by hand

Ask in any session:

- "Use the job-tracker:scout skill" — find and score new roles now.
- "Use the job-tracker:package skill for lead `<id>`" — or press Draft package on the card.
- "Use the job-tracker:submit skill for lead `<id>`" — or press Approve & submit.
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
`staging`, green CI, squash-merge.
