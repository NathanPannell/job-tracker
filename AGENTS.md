# Agent notes

- This is a Claude Code mod (function hooks). The plugin API is `vendor/claude-code.d.ts`,
  copied from the engine version pinned in `.github/workflows/ci.yml`. Grep it for every API
  you use; refresh it when the pinned engine changes.
- Personal data never enters this repository. Leads, profiles, résumés and packages live in
  the data folder named by `JOB_TRACKER_DATA`. `npm run check:personal-data` must pass.
- Data writes go through `bin/jobs.mjs` (lock + atomic rename). The hooks module never writes
  data files directly.
- Delivery follows `C:\repo\AGENTS.md`: branch from `origin/staging`, PR to `staging`, green CI.
- Local gate: `npm run ci`, then `claude plugin validate .` and `claude plugin test .`.
