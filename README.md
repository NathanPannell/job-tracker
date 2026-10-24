# job-tracker

A Claude Code mod that runs a job search from the Claude desktop app's Code tab: scheduled
skills find and score roles, draft application packages, and learn from feedback; the mod
draws the kanban pane (`/jobs`), a band above the prompt, and gives the model tools to read
and update leads. Lead scores age: a posting not yet applied to loses 10 points a day, and a
New lead over a week old, or whose aged score falls below 50, is archived (see "Scores age" in SETUP.md).

This repository holds code only. Profiles, résumés, leads and packages live in a data
folder outside it; CI fails if personal data is committed. [SETUP.md](SETUP.md) covers how
it loads, running each skill, editing preferences, where data lives and pausing the schedule.
