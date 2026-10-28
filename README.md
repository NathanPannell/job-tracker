# job-tracker

A Claude Code mod that runs a job search from the Claude desktop app's Code tab: scheduled
skills find and score roles, draft application packages, and learn from feedback; the mod
draws the kanban pane (`/jobs`), a band above the prompt, and gives the model tools to read
and update leads. Scout adds only postings with a fit score of 70 or more that went up in the
last 14 days. Scores never age, and a New lead is archived once its posting is over 14 days old
(see "Posting age" in SETUP.md).
An application with no reply a month after it was submitted is marked ghosted on its own (see
"Ghosting" in SETUP.md).

This repository holds code only. Profiles, résumés, leads and packages live in a data
folder outside it; CI fails if personal data is committed. [SETUP.md](SETUP.md) covers how
it loads, running each skill, editing preferences, where data lives and pausing the schedule.
