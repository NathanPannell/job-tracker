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
   the preferences summary (roles, level, location, dealbreakers) and the seen list, and ask for
   JSON only: an array of postings (the Gmail source returns the object described below), each
   item `{ company, role, url, location, comp, source, description, postedAt }` with `description`
   at most 1500 characters of the posting's own words, keeping what it says about the company
   and what sets the role apart (team, stack, comp, setup). Tell each: do not apply, do not log in
   anywhere, do not open linkedin.com or indeed.com pages, drop anything on the seen list, drop
   postings older than 30 days, and return at most 25 items. The Gmail source has no cap: every
   email it reads is marked read, so it returns every relevant posting in those emails.
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
     Give each email the source whose sender token appears in its sender's address, and
     `gmail:other` to a job alert from any other sender (the query also matches "job alert" and
     "new jobs" subjects).
     - `alert` emails list postings: extract each posting's title, company, location, pay and link
       from the email itself. VIATEC's "The Loop" is a weekly newsletter: take only its job board
       section (links to `members.viatec.ca/job-board`). A YC Work at a Startup message from a
       founder is a lead too (`description` says a founder wrote). Welcome, onboarding and
       marketing emails with no postings give nothing.
     - `signal` emails are news, not postings: return the companies in British Columbia, or hiring
       remotely in Canada, that just raised money, launched, or said they are hiring, as
       `{ company, event, amount, location, url }` (the article's link).
     - Return `{ postings, signals, newest }`. `newest` is the time of the newest email whose
       postings and signals were all returned, in UTC ending in `Z` (Gmail's `internalDate`
       converted), or `null` when the query matched nothing. If it had to stop early, `newest` is
       the newest email before the first one it did not finish, so nothing unread is skipped.
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
   Keep `comp` as posted ("" if none) and `location` as posted. Score the fit only, not the
   posting's age: the board ages scores itself from `postedAt`.
   For each posting you keep (60+), also write what the person sees when they open the card;
   `fitReason` stays the match one-liner on the card:
   - `companyBlurb`: one sentence that says concretely what the company makes: the product
     category, who it is for, and the flagship product or app by name when one is known. Stage,
     size or location may follow as a second clause, never on their own. E.g.
     `Builds scheduling software for home-care agencies; Series A, ~60 people.`,
     `Makes consumer productivity apps for iOS and Android; its main app is <App>.` or
     `Offers business banking for startups; <Product> is its LLM-powered finance assistant.`
     Not `<City>-based startup of 1-10 employees, hiring and growing fast.`: size, location,
     funding and "fast-growing" or "hiring" say nothing about the product, so never pad with them.
     When the posting does not say what the company makes, look it up before writing: the
     company's own site first, then a WebSearch for the company, whose results from its Wellfound
     or LinkedIn company page, app store listing or press coverage usually name the product (read
     the search results only; the Rules below still forbid visiting those sites). If it still
     cannot be found, say so plainly, e.g. `What <Company> builds isn't stated in the posting or
     on its site; <City>, 1-10 people.`
   - `roleHighlights`: 2-4 short points (under 15 words each) on what is distinctive about this
     role: team, product, stack, comp or equity, remote setup, anything unusual. Not the
     generic duties every posting lists.
   Take both from the posting's `description` and, where that is thin, the company's own posting
   or careers page (never LinkedIn or Indeed), plus the lookup above for `companyBlurb`. Never
   invent a fact: leave `roleHighlights` out rather than guess.
5. Write the scored list to `$JOB_TRACKER_DATA/scout/candidates-<YYYYMMDD-HHMM>.json` as a JSON array of
   `{ company, role, url, source, location, comp, fitScore, fitReason, companyBlurb?, roleHighlights?, postedAt?, closesAt? }`
   (`postedAt` as the source gave it, ISO; omit it when unknown) and run
   `jobs add @<that file> --threshold 60`. It dedupes again, drops a new lead whose score, aged by
   `postedAt`, is under 60 (10 points off a day, so an older posting must fit better to get on)
   or whose posting is over 7 days old, archives New leads past 7 days, and prints `added`,
   `updated`, `dropped`, `archived` and `alerts` (added leads whose aged `score` is 90+).
   Then backfill: `jobs summaries` lists open leads still missing a `companyBlurb` or
   `roleHighlights` (`{ id, company, role, url, source }`). For each, read the posting at `url`
   (when it is a LinkedIn or Indeed link, find the role on the company's own careers page or ATS
   board instead; if you cannot find it, write only a missing `companyBlurb`, from the lookup
   above), write the missing fields by the same rules, save them as
   `$JOB_TRACKER_DATA/scout/summaries-<YYYYMMDD-HHMM>.json`, an array of
   `{ id, companyBlurb?, roleHighlights? }`, and run `jobs summaries @<that file>`. It prints the
   `updated` ids and any `errors`. At most 15 leads per run; the rest wait for the next one.
6. Run `jobs gmail done <newest>` only when all of these hold: the Gmail source returned without
   an error, `newest` is not null, and `jobs add` in step 5 succeeded. Otherwise skip it: the next
   run reads the same mail again (dedupe keeps the board clean).
7. Funding and hiring signals: for each signal company not already in `profile/ats-boards.json`,
   try `jobs probe <slug> --company "<name>"` with its likely slugs (lowercase name, no spaces or
   punctuation). When a public board is found, run `jobs board-add "<name>" <ats> <slug>`; its
   engineering roles are read from the next run on. Append each signal, found or not, as one line
   to `$JOB_TRACKER_DATA/scout/signals.md`: `<date> · <company> · <event> · <board or "no public board"> · <url>`.
   Never edit `target-companies.md`; the weekly learn review proposes additions from `signals.md`.
8. If `alerts` is not empty, send one PushNotification naming them, e.g.
   `2 strong job leads: <Company> — <Role> (<score>), ... Open /jobs.` Send none
   otherwise.
9. Append one line to `$JOB_TRACKER_DATA/scout/runs.md`:
   `<ISO time> · <n> found per source (ats a, local b, gmail c [per gmail source], web d, hn e) · signals s · boards added b · added x · dropped y · errors: ...`
10. Reply in three lines or fewer: how many were added, the best two with scores, new boards from
    signals, and any source that failed. Do not paste the whole list.

## Rules

- Never submit, apply, email, message or create an account. Never log into or scrape LinkedIn,
  Indeed, Glassdoor, Wellfound, YC Work at a Startup or Welcome to the Jungle; their emails in
  Gmail are the only route. Never click links in emails (unsubscribe, confirm, apply).
- Never invent a posting, a salary, a location or a company fact. If a field is unknown, leave it
  empty (or out, for `roleHighlights`); a `companyBlurb` whose product cannot be found says so
  plainly instead of guessing.
- A source that fails is reported, not retried in a loop.
