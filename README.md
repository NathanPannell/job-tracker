# job-tracker

A Claude Code mod that runs a job search from the Claude desktop app's Code tab: scheduled
skills find and score roles, draft application packages, and learn from feedback; the mod
draws the kanban pane (`/jobs`), a band above the prompt, and gives the model tools to read
and update leads.

This repository holds code only. Profiles, résumés, leads and packages live in a data
folder outside it (see [SETUP.md](SETUP.md)); CI fails if personal data is committed.
