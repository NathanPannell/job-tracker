# Setup and daily use

Installing from scratch: follow [INSTALL.md](INSTALL.md). This file covers how the install works
and daily use.

## What it is

- **Skills** (in `skills/`) do the work: `onboard` builds the profile from a résumé, writing
  samples and an interview, `scout` finds and scores roles, `package` drafts an application,
  `submit` fills it in Chrome and submits it once you approve, `sync` reads Gmail and Calendar for
  replies, and `learn` turns a week of feedback into a proposal.
- **The mod** (`hooks/register.tsx`) is the interface: the `/jobs` kanban pane, the band above
  the prompt, one short mention of new leads per conversation, a guard on background Chrome calls,
  and the tools the model uses: `list_leads`, `update_lead`, `record_feedback`, `draft_package`,
  `deep_form` and `open_board`.
- **The CLI** (`bin/jobs.ts`) is the only writer of the board's state files (lock and atomic
  rename), used by the skills, the pane and the tools. Skills also write to the data folder
  directly: package documents, scout logs, proposal drafts and, for `submit`, the saved answers.

## How it loads

The mod loads from a checkout of this repository into every Claude Code session, desktop and
terminal alike, through the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "<path to this checkout>",
    "JOB_TRACKER_HOME": "<path to this checkout>",
    "JOB_TRACKER_DATA": "<path to your data folder>",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

- `CLAUDE_CODE_PLUGIN_DIRS` loads the folder as a plugin (several folders are separated by `;` on
  Windows, `:` elsewhere).
- `JOB_TRACKER_HOME` is where the skills find `bin/jobs.ts`; `JOB_TRACKER_DATA` is the data folder.
- `CLAUDE_CODE_PLUGIN_DIR_WATCH` is optional. It reloads the mod when its files change, and writes
  the reasons for any refused hook into the transcript.

Create the data files with `node bin/jobs.ts init --data <path to your data folder>`. The running
checkout stays on the `staging` branch, where work lands first; after a PR merges, `git pull` in
it updates every new session.

## Where the data lives

`JOB_TRACKER_DATA`, a folder outside every git repository. The repo's `.gitignore` and the
`check:personal-data` step keep it out of git. The CLI's lock file, `.lock`, lives here too. The
types of the JSON files are in `types/index.d.ts`.

| Path                  | What                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leads.json`          | The board: one entry per posting, its column, score, reason and history                                                                                                                                                                                                                                                                                                                                                           |
| `applications.json`   | One entry per package and its files                                                                                                                                                                                                                                                                                                                                                                                               |
| `feedback.json`       | Passes, score corrections, moves and outcomes, for `learn`                                                                                                                                                                                                                                                                                                                                                                        |
| `proposals.json`      | Weekly learning proposals and their status                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/<lead-id>/` | `posting.md`, `resume.tex`, `resume.pdf`, `resume.diff` (against the master), `cover-letter.md`, `answers.md`, `company-brief.md`, `sources.md`, `submission.md` (what was sent), `preview/` and `.draft/` (the draft as written)                                                                                                                                                                                                 |
| `profile/`            | The record `onboard` writes: `preferences.md` (which jobs, and the scoring rubric), `learnings.md` (approved adjustments), `resume-generation-rules.md`, `master-resume.tex`, `resume-format-template.tex`, `voice.md`, `cover-letter-prompts.md`, `target-companies.md`, `ats-boards.json`, `OPEN-QUESTIONS.md`, `sources/`, `archive/` (retired rules and answers) and `knowledge-base/` (facts, with `application-answers.md`) |
| `scout/`              | Each run's raw files (`candidates-*.json`, `ats-*.json`, `summaries-*.json`), `runs.md` (one line per run), `signals.md` (funding news), `gmail-cursor.json` and learn's proposal files                                                                                                                                                                                                                                           |

## Using it

- **The board.** `/jobs` opens on **Active** (New, Drafting, Ready to apply). **Applications**
  holds Current, Interviews and Offers; **Settled** holds Passed, Archived, Rejected and Ghosted.
  Each card shows a fit badge (green 90+, amber 75–89, grey below), company and role, its age,
  source and location, and a one-line tagline, then its stage's next steps as buttons. Company
  decisions (Got interview, Got offer, Rejected, Ghosted, Accepted, Declined) move the card and
  record an outcome for the weekly review. A rejected, archived or passed card offers "Back to
  <where it was>" to undo a mis-click. Click a
  card's name for its page, with Pass, Archive, Draft package and score feedback.
- **Ready notes.** A Ready card with a package says `Ready to submit` or `2 answers needed`: the
  `NEEDS ANSWER` questions in its `answers.md` that `application-answers.md` does not answer (by
  the entry's heading or an `Also asked as` wording, where its scope covers the lead). It is a
  guide worked out on refresh; submit judges meaning and asks only what the record cannot answer.
- **Posting age.** Scores never change with age. Scout adds a posting only when it scores 70 or
  more (`--threshold <n>` on `jobs add` changes that) and is not dated over 14 days ago. A New lead
  whose posting is over 14 days old (counted from when it was added when undated) moves to
  Archived on its own, when the board refreshes and on every `jobs add`. Leads you have worked on
  are never archived this way.
- **Ghosting.** An application in Applied with no reply a calendar month after you submitted it is
  marked Ghosted on its own, with an outcome recorded `by: "tracker"`, a toast, a week's listing
  above the tabs and a push notification from scout. A late reply still moves the card on, and
  "Back to Applied" undoes it. The constants are in `hooks/lib/model.ts`.
- **Draft package** moves the card to Drafting and builds the package in a background subagent,
  so you keep triaging while several build side by side. A toast says when each ends; the card
  moves to Ready to apply unless you moved it meanwhile. Asking in chat uses the `draft_package`
  tool, which starts the same build.
- **Review** shows the résumé drawn in the pane (desktop), the diff against the master résumé,
  the cover letter, answers and company brief. "Open PDF" opens the file.
- **Approve and submit** starts a background subagent that fills the form in Chrome from the
  record, drafted answers included. Then `submit` carries on in your conversation: it asks a short
  numbered list of only what the record cannot answer, fills each form again in a fresh tab,
  clicks its final submit, checks the sent page, moves the card to Applied and tells you in one
  line. An application behind a CAPTCHA, an agreement or a sign-in waits for your go, is filled
  in one sitting and left for your click; say when they are submitted and their cards move. A
  lead whose notes start "MANUAL APPLY ONLY" is yours to apply for by hand. "Approve and submit
  all" does this for every Ready lead at once.
- **The Chrome guard** (`hooks/lib/chrome.ts`) holds every background prefill to tabs it opened,
  an element ref for every click, and no click on a control labelled or typed like a final submit.
  If a prefill's tab looks submitted when it ends, your conversation says so first and leaves that
  lead alone. Forms inside shadow DOM or an iframe are filled with the mod's `deep_form` tool, one
  fixed script that refuses what the guard would refuse.
- **Saved answers.** Every answer you give is saved in
  `profile/knowledge-base/application-answers.md` as the text to enter, one per question;
  `package` and `submit` read it first, so a question you have answered is not asked again. A
  data-processing or "keep in contact" box your saved answer covers is ticked for you. Accounts,
  sign-ins, passwords, CAPTCHAs and other agreements are left to you.
- The band above the prompt reads `● N new leads · M ready to apply · /jobs`; click it to open the
  board. In an unrelated conversation, the first reply ends with one short line naming the top new
  leads, at most once per conversation and never within three hours of the last mention.
- On mobile the board and packages are view-only.

## Running each skill by hand

Ask in any session:

- "Use the job-tracker:onboard skill": build the profile, or add a new job or project to it.
- "Use the job-tracker:scout skill": find and score new roles now.
- "Draft a package for lead `<id>`", or press Draft package on the card.
- "Use the job-tracker:submit skill for lead `<id>`", or press Approve and submit.
- "Use the job-tracker:sync skill": check Gmail and Calendar for replies now.
- "Use the job-tracker:learn skill": write this week's learning proposal now. Review it under
  "Learning proposals" in `/jobs`, where each change has Approve, Reject and Clarify. Clarify takes
  what should change; a background subagent revises the change with your words and it comes back
  for review. Nothing is written to `learnings.md` or `preferences.md` until you approve.

## Editing preferences

Edit `profile/preferences.md` (roles, level, location, pay floor, dealbreakers and the scoring
rubric) directly; the next scout run uses it. `profile/learnings.md` holds the adjustments you
approved; edit them there too. Settle items in `profile/OPEN-QUESTIONS.md` and delete them. To add
a company with a public Greenhouse, Lever or Ashby board, run `node bin/jobs.ts probe <slug>` and
then `node bin/jobs.ts board-add "<company>" <ats> <slug>`.

## Email sync

`sync` moves a card itself, with no confirmation, for a clear rejection, interview request or
offer (a late reply on a ghosted card included) and records the outcome for the weekly review.
Anything unclear stays where it is, noted on the card's page. A rejection is filed quietly; an
interview or offer sends a notification, leads the line above the prompt and is listed above the
tabs for a week. If a move is wrong, "Back to <where it was>" puts it back, and `sync` then
ignores the emails from before that press. It never sends, drafts, labels or deletes email and
never touches calendar events.

## The schedule

Desktop scheduled tasks run the work in their own sessions, each defined in
`~/.claude/scheduled-tasks/<name>/SKILL.md`. [INSTALL.md](INSTALL.md) has their prompts.

| Task                        | When (local time)                     | Cron                     | What                                 |
| --------------------------- | ------------------------------------- | ------------------------ | ------------------------------------ |
| `job-tracker-scout`         | Weekdays at 8:00, 12:00, 16:00, 20:00 | `0 8,12,16,20 * * 1-5`   | The `scout` skill                    |
| `job-tracker-scout-weekend` | Saturdays and Sundays at 12:00        | `0 12 * * 0,6`           | The `scout` skill                    |
| `job-tracker-sync`          | Daily at 9:00, 13:00, 17:00           | `0 9,13,17 * * *`        | The `sync` skill                     |
| `job-tracker-tsenta`        | Daily, every 3 hours, 8:30 to 20:30   | `30 8,11,14,17,20 * * *` | An optional job source (below)       |
| `job-tracker-learn`         | Sundays at 18:00                      | `0 18 * * 0`             | The `learn` skill                    |
| `job-tracker-board-check`   | Manual                                |                          | Optional check that the tools answer |

If the scheduler runs in a different time zone from the PC, set each cron by the offset, and check
the next run time after any change.

**The Tsenta source** is optional and read-only: it reads postings from the last 24 hours through
a connected Tsenta MCP server, scores them with the same rubric and bar of 70, and never applies or
changes anything there.

To pause a task, turn it off under sidebar → Scheduled in the desktop app, or ask Claude to disable
it.

## Developing

Use the engine version pinned in `.github/workflows/ci.yml`. An older `claude` on `PATH` may not
have `plugin test`, so install the pinned one in a scratch folder if you need to, and set
`CLAUDE_BIN` to its binary (on Windows `claude.exe`, not the `.cmd` shim).

```bash
npm ci
```

```bash
npm run types:engine
```

```bash
npm run ci
```

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

`npm run types:engine` has the engine write its plugin API to
`.claude-plugin/types/claude-code/index.d.ts`, which is git-ignored: the file is Anthropic's, so
it is generated, never committed. `npm run ci` is format, lint (zero warnings), types, unit tests
with the coverage floor, and the personal-data scan. `claude plugin test` mounts the pane and band
on the terminal, desktop and mobile surfaces through the engine. Delivery: branch from
`origin/staging`, PR to `staging` with the local checks green, squash-merge; GitHub CI runs only
for PRs and pushes to `main`.
