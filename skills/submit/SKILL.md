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

## Where it runs

"Approve and submit" on the job board does this in two parts, so the slow Chrome work never holds
the person's conversation:

- **In the background**, a subagent prefills the application (see "In the background" below). It
  asks nothing and never submits.
- **In the conversation**, a prompt arrives with the subagent's report once it ends. Start at
  step 4 with the form as the report and the tab left it: check the tab is there and the fields
  are still filled, and redo steps 1–3 only for what is not. If the report starts with
  `CHROME UNAVAILABLE`, do every step here. If it starts with `STRAY SUBMIT DETECTED`, the
  application may have been sent without the person's yes: say so in the first line of your
  reply, show what the tab says, touch nothing for that lead and do not move its card, and ask
  the person what to do.

Several presses close together are **one batch**, and so is one press of "Approve and submit
all" on the Ready to review column, which approves every lead there at once. Each lead gets its
own subagent at once, side by side; none waits for another or for the conversation. Their reports arrive as separate
prompts, in the order the prefills end, and each names the batch's other leads: still being
prefilled, or prefilled with its report earlier in the conversation. Every reply to a report asks
for the whole batch (step 4), never only the lead whose report just came.

Asked to submit in the conversation directly ("submit the application for <lead>"), do every
step here.

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
4. Ask for everything still missing across the batch, in **one message**. The batch is every
   application approved in this conversation and not submitted yet: this one, the leads the
   prompt names, and any earlier one still waiting on the person. Each time you ask (on every
   prefill report, and again after an answer that leaves something open), the message is the
   complete set, so the person can answer all of it in one reply:
   - Grouped by company, one heading per lead (`<Company> — <Role>`), with the questions numbered
     straight through the message (1, 2, 3… across companies), so a reply can answer by number.
   - Under each lead: every `NEEDS ANSWER:` in `answers.md` and every form field the record does
     not answer, each exactly as the form asks it and whether it is required.
   - Under each prefilled lead, also its compact checklist: each filled field and its value (the
     report's "Filled" list as the tab now shows it) and the file attached, so the person sees
     what they would approve before they say "submit".
   - Carry forward every question from earlier messages that is still unanswered; drop the ones
     answered since, the leads already submitted, and any lead the person told you to stop or
     skip.
   - A lead with nothing missing: say it is filled in and ready to submit. A lead still being
     prefilled: say so in one line; its questions and checklist come with its report.
   - Where you offer a draft answer, follow "Drafted answers" below. A draft goes into the form
     only when the person accepts it in so many words ("3: use the draft"); a question they skip
     is still unanswered, even after "submit all".
   - End with one line asking the person to answer and to say which to submit. "Submit all"
     covers only the leads whose checklist this message showed and whose required answers the
     reply then completes, never a lead still being prefilled.

   Then stop and wait. With one lead and nothing missing, go to step 6. Never ask a question
   `application-answers.md` already answers for this application.
5. When the person answers, save each answer before using it (see "Saved answers") and fill the
   fields of every lead it is for. Leave `packages/<id>/answers.md` as it was drafted: the learn
   skill reads changes to it as the person's own edits, and the next build reads the saved
   answers anyway. If anything is still missing, ask again as in step 4: the whole batch's open
   questions in one message.
6. Read the filled form back (read_page or get_page_text) and post a short checklist in chat:
   each field and the value entered, the file attached, and anything left blank. If the person's
   reply already said to submit this lead (by name, or "submit all"), came after a message that
   showed this lead's checklist, and every required field is now filled from their own answers
   with nothing changed or new on the form since that checklist, that is their yes: go to step 7.
   Otherwise ask exactly: **"Everything is filled in for <Company> — <Role>. Submit it now?"**
   (for several leads, one message with one checklist each, asking which to submit) and stop. Do
   not click submit, send, apply or confirm before the person answers.
7. Only after the person replies yes, "submit" or "submit all" in this conversation, covering this
   lead: click the final submit, wait for the confirmation page, save its text and the time to
   `packages/<id>/submission.md`, and run `jobs submitted <id>` (moves the card to Applied). Reply with the confirmation in one line per lead, then list
   anything the batch still needs as in step 4.
8. If they say no or want changes: make the changes (saving any new answer as in step 5), show
   the checklist again, and ask again. If they stop, leave the tab as it is and change nothing on
   the board.

## In the background

When the prompt says you run in the background, nobody can answer you:

- Do steps 1–3 only, then read the filled form back as in step 6. Never ask, never click the final
  submit, send, apply or confirm, and leave the tab open on the filled form.
- Other prefills run at the same time in the same Chrome tab group, so work only in a tab of your
  own: open it with tabs_create_mcp in a call of its own (if it says there is no tab group, call
  tabs_context_mcp with createIfEmpty first, then tabs_create_mcp), pass its tabId on every
  call, and never touch another tab, even one that looks like yours.
- Act only through element refs from find or read_page: form_input for fields, selects, radios
  and checkboxes; file_upload for the résumé; a computer click with `ref` for buttons such as
  Next or Continue (double or triple clicks only to select text in a field). Never click by
  screen coordinates, press Enter, Return or Space, type text
  with line breaks, run JavaScript, run shortcuts or resize the window. Screenshots, scrolling
  and hovering are fine. In a browser_batch, a click or navigate must be the last item: read the
  new page before acting on it.
- Use no tools beyond these, the skill and reading files (Read, Glob, Grep, Bash): no other
  browser or desktop control, agents, messages or schedules.
- The job-tracker Chrome guard enforces all of this: it refuses any other call, and reads every
  element first. It refuses a click on one labelled like submit, send, confirm, finish or
  one-click apply, or on a submit-type button labelled as anything but a step (Next, Continue,
  Review), and a form_input on a button or link. A refusal is not an error to work around: use a
  ref and form_input instead, or leave that control for the conversation and list it under
  "Still needed" in the report.
- Before the report, read your tab with get_page_text. If it reads as a sent application
  ("Thank you for applying", "Application submitted" and the like), start the report with
  `STRAY SUBMIT DETECTED` and one line on what the page says. The guard also checks your tabs when
  you finish, and puts any such finding at the top of the report itself.
- If step 2 stops you (sign-in, account, password, CAPTCHA, an agreement), stop there too and say
  so in the report.
- If the Claude in Chrome tools cannot be loaded or reach a browser, finish at once with a report
  that starts with `CHROME UNAVAILABLE` and one line on why.
- Write nothing under `profile/` and do not change the board: no answers were given yet.

Finish with this report and nothing else; it is handed to the conversation word for word:

```markdown
Tab: <the tab's title> — <its URL>
Stopped at: <filled, ready for review | sign-in | account | CAPTCHA | agreement | error: <why>>

Filled:
- <field>: <value entered> (one line each; the résumé file attached)

Still needed:
1. <question exactly as the form asks it> (required | optional)

Left blank on purpose:
- <field>: <why, e.g. optional self-identification>
```

## Drafted answers

A free-text answer you draft for a form, or suggest to the person, is 2–3 sentences in their
voice, from the record only, never several paragraphs. Bring up Claude Code or agentic work only
when the question is about AI, automation or tooling; otherwise answer from the rest of the
record.

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

- Never click the final submit without the person's yes in this chat covering this application
  (by name, or "submit all" for the batch).
- Never create accounts, enter passwords or sign in for the person; never solve a CAPTCHA or
  accept terms or agreements for them. On a sign-in or account page, stop and hand off with
  everything ready.
- Never send email or messages. Only the facts in the record and the person's own answers go into
  the form.
- Do not modify anything under `profile/` except appending the person's answers to
  `profile/knowledge-base/application-answers.md` as above; everything else there changes only
  through the learn skill's approved proposals.
