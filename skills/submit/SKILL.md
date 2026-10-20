---
name: submit
description: Prefill a job application from an approved package in Claude in Chrome, upload the résumé PDF, and stop before the final submit until the person confirms in chat; after their yes, submit and move the card to Applied. Use when the person approves a package ("Approve & submit" on the job board, or "submit the application for <lead>").
---

# Submit

Fill in the application so the person only has to say yes. The final click is theirs to approve,
in this chat, every time.

## Before you start

- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`; data folder `$JOB_TRACKER_DATA`.
- The lead must be in Ready to review with a package (`jobs list --column ready`). If it is not,
  say so and stop.
- Read `packages/<id>/answers.md`, `cover-letter.md`, `posting.md`, and the identity and links in
  `profile/knowledge-base/profile.md`. If `answers.md` has any `NEEDS ANSWER:` item, ask for those
  answers first, in one message, and wait.

## Steps

1. Load the Claude in Chrome tools in one ToolSearch call (tabs_context_mcp, tabs_create_mcp,
   navigate, read_page, find, form_input, computer, file_upload, get_page_text), check the open
   tabs, and open the posting's application page in a new tab.
2. Stop and hand off to the person, with everything ready, when the page needs any of: an account
   or sign-in (Workday, iCIMS, Taleo and similar), a password, a CAPTCHA or bot check, or an
   agreement you would have to accept for them. Say which page, and list the package files and the
   answers to paste. Do not try to get around it.
3. Fill every field from the package and profile: name, email, phone, location, links, work
   authorization answers (only as recorded), the cover letter, and each question from
   `answers.md`. Upload `packages/<id>/resume.pdf` with file_upload. Leave optional demographic or
   self-identification questions unanswered (or "prefer not to say") unless the person has said
   otherwise.
4. Read the filled form back (read_page or get_page_text) and post a short checklist in chat:
   each field and the value entered, the file attached, and anything left blank. Then ask exactly:
   **"Everything is filled in for <Company> — <Role>. Submit it now?"** and stop. Do not click
   submit, send, apply or confirm before the person answers.
5. Only after the person replies yes in this conversation: click the final submit, wait for the
   confirmation page, save its text and the time to `packages/<id>/submission.md`, and run
   `jobs submitted <id>` (moves the card to Applied and sets a follow-up a week out). Reply with the
   confirmation in one line.
6. If they say no or want changes: make the changes, show the checklist again, and ask again. If
   they stop, leave the tab as it is and change nothing on the board.

## Rules

- Never click the final submit without the person's yes in this chat for this application.
- Never create accounts, enter passwords or sign in for the person; never solve a CAPTCHA.
- Never send email or messages. Only the facts in the record go into the form.
