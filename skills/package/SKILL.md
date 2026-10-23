---
name: package
description: Build a tailored application package for one job lead on the board — résumé compiled to PDF from the person's LaTeX template using only approved facts, cover letter, answers to the posting's questions, company brief and a warm-intro search with a Gmail draft — then move the card to Ready to review. Always runs in a background subagent, never in the person's conversation. Use when asked to draft, build or prepare an application for a lead.
---

# Package

Build everything the person needs to apply to one lead, to the quality of the examples in
`$JOB_TRACKER_DATA/profile/prior-research/` (earlier applications and tailored résumés).
You never submit, send an email, or invent a fact.

## Where this runs

A build takes several minutes, so it always runs in a background subagent, never in the
person's own conversation. The board's Draft package button starts one itself. If you are the
person's conversation and they ask you to draft, build or redraft a package, do not follow the
steps below: call `mcp__job-tracker__draft_package` with the lead id (load it with ToolSearch if
needed) and reply in one line. Only if that tool is missing or reports that the subagent did not
start, launch one yourself: the Agent tool, `subagent_type: "general-purpose"`,
`run_in_background: true`, with a prompt to use this skill for that lead (and `--redraft` when
the lead already has a package). Then reply in one line. If you are that subagent, carry on
below: nobody can answer you, so never stop to ask a question.

## Paths

- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`; data folder `$JOB_TRACKER_DATA`.
- Package folder: `$JOB_TRACKER_DATA/packages/<lead-id>/`. Write these names exactly:
  `posting.md`, `resume.tex`, `resume.pdf`, `cover-letter.md`, `answers.md`, `company-brief.md`,
  `warm-intro.md`, `sources.md`.
- Profile (read before writing anything):
  - `profile/knowledge-base/application-answers.md` — read first: the person's own answers to
    application questions, saved word for word by the submit skill, each with its question, date
    and scope. A question answered there is never left as `NEEDS ANSWER`.
  - `profile/resume-generation-rules.md` — how a tailored résumé is built. Obey it.
  - `profile/master-resume.tex` — the only approved résumé wording.
  - `profile/resume-format-template.tex` — the mandatory layout, section order and level of
    detail. Its wording is a sample of that shape, never a source.
  - `profile/knowledge-base/` — indexed, source-linked facts (start at its `README.md`; read only
    the records relevant to this role).
  - `profile/cover-letter-prompts.md` — reusable stories and answers.
  - `profile/UNANSWERED-QUESTIONS.md`, `profile/OPEN-QUESTIONS.md`, `profile/learnings.md`.

## Steps

1. Find the lead: `jobs list` and pick the id you were given. Run
   `jobs move <id> drafting --by package` (a card the board already moved there stays put).
2. Get the posting. WebFetch its URL unless it is a LinkedIn or Indeed URL; for those, find the
   same role on the company's own careers page or ATS board instead. If the full posting cannot be
   found, say so and work from what the lead and the alert email give. Save the posting's text with
   its URL and the date to `posting.md`. Note every application-form question the posting or its
   public apply page shows.
3. Résumé. Start from `resume-format-template.tex`: keep its preamble, fonts, margins, header,
   section rules and custom commands byte for byte, keep its section order, and match its level of
   detail (about as many entries and bullets per section as it has, on one page). Leave out its
   instruction comment at the top of the file. Replace all of
   its body text: pull roles, projects, bullets and skills fresh from `master-resume.tex` and the
   knowledge base, choosing what fits this posting, following `resume-generation-rules.md` (fast
   scanning; no keyword tagline; no technology added for keywords). You may shorten or
   reorder approved wording; you may not broaden scope, add metrics, change dates or claim planned
   work as done. For every bullet you keep, write a line in `sources.md`: the bullet, then the
   master-résumé line or knowledge-base file it came from. If something the posting wants is not
   in the record, leave it out and list it under "Gaps" in `sources.md`.
4. Compile in the package folder: `pdflatex -interaction=nonstopmode -halt-on-error resume.tex`
   (run it twice). MiKTeX and TeX Live both work; if `pdflatex` is missing, look for it under
   `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`. Check `pdfinfo resume.pdf`: one page is the
   target, two the most. Fix overflow by cutting content, never by changing the layout. Delete the
   `.aux`, `.log` and `.out` files when it compiles.
5. Cover letter (`cover-letter.md`): at most 300 words, specific to this company and role, in the
   person's voice from `cover-letter-prompts.md`; open with why this company, give two concrete
   pieces of evidence from the record, end with a short ask. No facts outside the record.
6. Answers (`answers.md`): every question found in step 2, each with a drafted answer from the
   record and the prompt bank. First look each one up in `application-answers.md`: where the
   same question (or one asking for the same fact) was answered and its scope covers this
   application, use that answer word for word; when it was answered more than once, the latest
   entry wins. Reuse other recorded answers exactly where they apply (work authorization,
   sponsorship, travel commitments) and only within their stated limits. Where nothing on record
   answers it (salary expectation, start date, a disclosure), write `NEEDS ANSWER:` and the
   question instead of guessing; submit asks the person and saves the answer.
7. Company brief (`company-brief.md`): what they build and for whom, stage and funding, team size,
   stack, recent news, why it fits, risks and red flags (reviews, runway), and three sharp questions
   to ask. Link every claim's source.
8. Warm intro (`warm-intro.md`): search Gmail for the company's name and email domain
   (`search_threads`) and the knowledge base for people connected to it. List who might introduce
   or refer the person and why. If one clear contact with an email address exists, create **one
   Gmail draft** (`create_draft`, never send) with a short, specific ask, and record its draft id.
   If there is none, say so; do not draft to a stranger.
9. Register the package: `jobs package <id>` (add `--draft-id <gmail draft id>` when you drafted
   one, `--redraft` when you rebuilt a package the person already saw). It renders the résumé
   preview for the pane, writes `resume.diff` against the master, snapshots the draft for the
   learning loop and moves the card to Ready to review — but only if the card is still in
   Drafting. The person keeps triaging the board while you build; if they moved the card
   elsewhere meanwhile (Archived, Passed or any other column), the files are still registered and
   the card stays where they put it. The output then has a `notice` and `column` says where the
   card is. That is not a failure: do not move the card yourself or retry.
10. Reply briefly: what is in the package, any `NEEDS ANSWER` items and gaps, and "Review it in
    /jobs → the card → Review." If step 9 printed a `notice`, say the package is saved and the
    card stays in its column (name it) because they moved it during the build. Keep the first
    line short and complete: the board shows it as a toast when the build ends.

## Rules

- Never submit an application, send an email or message, or create an account.
- Never invent, broaden or combine résumé facts. Generated packages are outputs, never evidence.
- Do not modify anything under `profile/`. It changes only through the learn skill's approved
  proposals, with one exception that is not yours: the submit skill appends the person's own
  answers to `profile/knowledge-base/application-answers.md`. Read that file; never write it.
