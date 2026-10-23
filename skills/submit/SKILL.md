---
name: submit
description: Fill in a job application from an approved package in Claude in Chrome, upload the résumé PDF, ask the person in one message for anything missing (saving each answer to the shared knowledge base so it is never asked again), and stop before the final submit until they confirm in chat; after their yes, submit and move the card to Applied. Use when the person approves a package ("Approve and submit" on the job board, or "submit the application for <lead>").
---

# Submit

Fill in the application so the person only has to answer what nobody has asked them before, and
say yes. They never need to open Chrome themselves. The final click is theirs to approve, in this
chat, every time.

## Before you start

- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`; data folder `$JOB_TRACKER_DATA`.
- The lead must be in Ready to review with a package (`jobs list --column ready`). If it is not,
  say so and stop.
- Read first `profile/knowledge-base/application-answers.md` (see "Saved answers" below; it may
  not exist yet), then `packages/<id>/answers.md`, `cover-letter.md`, `posting.md`, and the
  identity and links in `profile/knowledge-base/profile.md`.

## Steps

1. Load the Claude in Chrome tools in one ToolSearch call (tabs_context_mcp, tabs_create_mcp,
   navigate, read_page, find, form_input, computer, file_upload, get_page_text), check the open
   tabs, and open the posting's application page in a new tab.
2. Stop and hand off to the person, with everything ready, when the page needs any of: an account
   or sign-in (Workday, iCIMS, Taleo and similar), a password, a CAPTCHA or bot check, or an
   agreement you would have to accept for them. Say which page, and list the package files and
   the answers to paste. Do not try to get around it.
3. Read the whole form, every page of it, before asking anything. Fill every field the record
   answers: name, email, phone, location, links, work authorization (only as recorded), the cover
   letter, each question in `answers.md`, and each answer in `application-answers.md` whose
   question matches and whose scope covers this application (the latest entry wins). Upload
   `packages/<id>/resume.pdf` with file_upload. Leave optional demographic or self-identification
   questions unanswered (or "prefer not to say") unless the person has said otherwise.
4. Ask once for everything still missing: every `NEEDS ANSWER:` in `answers.md` and every form
   field the record does not answer, in **one message**, as a numbered list with each question
   exactly as the form asks it (and whether it is required). Then stop and wait. Skip this step
   when nothing is missing. Never ask a question `application-answers.md` already answers for
   this application.
5. When the person answers, save each answer before using it (see "Saved answers") and fill the
   fields. Leave `packages/<id>/answers.md` as it was drafted: the learn skill reads changes to
   it as the person's own edits, and the next build reads the saved answers anyway. If an answer
   is still missing, ask again for only that one.
6. Read the filled form back (read_page or get_page_text) and post a short checklist in chat:
   each field and the value entered, the file attached, and anything left blank. Then ask exactly:
   **"Everything is filled in for <Company> — <Role>. Submit it now?"** and stop. Do not click
   submit, send, apply or confirm before the person answers.
7. Only after the person replies yes or "submit" in this conversation: click the final submit,
   wait for the confirmation page, save its text and the time to `packages/<id>/submission.md`,
   and run `jobs submitted <id>` (moves the card to Applied and sets a follow-up a week out).
   Reply with the confirmation in one line.
8. If they say no or want changes: make the changes (saving any new answer as in step 5), show
   the checklist again, and ask again. If they stop, leave the tab as it is and change nothing on
   the board.

## Saved answers

`$JOB_TRACKER_DATA/profile/knowledge-base/application-answers.md` is the shared record of what
the person has answered on applications. Both this skill and package read it first, so a
question answered once is never asked again. It is the one file under `profile/` this skill
writes, and only by appending what the person said. If it does not exist, create it with this
header:

```markdown
# Application answers

The person's own answers to application questions, saved word for word by the submit skill.
The package and submit skills read this file first and never ask a question answered here
again; for a question answered more than once, the latest entry wins. Edit or delete entries
by hand as answers change.
```

Append one entry per answer, at the end of the file:

```markdown
## <the question, as the form or answers.md asked it>

- Answer: <exactly what the person wrote, verbatim; quote it in a block if it is multi-line>
- Date: <YYYY-MM-DD>
- Asked by: <Company> — <Role> (`<lead-id>`)
- Scope: any application | <Company> only
```

Scope is `<Company> only` when the question is about that company or role ("Why do you want to
work at <Company>?", "Who referred you?"), and `any application` for a fact about the person
(salary expectation, start date, notice period, relocation, a disclosure). Never reword, shorten
or correct the answer, never add an answer the person did not give, and never edit or remove an
earlier entry: a changed answer is a new entry with a later date.

## Rules

- Never click the final submit without the person's yes in this chat for this application.
- Never create accounts, enter passwords or sign in for the person; never solve a CAPTCHA or
  accept terms or agreements for them. On a sign-in or account page, stop and hand off with
  everything ready.
- Never send email or messages. Only the facts in the record and the person's own answers go into
  the form.
- Do not modify anything under `profile/` except appending the person's answers to
  `profile/knowledge-base/application-answers.md` as above; everything else there changes only
  through the learn skill's approved proposals.
