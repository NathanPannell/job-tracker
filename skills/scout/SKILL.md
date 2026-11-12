---
name: scout
description: Find new job postings for the person's job search, score each 0-100 against their preferences and learnings, and add the good ones to the New column of the job board. Runs on a schedule several times a weekday; also on request ("scout for jobs", "find new roles").
---

# Scout

Find roles the person has a real chance at, score them honestly, and put the good ones on the
board. You never apply, email anyone, create accounts, or log into job sites.

## Paths

- Data folder: `$JOB_TRACKER_DATA` (check it is set: `echo "$JOB_TRACKER_DATA"`; if empty, stop and
  say INSTALL.md explains it).
- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`. Every board change goes through it. Never
  edit `leads.json` by hand.
- Read first, every run, under `$JOB_TRACKER_DATA/profile/`: `preferences.md` (roles, level,
  location, dealbreakers and the scoring rubric), `learnings.md` (approved adjustments: they
  override the rubric), `target-companies.md` (companies and local job sources) and
  `OPEN-QUESTIONS.md` (defaults in force). If `preferences.md` is missing, stop and say to run the
  job-tracker:onboard skill first.

## Steps

1. Run `jobs init`, then `jobs seen` and keep the list: anything already on the board, in any
   column, is not new. Note today's date and time.
2. Launch one subagent per source below, **all in one message so they run in parallel**. Give each
   the preferences summary (roles, level, location, dealbreakers), the seen list and the full CLI
   command for any `jobs` call it makes (`node "$JOB_TRACKER_HOME/bin/jobs.ts" ats`, `... probe`,
   `... gmail query`), and ask for
   JSON only: an array of `{ company, role, url, location, comp, source, description, postedAt }`,
   `description` being at most 1500 characters of the posting's own words about the company and
   what sets the role apart (team, stack, years asked, comp, setup). Tell each: do not apply, do not
   log in, do not open linkedin.com or indeed.com, drop anything seen or older than 14 days, and
   return at most 25 items (Gmail has no cap: every email it reads is marked read).
   - **ATS boards** (`source: "greenhouse" | "lever" | "ashby"`): run `jobs ats` and read the file
     it names. It keeps only postings workable from Canada; when `preferences.md` says
     `ATS filter: outside Canada`, run `jobs ats --all` and drop what the person cannot work from.
     Keep roles matching the targets in `preferences.md`. It may run
     `jobs probe <slug> --company "<name>"` for target companies not yet in `ats-boards.json` and
     report any board it finds.
   - **Local sources** (`source: "<board name>"` or `"careers:<company>"`): the job boards and
     local companies' careers pages listed in `target-companies.md`, with WebFetch. Note closing
     dates when shown.
   - **Gmail** (sources `gmail:linkedin`, `gmail:indeed`, `gmail:wellfound`, `gmail:glassdoor`,
     `gmail:yc`, `gmail:wttj`, `gmail:bctechjobs`, `gmail:viatec`, `gmail:other`, and the news
     signals `signal:betakit`, `signal:victechjournal`, `signal:vantechjournal`): run
     `jobs gmail query`. It prints the Gmail `query` for every job email since the last run and the
     `sources`, each with its `kind` and sender tokens. Search Gmail with exactly that query, paging
     to the end, and read each thread. An email's source is the one whose sender token is in its
     sender's address, else `gmail:other`.
     - `alert` emails list postings: take each one's title, company, location, pay and link from
       the email. From VIATEC's weekly "The Loop", take only the job board section. A YC Work at a
       Startup message from a founder is a lead (say so in `description`). Welcome and marketing
       emails give nothing.
     - `signal` emails are news: return companies in the person's region, or hiring remotely in
       their country, that just raised money, launched or said they are hiring, as
       `{ company, event, amount, location, url }`.
     - Return `{ postings, signals, newest }`: `newest` is the time of the newest email fully
       returned, in UTC ending in `Z`, or `null` when nothing matched. If it stopped early,
       `newest` is the newest email before the first one it did not finish.
     Never visit LinkedIn, Indeed, Glassdoor, Wellfound, YC or Welcome to the Jungle: the email is
     the source. Where it gives only a LinkedIn link, keep it as `url`.
   - **Web search** (`source: "web"`): WebSearch for this week's postings from `preferences.md`:
     each target role with the person's city, then with "remote" and their country, then the
     target industries with "software engineer" and their country. Prefer the
     company's own careers page or ATS link over aggregators.
   - **HN Who's Hiring** (`source: "hn"`): fetch
     `https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=3`,
     take the latest "Who is hiring?" story, then
     `https://hn.algolia.com/api/v1/search?tags=comment,story_<id>&hitsPerPage=1000`, and keep
     comments with a location the person can work from and a matching role. `url` is the
     comment's application link, else `https://news.ycombinator.com/item?id=<comment id>`.
3. Merge the arrays and drop duplicates (same company and role, or same URL) and anything seen.
4. Score every remaining posting 0-100 with the rubric in `preferences.md`, then apply every rule
   in `learnings.md`. The score is the person's chance of getting an interview, not how much they
   would like the job. Anything under Dealbreakers in `preferences.md` scores under 40. Be
   strict about level: years, title, degree or a yes/no knockout question
   the person cannot meet is a dealbreaker (under 40), as `preferences.md` and `learnings.md` set
   out. Score fit only, not the posting's age: `jobs add` handles age. Write `fitReason` as one line
   naming the two or three biggest factors, e.g. `Junior backend APIs in Java, hybrid in their
   city`. Keep `comp` and `location` as posted ("" if none).
   For each posting scoring 70+, also write what the card shows:
   - `companyBlurb`: one sentence saying concretely what the company makes: the product category,
     who it is for, and the flagship product by name when known, e.g. `Builds scheduling software
     for home-care agencies; Series A, ~60 people.` Size, stage or location may follow as a second
     clause, never alone. When the posting does not say, look it up: the company's own site, then
     a WebSearch (read the results only; never open the sites the Rules forbid). If it still cannot
     be found, say so plainly: `What <Company> builds isn't stated in the posting or on its site.`
   - `tagline`: at most 40 characters (count them), one line, no company name, no size, stage,
     funding, location or full stop: the product or category and who it is for, e.g. `Home-care
     scheduling software`, or what the role is when the product is unknown, e.g. `Backend APIs for
     an unnamed fintech`. Write it from the `companyBlurb`.
   - `roleHighlights`: 2-4 points under 15 words each on what is distinctive (team, product,
     stack, comp, setup), not generic duties. Leave it out rather than guess.
5. Write the scored list to `$JOB_TRACKER_DATA/scout/candidates-<YYYYMMDD-HHMM>.json` as an array
   of `{ company, role, url, source, location, comp, fitScore, fitReason, companyBlurb?, tagline?,
   roleHighlights?, postedAt?, closesAt? }` (`postedAt` in ISO, omitted when unknown) and run
   `jobs add @<that file> --threshold 70`. It dedupes again, drops leads under 70 or posted over 14
   days ago, archives New leads whose posting is over 14 days old, marks Applied leads with no
   reply a month after submitting as ghosted, and prints `added`, `updated`, `dropped`,
   `archived`, `ghosted`, `alerts` (added leads scoring 90+) and `warnings` (taglines it refused).
   Then backfill: `jobs summaries` lists open leads missing a `companyBlurb`, `tagline` or
   `roleHighlights` (`{ id, company, role, url, source, missing, companyBlurb? }`). Where only
   `tagline` is missing, write it from the `companyBlurb`, for every such lead. For up to 15
   others, read the posting (for a LinkedIn or Indeed link, the company's own posting; if none is
   found, write only `companyBlurb` and `tagline`) and write the missing fields. Save them as
   `$JOB_TRACKER_DATA/scout/summaries-<YYYYMMDD-HHMM>.json`, an array of
   `{ id, companyBlurb?, tagline?, roleHighlights? }`, and run `jobs summaries @<that file>`. It
   refuses a tagline over 60 characters: shorten it and run again.
6. Run `jobs gmail done <newest>` only when the Gmail source returned without an error, `newest`
   is not null, and `jobs add` succeeded. Otherwise skip it: the next run reads the same mail.
7. Signals: for each signal company not in `profile/ats-boards.json`, try
   `jobs probe <slug> --company "<name>"` with its likely slugs (lowercase, no spaces or
   punctuation), and when a board is found run `jobs board-add "<name>" <ats> <slug>`. Append each
   signal to `$JOB_TRACKER_DATA/scout/signals.md` as
   `<date> · <company> · <event> · <board or "no public board"> · <url>`. Never edit
   `target-companies.md`; the weekly learn review proposes additions.
8. If `alerts` is not empty, send one PushNotification naming them, e.g.
   `2 strong job leads: <Company> — <Role> (<fitScore>), ... Open /jobs.` If `ghosted` is not
   empty, send one more naming them (`jobs list --column archived` has company and role), e.g.
   `Marked ghosted, no reply a month after applying: <Company> — <Role>. Back to Applied on the
   card undoes it.`
9. Append one line to `$JOB_TRACKER_DATA/scout/runs.md`:
   `<ISO time> · <n> found per source (ats a, local b, gmail c [per gmail source], web d, hn e) · signals s · boards added b · added x · dropped y · ghosted g · errors: ...`
10. Reply in three lines or fewer: how many were added, the best two with scores, new boards,
    applications marked ghosted, and any source that failed.

## Rules

- Never submit, apply, email, message or create an account. Never log into or scrape LinkedIn,
  Indeed, Glassdoor, Wellfound, YC Work at a Startup or Welcome to the Jungle; their emails are the
  only route. Never click links in emails.
- Never invent a posting, a salary, a location or a company fact. Leave an unknown field empty.
- A source that fails is reported, not retried in a loop.
