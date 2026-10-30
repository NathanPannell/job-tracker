# Install job-tracker

To install, copy this page's address, open Claude Code in the Claude desktop app, and say:

> Read INSTALL.md at <the address you copied> and set this up for me.

The rest of this file is written for Claude, and covers everything outside the code: the machine,
your Claude settings, your data folder, connectors, job alerts and the schedule. It takes about
ten minutes, plus a half-hour interview that builds your profile. [SETUP.md](SETUP.md) covers
daily use.

## Instructions for Claude

Work through the phases in order and tell the person where you are. Do everything you can yourself.
The items marked **Person** need their hands: signing in, approving a connector, creating an
account. Hand those over with the exact steps, and never enter a password or create an account for
them.

Before changing anything, tell them what you will install and which files you will touch, and ask
where the install should live if they have a preference. The default is `~/job-tracker-workspace`:

```text
job-tracker-workspace/
  job-tracker/   this repository: code only
  data/          their leads, packages and profile, never in git
```

### Phase 1: the machine and Claude Code (this session)

1. Check the tools, and install what is missing with the system's package manager, asking first:

   | Tool                                | Needed for                       | Check                                               |
   | ----------------------------------- | -------------------------------- | --------------------------------------------------- |
   | Node 24 or newer                    | Runs the `jobs` command          | `node --version`                                    |
   | git                                 | Cloning and updates              | `git --version`                                     |
   | `pdflatex`, `pdfinfo`, `pdftocairo` | Résumé PDFs and the pane preview | `pdflatex --version`, `pdfinfo -v`, `pdftocairo -v` |

   On Windows, MiKTeX ships all three. On macOS, install MacTeX and `brew install poppler`. On
   Linux, install TeX Live and `poppler-utils`. A fresh install may keep the commands out of `PATH`
   until the terminal restarts; on Windows look under `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`.

2. Check the Claude Code version. The desktop app is the supported home: scheduled tasks and the
   résumé preview need it. A terminal `claude` works for `/jobs`, but must be at least the
   `CLAUDE_CODE_VERSION` in `.github/workflows/ci.yml`; older versions may not load the mod.

3. Clone and create the data folder:

   ```bash
   mkdir -p ~/job-tracker-workspace/data
   git clone <this repository's URL> ~/job-tracker-workspace/job-tracker
   node ~/job-tracker-workspace/job-tracker/bin/jobs.ts init --data ~/job-tracker-workspace/data
   ```

   No `npm install` is needed to run it: the code uses Node built-ins and the Claude Code engine.
   The last command should print the data folder's path.

4. Back up `~/.claude/settings.json`, then merge these into its `env` block with absolute paths,
   keeping every other key:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/job-tracker-workspace/job-tracker",
       "JOB_TRACKER_HOME": "/absolute/path/job-tracker-workspace/job-tracker",
       "JOB_TRACKER_DATA": "/absolute/path/job-tracker-workspace/data",
       "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
     }
   }
   ```

   - If `CLAUDE_CODE_PLUGIN_DIRS` already has a value, append to it: separate folders with `;` on
     Windows and `:` elsewhere.
   - On Windows write `C:\\Users\\name\\...`, with doubled backslashes.
   - `CLAUDE_CODE_PLUGIN_DIR_WATCH` is optional. It reloads the mod when its files change.

5. Connectors. **Person:** in Claude, go to Settings → Connectors, connect these and sign in:

   | Connector       | Used by              | Without it                          |
   | --------------- | -------------------- | ----------------------------------- |
   | Gmail           | scout, package, sync | No job-alert source, no warm intros |
   | Google Calendar | sync                 | Interviews are not picked up        |

   Connect the Gmail account where job alerts arrive and applications get replies. It may not be
   the account they use for Claude. Web search and fetch are built in and need no setup.

6. **Person:** install [Claude in Chrome](https://claude.ai/chrome) and sign in, for the submit
   skill. Keep that Chrome signed in to any job sites they use. Without it they can still build
   packages and apply by hand.

7. Optional, only if they already use [Tsenta](https://tsenta.com) or want it as a source:
   `claude mcp add --scope user --transport http autojobs https://api.autojobs.me/api/v1/mcp`, then
   **Person:** authorize it with `/mcp`. If `claude` is not on `PATH`, **Person:** add that URL as a
   custom connector in Settings → Connectors. It needs a Tsenta account.

8. **Person:** start a new session, because `settings.json` is only read at start-up. If step 1
   installed anything, fully quit and reopen the app first so it picks up the new `PATH`. Give them
   this line to say there, with the real path filled in:

   > Read <absolute path>/job-tracker/INSTALL.md and continue from Phase 2.

### Phase 2: the profile (new session)

First confirm the install took, and go back to Phase 1 if any of these fail:

- `$JOB_TRACKER_HOME` and `$JOB_TRACKER_DATA` are set in the shell.
- `pdflatex`, `pdfinfo` and `pdftocairo` all run.
- The `job-tracker:onboard` skill is listed.
- `mcp__job-tracker__list_leads` answers with an empty list (load it with ToolSearch).
- `/jobs` opens the board. It is empty for now.

Then run the onboard skill. It takes their résumé and writing samples and interviews them to write
everything under `data/profile/`. Scout stops without `profile/preferences.md`, and package also stops without
the résumé files, so finish it before anything else.

### After onboarding

#### Job alerts

Scout reads alert emails instead of visiting job sites, so more alerts means more leads.

**Person:** create saved job alerts on whichever of these they use, sent to the Gmail account from
Phase 1, using the target roles and location in `profile/preferences.md`:

| Source                       | Scout's source label | Sender it matches                       |
| ---------------------------- | -------------------- | --------------------------------------- |
| LinkedIn                     | `gmail:linkedin`     | `linkedin.com`                          |
| Indeed                       | `gmail:indeed`       | `indeed.com`                            |
| Wellfound                    | `gmail:wellfound`    | `wellfound.com`, `angel.co`             |
| Glassdoor                    | `gmail:glassdoor`    | `glassdoor.com`, `glassdoor.ca`         |
| YC Work at a Startup         | `gmail:yc`           | `workatastartup.com`, `ycombinator.com` |
| Welcome to the Jungle / Otta | `gmail:wttj`         | `welcometothejungle.com`, `otta.com`    |

Anything else with "job alert", "job alerts" or "new jobs" in the subject is also read, as
`gmail:other`. The list lives in `GMAIL_SOURCES` in `bin/lib/gmail.ts` and also has British Columbia
sources, which are harmless elsewhere. A sender whose subjects don't match, such as a national board writing in another language, is not
read until it has a line there.

#### The schedule

These run in their own sessions while the desktop app is open; a run missed while it is closed
happens at next launch. Create them with the `create_scheduled_task` tool, or by hand under Sidebar
→ Scheduled.

| Task                        | When                     | Cron                     | Prompt |
| --------------------------- | ------------------------ | ------------------------ | ------ |
| `job-tracker-scout`         | Weekdays 8, 12, 16, 20   | `0 8,12,16,20 * * 1-5`   | Scout  |
| `job-tracker-scout-weekend` | Saturday, Sunday 12:00   | `0 12 * * 0,6`           | Scout  |
| `job-tracker-learn`         | Sunday 18:00             | `0 18 * * 0`             | Learn  |
| `job-tracker-tsenta`        | Daily 8:30 to 20:30, 3 h | `30 8,11,14,17,20 * * *` | Tsenta |

Only create `job-tracker-tsenta` if they connected Tsenta. Ask if they want fewer runs: each scout
run uses a fair amount of their Claude allowance.

**Scout prompt:**

```text
Use the job-tracker:scout skill from the job-tracker plugin to find new job postings, score them against the preferences and learnings, and add the good ones to the New column of the job board.

The data folder is $JOB_TRACKER_DATA and the board CLI is `node "$JOB_TRACKER_HOME/bin/jobs.ts"` (both set in ~/.claude/settings.json; if either is empty, stop and say so). Follow the skill's steps exactly: one subagent per source in parallel, dedupe against `jobs seen`, score with preferences.md and learnings.md, `jobs add`, a PushNotification only for leads scored 90 or more, and one line appended to scout/runs.md.

Hard rules: never apply, submit, email, message, create accounts or log in anywhere; never open or scrape LinkedIn or Indeed pages (their alert emails in Gmail are the only route); never invent postings. Finish with a reply of three lines or fewer.
```

**Learn prompt:**

```text
Use the job-tracker:learn skill from the job-tracker plugin to review this week's job-search feedback (pass reasons, score corrections, edits to drafted packages, outcomes by source) and write a reviewable proposal plus a short funnel summary with `jobs propose`.

The data folder is $JOB_TRACKER_DATA and the board CLI is `node "$JOB_TRACKER_HOME/bin/jobs.ts"` (both set in ~/.claude/settings.json; if either is empty, stop and say so). Never edit profile/learnings.md or profile/preferences.md directly: the person approves the proposal in /jobs. Never send email or messages. Finish with the summary and the number of proposed changes.
```

**Tsenta prompt:** replace `<country>` and `<city and region>` with the person's, using Tsenta's
`resolve-locations` tool for the exact values.

```text
Pull fresh job postings from Tsenta (the connected Tsenta MCP server, tools named `get-job-recommendations` and `get-jobs-by-ids`) and add the good ones to the job-tracker board. Tsenta is only a job SOURCE here: the person applies through job-tracker, never through Tsenta.

The data folder is $JOB_TRACKER_DATA and the board CLI is `node "$JOB_TRACKER_HOME/bin/jobs.ts"` (both set in ~/.claude/settings.json; if either is empty, stop and say so). Read the job-tracker:scout skill (skills/scout/SKILL.md in $JOB_TRACKER_HOME) for the scoring rubric, the field rules (fitReason, companyBlurb, tagline at most 40 characters, roleHighlights) and the candidates-file format; follow its steps 1, 3, 4, 5, 8 and 9, but with Tsenta as the ONLY source (do not run the ATS, local, Gmail, web or HN sources; the regular scout task does those). Read profile/preferences.md and profile/learnings.md first, every run.

Fetching from Tsenta (no subagent needed):
1. Run `jobs init` and `jobs seen`.
2. Call `get-job-recommendations` with `datePosted: "24h"`, `limit: 50` and `roleFamilies` matching preferences.md, three ways, each paging (`page` 2, 3, ...) while `hasMore` is true, at most 3 pages per query:
   a. `locations: [<country>]`
   b. `workplaceTypes: ["REMOTE"]` with no location filter
   c. `locations: [<city and region>]`
   Results are large: if a call's output is saved to a file instead of shown, read that file with a short node script and keep only the fields you need.
3. Merge by Tsenta `id`, then drop anything older than 24 hours (`datePosted`), anything on the seen list (same URL, or same company and role), and anything that is plainly a dealbreaker in preferences.md by the structured fields alone.
4. For the survivors, call `get-jobs-by-ids` (up to 20 ids per call, `descriptionMaxChars: 1500`) to read the descriptions, and build each posting as `{ company, role, url, location, comp, source: "tsenta", description, postedAt }`: `url` is the posting's own `url` field (the company's ATS link, never a Tsenta page), `comp` from salaryMin/salaryMax/salaryCurrency/salaryPeriod as posted ("" when null), `postedAt` is `datePosted`.
Then score, write `$JOB_TRACKER_DATA/scout/candidates-<YYYYMMDD-HHMM>.json` and run `jobs add @<file>`, then the `jobs summaries` backfill, exactly as the scout skill says. Send a PushNotification only for leads scored 90 or more. Append one line to scout/runs.md in the skill's format, with the per-source part as `tsenta <n> (<k> after 24h/seen/dealbreaker filter)`.

Hard rules: Tsenta is read-only. Never call any Tsenta tool that changes anything: no apply-to-job, apply-with-custom-resume, approve-application, submit-application-review, update-feed-filters, set-keyword-search, set-apply-preferences, commit-auto-apply-config, track-application, resume or profile edits, inbox replies or feedback. Never apply, submit, email, message, create accounts or log in anywhere; never open or scrape LinkedIn or Indeed pages; never invent postings or facts. If the Tsenta tools are missing or need re-authorization, append that to runs.md, send one PushNotification saying "Tsenta needs reconnecting in /mcp", and stop. Finish with a reply of three lines or fewer.
```

Check each task after creating it:

- **Clock.** Compare the task's next run time with the intended local time. The cron field is
  documented as local time, but one Windows install runs it at UTC-8 whatever the PC's time zone. If
  a next run is off, shift that cron by the difference and say so in the task's description.
- **Permissions.** A scheduled run has nobody to answer a permission prompt, so a prompt stalls it.
  Runs need Bash for `node`, Write in the data folder, WebSearch, WebFetch, subagents, Gmail, and
  the `mcp__job-tracker__*` tools. Have the person choose a permission mode or allow-list they are
  comfortable with, then start one scout run by hand with `run_scheduled_task` and confirm it
  finishes and appends a line to `scout/runs.md`.

**Person:** for push notifications on leads scoring 90 or more, install the Claude mobile app,
sign in, and turn on agent push notifications in Claude settings. Optional: leads still appear on
the board without them.

#### Finish

Confirm with the person that:

- `/jobs` shows the first leads, and the band above the prompt shows their count.
- "Draft package" on one card produces a résumé PDF, and "Review" shows it.
- The scheduled tasks are on.

Then report what was installed, what was skipped, and anything still waiting on them.

## Good to know

- **Location.** `jobs ats` keeps postings workable from Canada, and `jobs ats --all` keeps every
  posting. The onboard skill records people based elsewhere in `preferences.md`, and scout then
  uses `--all` and filters by their location itself.
- **Updating.** `git pull` in `job-tracker/`, then start a new session.
- **Data.** Keep `data/` out of git and back it up: it is the only copy of the board and the
  profile.
- **Safety.** Claude never sends an application without a yes in chat, and never signs in, solves a
  CAPTCHA or accepts an agreement. Those come back to the person. Review each form before saying
  yes: when several prefills share one Chrome window, stay alert for a submitted tab and check for
  a confirmation email.
- **Uninstalling.** Delete the scheduled tasks, remove the four `env` keys and delete the
  `job-tracker` folder. `data/` is the person's to keep or delete.
