# Agent notes

- This is a Claude Code mod (function hooks). The plugin API is
  `.claude-plugin/types/claude-code/index.d.ts`, written by the engine and git-ignored: it is
  Anthropic's and is never committed. `npm run types:engine` generates it in a fresh worktree
  (`CLAUDE_BIN` names the engine pinned in `.github/workflows/ci.yml`). Grep it for every API
  you use.
- Personal data never enters this repository. Leads, profiles, résumés and packages live in
  the data folder named by `JOB_TRACKER_DATA`. `npm run check:personal-data` must pass.
- Board state writes go through `bin/jobs.ts` (lock + atomic rename). The hooks module never
  writes data files directly.
- Delivery follows `C:\repo\AGENTS.md`: branch from `origin/staging`, PR to `staging` gated by the local checks below (GitHub CI runs only for PRs and pushes to `main`).
- Local gate: `npm run ci`, then `claude plugin validate .` and `claude plugin test .`.
