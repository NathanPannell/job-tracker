---
name: package
description: Build a tailored application package for one job lead on the board — résumé compiled to PDF from the person's LaTeX template using only approved facts, cover letter, answers to the posting's questions and company brief — then move the card to Ready to apply. Always runs in a background subagent, never in the person's conversation. Use when asked to draft, build or prepare an application for a lead.
---

# Package

Build everything the person needs to apply to one lead. You never submit, send an email, or
invent a fact.

## Where this runs

A build takes several minutes, so it always runs in a background subagent. The board's Draft
package button starts one itself. If you are the person's conversation and they ask you to draft
or redraft a package, call `mcp__job-tracker__draft_package` with the lead id (load it with
ToolSearch if needed) and reply in one line. Only if that tool is missing or says the subagent did
not start, launch one yourself (Agent tool, `subagent_type: "general-purpose"`,
`run_in_background: true`, asking it to use this skill for that lead, with `--redraft` when the
lead already has a package). If you are that subagent, carry on below and never stop to ask.

## Inputs

- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`; data folder `$JOB_TRACKER_DATA`. If
  `profile/preferences.md`, `profile/master-resume.tex` or `profile/resume-format-template.tex` is
  missing, stop and say to finish the job-tracker:onboard skill first.
- Package folder: `$JOB_TRACKER_DATA/packages/<lead-id>/`, with exactly these files:
  `posting.md`, `resume.tex`, `resume.pdf`, `cover-letter.md`, `answers.md`, `company-brief.md`,
  `sources.md`.
- Read before writing, all under `profile/`:
  - `knowledge-base/application-answers.md`: the person's answer to each application question.
  - `learnings.md`: what their feedback has taught. Its rules win over everything below.
  - `resume-generation-rules.md`: how a tailored résumé is built. Obey it.
  - `master-resume.tex`: the only approved résumé wording.
  - `resume-format-template.tex`: the mandatory layout. Its wording is a sample, never a source.
  - `knowledge-base/`: source-linked facts. Start at its `README.md`; read only what this role
    needs.
  - `cover-letter-prompts.md` (the person's stories), `voice.md` when it exists, and
    `OPEN-QUESTIONS.md` (facts not yet settled: never state one of those as settled).

## Steps

1. Find the lead with `jobs list`. If your task says the card is already in Drafting, do not move
   it. Otherwise run `jobs move <id> drafting --by package`.
2. Posting. WebFetch its URL; for a LinkedIn or Indeed URL, find the same role on the company's own
   careers page or ATS board instead. If the full posting cannot be found, say so and work from the
   lead. Save its text, URL and today's date to `posting.md`, and note every application-form
   question the posting or its public apply page shows.
3. Résumé. Start from `resume-format-template.tex`: keep its preamble, fonts, margins, header,
   section rules and commands byte for byte, its section order and its level of detail, and leave
   out its instruction comment. Replace all of its body: pull roles, projects, bullets and skills
   fresh from `master-resume.tex` and the knowledge base, choosing what fits this posting by
   `resume-generation-rules.md`. Roles are always listed most recent first. You may shorten or
   reorder approved wording; never broaden scope, add a metric, change a date or claim planned work
   as done. In `sources.md`, give every bullet the master-résumé line or knowledge-base file it came
   from, and list what the posting wants that the record lacks under "Gaps".
4. Compile in the package folder: `pdflatex -interaction=nonstopmode -halt-on-error resume.tex`,
   twice (on Windows, MiKTeX may be at `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64`). Check
   `pdfinfo resume.pdf`: one page is the target, two the most. Fix overflow by cutting content,
   never the layout. Delete the `.aux`, `.log` and `.out` files.
5. Cover letter (`cover-letter.md`), at most 250 words in the person's voice:
   - Open with "Dear <the employer named on the posting> team," (or the hiring manager's name when
     the posting gives one), and check that name against the posting.
   - Three short plain paragraphs: why this team, one story from the record with its result, and
     a one-line close.
   - Write what the person designed, built, decided and fixed. Never credit an AI tool with the
     work. Mention AI tooling only when the posting is about AI-native work, and then how they
     check its output.
   - No paragraph about gaps: name at most one, in one clause, with evidence they learn fast. No
     bolded bullets, no set phrases reused across letters, no mention of other applications to the
     same company. No fact outside the record.
6. Answers (`answers.md`): every question found in step 2, with an answer.
   - First look each up in `application-answers.md` (its heading or an `Also asked as` line). Where
     the same question, or one asking for the same fact, is answered and its scope covers this
     application, use that answer word for word. An entry marked Superseded is never used.
   - Salary is always on record there: follow its rule (for example, the midpoint of the posted
     range), never leave it open.
   - Draft free-text answers ("Why us?", "Tell us about a project") from the record in 2–3
     sentences in the person's voice.
   - Where nothing on record answers a question (a disclosure, a referrer, a fact the record does
     not hold), write "open, see below" in its place and list it under a last heading,
     `## Open questions`, one line each, exactly:

     ```markdown
     - NEEDS ANSWER: <the question exactly as the form asks it>
     ```

     Nothing after the question on that line. The board counts these lines and matches them word
     for word against `application-answers.md`, so never use the marker anywhere else in the
     file. With nothing open, leave the heading out.
7. Company brief (`company-brief.md`): what they build and for whom, stage and funding, team size,
   stack, recent news, risks and red flags, and three sharp questions to ask. Link every claim's
   source.
8. Register: `jobs package <id>` (`--redraft` when you rebuilt a package the person already saw).
   It renders the résumé preview, writes `resume.diff` against the master, snapshots the draft for
   the learning loop and moves the card to Ready to apply if it is still in Drafting. If the person
   moved the card meanwhile, it prints a `notice` and leaves the card where they put it: that is
   not a failure, so do not move it or retry.
9. Reply briefly: what is in the package, any `NEEDS ANSWER` items and gaps, and "Review it in
   /jobs → the card → Review." After a `notice`, say the package is saved and the card stays in
   its column (name it). Keep the first line short and complete: the board shows it as a toast.

## Rules

- Never submit an application, send or draft an email or message, or create an account.
- Never invent, broaden or combine résumé facts. Generated packages are outputs, never evidence.
- Never write under `profile/`: it changes only through the learn skill's approved proposals and
  the submit skill's saved answers.
