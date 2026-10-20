---
name: scout
description: Find new job postings for the person's job search, score each 0-100 against their preferences and learnings, and add the good ones to the New column of the job board. Runs on a schedule several times a weekday; also on request ("scout for jobs", "find new roles").
---

# Scout

Find roles worth the person's time, score them honestly, and put the good ones on the board.
You never apply, email anyone, create accounts, or log into job sites.

## Paths

- Data folder: `$JOB_TRACKER_DATA` (check it is set: `echo "$JOB_TRACKER_DATA"`; if empty, stop and
  say SETUP.md explains it).
- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`. Every board change goes through it. Never
  edit `leads.json` by hand.
- Read first, every run: `$JOB_TRACKER_DATA/profile/preferences.md` (roles, level, location,
  dealbreakers and the scoring rubric), `profile/learnings.md` (approved adjustments: they override
  the rubric), `profile/target-companies.md` (companies and local job sources) and
  `profile/OPEN-QUESTIONS.md` (defaults in force).

## Steps

1. Run `jobs init`, then `jobs seen` and keep the list: anything already on the board, in any
   column (Passed included), is not new. Note today's date and time.
2. Launch one subagent per source below, **all in one message so they run in parallel**. Give each
   the preferences summary (roles, level, location, dealbreakers) and the seen list, and ask for a
   JSON array only, each item `{ company, role, url, location, comp, source, description, postedAt }`
   with `description` at most 800 characters of the posting's own words. Tell each: do not apply,
   do not log in anywhere, do not open linkedin.com or indeed.com pages, drop anything on the seen
   list, drop postings older than 30 days, and return at most 25 items.
   - **ATS boards** (`source: "greenhouse" | "lever" | "ashby"`): run `jobs ats`, read the file it
     names, keep engineering roles (backend, platform, API, data, applied AI, full-stack, integration,
     automation; not sales, design, support, legal or finance roles). To widen coverage it may run
     `jobs probe <slug> --company "<name>"` for target companies not yet in `ats-boards.json` and
     report any board it finds so you can add it to that file.
   - **Local sources** (`source: "<board name>"` or `"careers:<company>"`): the local job boards
     listed under "sources" in `target-companies.md` and the careers pages of the local companies
     listed there, with WebFetch. Note closing dates when shown.
   - **Gmail** (sources `gmail:linkedin`, `gmail:indeed`, `gmail:wellfound`, `gmail:glassdoor`,
     `gmail:yc`, `gmail:wttj`, `gmail:bctechjobs`, `gmail:viatec`, and the news signals
     `signal:betakit`, `signal:victechjournal`, `signal:vantechjournal`): run `jobs gmail query`.
     It prints the Gmail `query` for every job email since the last run (an hour of overlap; the
     last 7 days on a first run) and the `sources`, each with its `kind` and sender tokens. Search
     Gmail with exactly that query, paging until there is no next page, and read each thread.
     Give each email the source whose sender token appears in its sender's address.
     - `alert` emails list postings: extract each posting's title, company, location, pay and link
       from the email itself. VIATEC's "The Loop" is a weekly newsletter: take only its job board
       section (links to `members.viatec.ca/job-board`). A YC Work at a Startup message from a
       founder is a lead too (`description` says a founder wrote). Welcome, onboarding and
       marketing emails with no postings give nothing.
     - `signal` emails are news, not postings: return the companies in British Columbia, or hiring
       remotely in Canada, that just raised money, launched, or said they are hiring, as
       `{ company, event, amount, location, url }` (the article's link).
     - Return `{ postings, signals, newest }`, `newest` being the date of the newest email read.
     Never visit LinkedIn, Indeed, Glassdoor, Wellfound, YC or Welcome to the Jungle: the email is
     the source. Where the email gives only a LinkedIn link, keep it as `url`; package will look
     for the company's own posting.
   - **Web search** (`source: "web"`): WebSearch for this week's postings, built from
     `preferences.md`: each target role with the person's city, then with "remote" and their
     country, then the target industries (e.g. `<role> "<city>"`, `junior <role> remote <country>`,
     `<industry> software engineer remote <country>`). Prefer the company's own careers page or ATS
     link over aggregators.
   - **HN Who's Hiring** (`source: "hn"`): fetch
     `https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=3`,
     take the latest "Who is hiring?" story, then
     `https://hn.algolia.com/api/v1/search?tags=comment,story_<id>&hitsPerPage=1000` and keep
     comments whose location the person can work from (per `preferences.md`), or REMOTE without a
     limit that excludes them, and a
     backend/AI/data role. `url` is the company's application link from the comment, else
     `https://news.ycombinator.com/item?id=<comment id>`.
3. Merge the arrays, drop duplicates (same company and role, or same URL) and anything seen.
4. Score every remaining posting 0-100 with the rubric in `preferences.md`, then apply every rule in
   `learnings.md`. Be strict: a senior-only role, a student-only role, pay wholly under the floor,
   US-only remote or relocation is a dealbreaker (under 40). Write `fitReason` as one line naming
   the two or three biggest factors, e.g. `Backend APIs + applied AI, hybrid in their city; asks 3+ yrs`.
   Keep `comp` as posted ("" if none) and `location` as posted.
5. Write the scored list to `$JOB_TRACKER_DATA/scout/candidates-<YYYYMMDD-HHMM>.json` as a JSON array of
   `{ company, role, url, source, location, comp, fitScore, fitReason, closesAt? }` and run
   `jobs add @<that file> --threshold 60`. It dedupes again, drops anything under 60, and prints
   `added`, `updated`, `dropped` and `alerts` (added leads scored 90+).
6. If the Gmail source finished without an error, run `jobs gmail done <newest>` so the next run
   starts there. If it failed or was cut short, skip this: the next run reads the same mail again.
7. Funding and hiring signals: for each signal company not already in `profile/ats-boards.json`,
   try `jobs probe <slug> --company "<name>"` with its likely slugs (lowercase name, no spaces or
   punctuation). When a public board is found, run `jobs board-add "<name>" <ats> <slug>`; its
   engineering roles are read from the next run on. Append each signal, found or not, as one line
   to `$JOB_TRACKER_DATA/scout/signals.md`: `<date> · <company> · <event> · <board or "no public board"> · <url>`.
   Never edit `target-companies.md`; the weekly learn review proposes additions from `signals.md`.
8. If `alerts` is not empty, send one PushNotification naming them, e.g.
   `2 strong job leads: <Company> — <Role> (93), ... Open /jobs.` Send none
   otherwise.
9. Append one line to `$JOB_TRACKER_DATA/scout/runs.md`:
   `<ISO time> · <n> found per source (ats a, local b, gmail c [per gmail source], web d, hn e) · signals s · boards added b · added x · dropped y · errors: ...`
10. Reply in three lines or fewer: how many were added, the best two with scores, new boards from
    signals, and any source that failed. Do not paste the whole list.

## Rules

- Never submit, apply, email, message or create an account. Never log into or scrape LinkedIn,
  Indeed, Glassdoor, Wellfound, YC Work at a Startup or Welcome to the Jungle; their emails in
  Gmail are the only route. Never click links in emails (unsubscribe, confirm, apply).
- Never invent a posting, a salary or a location. If a field is unknown, leave it empty.
- A source that fails is reported, not retried in a loop.
