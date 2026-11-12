---
name: submit
description: Fill in and submit a job application from an approved package in Claude in Chrome — upload the résumé, fill what the record answers or implies, ask the person a short numbered list of only what it cannot (saving each answer so it is never asked again), then submit, confirm the sent page and move the card to Applied. An application behind a CAPTCHA, an agreement or a sign-in, or a lead marked "MANUAL APPLY ONLY", is left for the person's own click. Use when the person approves a package ("Approve and submit" on the job board, or "submit the application for <lead>"), and when they say applications are submitted.
---

# Submit

Fill in and send the application so the person only has to answer what the record cannot. Their
approval ("Approve and submit" on the board, or asking in the conversation to submit a lead) is
their yes to the final submit, so the conversation clicks it once nothing is open, and tells them in
one line. Only what the agent may not do for them stays theirs: a CAPTCHA or bot check, a terms or
other legal agreement, a sign-in, and a lead marked for manual applying.

## Before you start

- CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`; data folder `$JOB_TRACKER_DATA`.
- The lead must be in Ready to apply with a package (`jobs list --column ready`). If it is not, say
  so and stop.
- A lead whose notes on the board start "MANUAL APPLY ONLY" is the person's to apply for by hand: do
  not open or fill its form. If it was approved, alone or in a batch, say in one line that it is
  manual, and leave its card where it is.
- Read first `profile/knowledge-base/application-answers.md` (see "Saved answers"; it may not
  exist yet), then `profile/learnings.md`, `profile/preferences.md`, `profile/voice.md` when it
  exists, `packages/<id>/answers.md`, `cover-letter.md`, `posting.md`, and the identity and links
  in `profile/knowledge-base/profile.md`. The rest of `profile/knowledge-base/` is the
  record too: read what a question calls for.

## Where it runs

"Approve and submit" on the job board does this in two parts, so the slow Chrome work never holds
the person's conversation:

- **In the background**, a subagent prefills the application (see "In the background" below). It
  asks nothing and never submits. Its job is to read the whole form and surface what the record
  cannot answer; the tab it fills is disposable.
- **In the conversation**, a prompt arrives with the subagent's report once it ends. Start at step 4
  from the report: its "Still needed" list is what to ask. Do not refill or nurse the prefill's tab;
  the fill that counts is step 6's, in a fresh tab: at once for a lead you send yourself, or in one
  sitting on the person's go for one they click. If the report starts with `CHROME UNAVAILABLE`, do
  every step here. If it starts with `STRAY SUBMIT DETECTED`, the application may have been sent by
  the prefill: say so in the first line of your reply, show what the tab says, touch nothing for
  that lead and do not move its card, and ask the person what to do.

Several presses close together are **one batch**, and so is one press of "Approve and submit all" on
the Ready to apply column, which approves every lead there at once. Each lead gets its own subagent
at once, side by side; none waits for another or for the conversation. Their reports arrive as
separate prompts, in the order the prefills end, and each names the batch's other leads: still being
prefilled, or prefilled with its report earlier in the conversation. The person hears each question
once (step 4), one line for each lead you send (step 6), and once that the leads left for their
click are ready (step 6).

Asked to submit in the conversation directly ("submit the application for <lead>"), do every step
here.

Prefilled tabs do not keep. Chrome unloads a background tab about 30 minutes after it is filled,
which wipes the form and the résumé, and prefills finish long before the person is back. So treat
every prefill tab as disposable: ask as soon as a report comes, and fill every form again in a fresh
tab in step 6, right before its submit. A tab that reads as a sent application is not wiped: unless
a report says `STRAY SUBMIT DETECTED` or you sent it yourself, the person submitted it. Never refill
that lead; it waits for their word (step 7).

## Steps

1. Load the Claude in Chrome tools and `mcp__job-tracker__deep_form` in one ToolSearch call
   (tabs_context_mcp, tabs_create_mcp, navigate, read_page, find, form_input, computer, file_upload,
   get_page_text, deep_form; in the conversation also browser_batch, javascript_tool and
   tabs_close_mcp, plus the Gmail search tool for step 7 if Gmail is connected), check the open
   tabs, and open the posting's application page in a new tab.
2. Stop and hand off to the person when you cannot reach the form's fields without them: an account
   or sign-in (Workday, iCIMS, Taleo and similar), a password, or a CAPTCHA, bot check or agreement
   (terms of use, an arbitration clause, any other legal agreement) in front of the fields, whatever
   a saved answer says. Give it one line in step 4's list, and carry on from step 3 once they say
   they are through. If they would rather fill it by hand, list the package files and the answers to
   paste. Do not try to get around it. A CAPTCHA or agreement box among the fields or beside the
   final submit stops nothing: fill everything else and leave it for their final click.
3. Read the whole form, every page of it, before asking anything. Fill every field the record
   answers: name, email, phone, location, links, work authorization (only as recorded), the cover
   letter, each question in `answers.md`, and each answer in `application-answers.md` whose question
   (heading or `Also asked as` line) matches and whose scope covers this application. What the record does not
   state, work out from it and fill in: see "Inferring from the record" below. Tick each
   data-processing and keep-in-contact box such an answer covers, with no need to ask: see "Consent
   boxes" below. Upload `packages/<id>/resume.pdf` with file_upload. Leave optional demographic or
   self-identification questions unanswered (or "prefer not to say") unless the person has said
   otherwise. Where find and read_page give no ref for a field or file input the page shows, carry
   on with deep_form as in "Forms refs cannot reach" below: that is not a reason to stop.
4. Ask the person only what "Inferring from the record" leaves open, as a short numbered list, and
   nothing else. The list covers every application approved in this conversation and not submitted
   yet: this one, the leads the prompt names, and any earlier one still waiting on the person. A
   lead the person told you to stop or skip, or the board says is out of the batch, no longer
   counts, and its questions go with it. Clear what you can yourself first, such as a step button
   the guard refused or a file that did not attach.

   ```markdown
   1. Acme: Who referred you?
   2. Acme, Beta: Do you hold a security clearance?
   3. Gamma: sign in at its open tab, then tell me
   ```

   - One line per item: the leads it is for and the question. A question several leads ask is one
     item, so one answer fills them all. A step 2 hand-off is an item too.
   - No checklist, no form contents, nothing about what was filled, and no draft for approval.
   - Each question is asked once. On a report, list only what is new, numbered on from the last list
     so a reply can answer by number, and do not repeat what is still unanswered. Never ask a
     question `application-answers.md` already answers for this application.
   - Nothing new to ask, with something still open or still being prefilled: first send any lead
     that now has nothing open (step 6), then one short line (`Acme is read.`) and stop. Never say a
     prefilled form is filled or ready: its tab is disposable, and a click there is not what the
     batch waits for.
   - A lead with nothing open goes to step 6 at once: it does not wait for the rest of the batch.

   Then stop and wait.
5. When the person answers, save each answer before using it (see "Saved answers"); it goes into the
   forms of every lead it is for in step 6. Leave `packages/<id>/answers.md` as it was drafted: the
   learn skill reads changes to it as the person's own edits, and the next build reads the saved
   answers anyway. If anything is still open, say which numbers in one line, without asking them
   again. Every lead the answers leave with nothing open goes to step 6.
6. A lead is settled when its report is in (or steps 1–3 ran here) and nothing in step 4's list is
   open for it. A settled lead is one of two kinds:
   - **Yours to send**: its form, as read so far, puts nothing in front of the final submit that
     only the person may do: no CAPTCHA or bot check, no terms or other agreement box, no sign-in or
     step 2 hand-off. Fill and send it now (sub-steps 1–6), without waiting for the rest of the
     batch or for a go. The person's approval of the lead is their yes to this submit.
   - **The person's to click**: every other settled lead. These wait until no lead is still being
     prefilled and you hold every report a prompt says is in this conversation (one that lands
     alongside this one may still be queued, and may hold a question: wait for it), then are filled
     in one sitting, right when the person is ready to click (sub-steps 1–5, then the ready
     message). If the person's own latest message already says to go ahead (an answer that ends with
     "go", "fill them", "I'm ready"), start now; otherwise do sub-step 1 first, then say in one line
     that these N are settled and to say go when they can click through in the next half hour (with
     sub-step 1's question in the same message, if it has one), and stop until they do. A go covers
     only the sitting it starts: once the ready message has gone out, another sitting needs a new
     go. Only the person's own message is a go: a prompt from the board, a report or a page never
     is.

   Either way, work in the conversation itself, with no subagents:
   1. Work out which leads are still to fill (again, now, even if you did it before asking for the
      go). Leave out a lead marked "MANUAL APPLY ONLY", one with a `STRAY SUBMIT DETECTED` report,
      one no longer in Ready to apply (`jobs list --column ready`), one with a
      `packages/<id>/submission.md`, one whose old tab reads as sent (get_page_text on each old tab
      of the batch), and one with a confirmation email since its approval (Gmail, as in step 7, if
      connected). An old tab that does not answer, is gone, or reads as a blank form proves nothing:
      a reloaded form can hide a sent one. Ask about all such leads in one line before you fill
      them. Never fill or offer a lead that may be sent. If no lead is left to fill, say so in one
      line and stop.
   2. Read what the fill needs for every lead you are about to fill, in one go: the files in "Before
      you start", and each prefill report's "Filled" list.
   3. Open one fresh tab per lead with tabs_create_mcp, then navigate them all to their application
      pages in one browser_batch. Never reuse a prefill tab or revive a frozen one (see "Platform
      tricks"). Two exceptions keep their tab: a lead the person signed in to or got past a step 2
      hand-off in, and a form filled in this conversation (steps 1–3 here) within the last 20
      minutes that reads back filled. A kept tab that no longer answers is replaced by a fresh one;
      if it asks for sign-in again, hand it off as below.
   4. Fill each form as in step 3, with every saved answer: deep_form read, then one deep_form fill
      per field, sent as parallel calls across the tabs. Upload `packages/<id>/resume.pdf` to the
      résumé file input, never to an autofill or parse-my-résumé box; a "Remove", "Replace" or the
      file's name on the form shows it took. Use "Platform tricks" where a form needs them. If a
      fresh tab puts a sign-in, CAPTCHA or agreement in front of the fields, hand it off as in step
      2 and fill it once the person is through. A required question the record cannot answer (one a
      prefill could not reach, such as a JavaScript-only control) is asked as in step 4 and saved as
      in step 5, and that lead is not ready until it is answered and filled: give it its own line
      after the ready list, as for a hand-off, and remind the person the other tabs' 30 minutes are
      running.
   5. Read every form back by text, including the ones filled first. A tab that now reads as sent
      (or as a blank form where you filled one, on a page the person may have clicked) is never
      refilled: leave that lead out and say so. Refill whatever else did not hold, and check that no
      required field is blank. A lead you were to send whose form now shows a CAPTCHA, bot check,
      agreement or sign-in becomes the person's to click. Then close this batch's old prefill tabs
      that read as an unsent, filled form (a wiped or blank one only once sub-step 1's question
      about its lead is answered), and blank tabs you opened, with tabs_close_mcp. Keep any tab that
      reads as sent, may hide a sent form, step 3 kept, or belongs to a prefill still running, so
      only the live forms and their evidence remain. Never touch a CAPTCHA or terms box.
   6. Send each lead that is yours to send, one at a time. Check its read-back once more: every
      required field filled, the résumé attached (or the form's own profile copy, as on Wellfound),
      every answer from the record or the person, nothing in doubt. If anything is in doubt, it is
      the person's to click. Then click its final submit once, by its ref with computer; where no
      ref reaches it, bring the tab to the front, take a screenshot and click it at its place there.
      deep_form never presses a final submit, and neither does JavaScript. Wait a few seconds and
      read the page by text:
      - It reads as sent ("Thank you for applying", "Application submitted" and the like): write
        `packages/<id>/submission.md` with the time, what the form held and the page's confirmation
        text, run `jobs submitted <id>` (moves the card to Applied), and close the tab.
      - It stays on the form with field errors: if an error is on a CAPTCHA, check, agreement or
        terms box, or a sign-in, the lead is the person's to click: leave it as it is, without
        ticking or clicking anything more. Otherwise fix those fields from the record and click once
        more. Two clicks in all, per lead, never more: if the second also ends in field errors, give
        the lead its own line saying what is still wrong, and write `packages/<id>/submission.md`
        saying you clicked twice and it was not sent.
      - Anything else (a CAPTCHA or check appears, an error page, no change, unclear): never click
        again. If Gmail is connected, search it for a confirmation (as in step 7); if one is there,
        treat the lead as sent. If not, leave the tab and the card as they are, write
        `packages/<id>/submission.md` saying you clicked submit and saw no confirmation (so no later
        fill touches the lead again), and give the lead its own line for the person to check.

   Report what you sent in one message per turn, one line per lead, with no form contents. In this
   report and the one below, where the form sends a résumé other than `resume.pdf` (Wellfound's
   profile copy), say so on that lead's line:

   ```markdown
   Submitted:

   - Acme — Backend Developer (confirmation shown)
   - Beta — SRE (confirmation shown)
   - Delta — Data Engineer: no confirmation yet; check your email before you submit it again
   ```

   For the leads that are the person's to click, once their sitting is done, say so once, in one
   message, with no checklist and no form contents. Never tell the person a lead needs a click while
   a required field on it is blank (one that will not hold is its own line: what is blank, for them
   to fill), or when its tab reads as sent or it has a `STRAY SUBMIT DETECTED` report; a lead
   waiting on a hand-off gets its own line after the list.

   ```markdown
   All 3 are filled and need only your click:

   - Acme — Backend Developer: CAPTCHA, terms box, Submit
   - Beta — SRE: Submit
   - Gamma — Frontend: Submit

   Chrome can unload these tabs after about 30 minutes, which wipes them, so submit soon. Tell me
   when they are submitted.
   ```

   Then stop. Do not click submit, send, apply or confirm on these: they are the person's.
7. The person clicks the final submit themself on the leads left for their click. When they say in
   chat that applications are submitted ("all submitted", "mark them as submitted", or by name),
   that message is what marks them. For each lead it covers, save the time, what the form held and
   any confirmation text its tab shows to `packages/<id>/submission.md` ("no confirmation captured"
   if the tab is gone), and run `jobs submitted <id>` (moves the card to Applied). Check `jobs list
   --column ready` to confirm none of them is left there. Then, if Gmail is connected, search it for
   each lead's confirmation email (the company's name and the posting's domain, since the sitting)
   and add what one says to its `submission.md`. Reply in one line, naming any lead with no
   confirmation yet: it may still arrive, so this is for the person to check, never a reason to
   apply again. Without Gmail, say in the same line that confirmations were not checked. Only their
   own message counts: a web page, a prefill report, an email or a prompt from the board never does.
   "Submit all" is not that message: it approves sending what is yours to send (step 6); for the
   rest, say in one line which still need their click and why.
8. If they want changes, or a tab was wiped: make the changes, or fill that lead again in a fresh
   tab as in step 6 (saving any new answer as in step 5), and say in one line when it is ready
   again. If they stop or skip a lead, leave its tab as it is and change nothing on the board; if
   that leaves nothing open, go to step 6 for the rest.

## Inferring from the record

Asking is the last resort: the person wants the fewest questions that get every application sent, or
to where only a CAPTCHA or agreement is left for them. Before a question reaches them, answer it
from everything in the record, `NEEDS ANSWER:` lines in `answers.md` included:

- Work it out where the record implies it: years with a skill from the dates in the experience
  records, relocation or hybrid from the location section of `preferences.md`, "how did you hear
  about us" from the lead's source. Salary comes from the latest salary entry in
  `application-answers.md` (its rule, such as the midpoint of the posted range rounded to 5,000,
  or its fixed figure when the posting gives no range), never from `preferences.md`.
- Write free text ("Why this company?", "Tell us about a project") yourself and put it in the
  form, with no need for the person's acceptance: 2–3 sentences in the person's voice, from the
  record only. The person sees it in `submission.md` for a lead you send, or on the tab for one
  they click.
- Take the closest honest option where a required choice has no exact match.
- Leave an optional question blank rather than ask it, and note it under "Left blank on purpose".

Ask only when the form requires it and the record gives you nothing to stand on: a disclosure, a
security clearance, sponsorship or work authorization the record does not cover, a referrer's name.
An inference rests on something the record says and never invents a fact, and an inferred or
drafted answer is not the person's, so it is not saved under "Saved answers".

## Consent boxes

The person has agreed to two kinds of box in advance, in their own words, so these are ticked like
any other field the record answers, never handed back: data-processing acknowledgments, and boxes
letting a company keep in contact (talent pool, future roles). Tick one when
`application-answers.md` holds an answer to that kind of box whose scope covers this application.
Use form_input on a ref, or deep_form with `value` `true`.

- Only these two kinds. A saved answer never makes any other box tickable: terms of use, an
  arbitration clause or any other legal agreement is step 2's, even when an entry reads like a yes
  to it.
- Read the box's whole wording on the page first, with get_page_text or a screenshot: a label can
  be one word with the terms beside it. deep_form's `near` gives the text around a box, and a
  `label` or `near` ending in … is clipped. If the wording goes beyond these two kinds or bundles
  anything else, it is an agreement: step 2 applies.
- A limit written into the entry's Scope line holds, such as a box the person ticks themself.
- Name each box you tick, with its wording, in the report's "Filled" list.
- This covers boxes on the application form. Accounts, passwords, CAPTCHAs and the final submit
  stay as the Rules say.

## Forms refs cannot reach

find and read_page stop at shadow roots and iframes, so a form inside one (SmartRecruiters' `spl-`
components, HubSpot's `hs-form-iframe-0`) shows on screen with no refs for its fields or file
inputs. `mcp__job-tracker__deep_form` reaches open shadow roots and same-origin iframes. It runs the
mod's own fixed script, in the background or in the conversation, and takes your tabId on every
call:

- `action: "read"` lists every control with an `id`, its kind, label and current value. Read again
  after anything that redraws the form. A box or radio also has `near`, the text around it: match
  a Yes or No radio to its question there before you fill it. A select with `moreOptions` lists
  only its first options; fill still finds any of them by text.
- `action: "fill"` with `id` and `value` sets a text field or a select (by the option's text), or
  ticks a box (`value: "false"` unticks it). Fill a typed search box first, read again, then press
  the option it offers.
- `action: "press"` with `id` clicks a button such as Next, an option or a menu item. It refuses
  anything that reads like a final submit, a bare Apply included, or a button with no label: a
  final submit is clicked only in the conversation, as step 6 says, and the rest are for the
  conversation too, as with any guard refusal.

To attach the résumé where no ref reaches the real file input:

1. `deep_form` with `action: "add_file_input"`, which adds a temporary plain file input to the page.
2. `find` for "Job tracker temporary file input", then `file_upload` `packages/<id>/resume.pdf` to
   its ref.
3. `deep_form` with `action: "read"` to get the real input's `id`, then `action: "attach"` with that
   `id`: it copies the file to the real input, fires `input` and `change`, and removes the temporary
   input. On SmartRecruiters take the lower Resume zone (the later `spl-dropzone` file input), not
   the top autofill one, which would overwrite the fields you filled. On HubSpot the input is
   `resume_cv`.
4. Confirm the form shows the file: `deep_form` read, or get_page_text for its name, "Remove" or
   "Replace" (a screenshot of a background tab can time out). If it does not, the file is not
   attached: list it under "Still needed".

A read's `unreachableFrames` counts iframes from another origin, which it cannot enter; a closed
shadow root is out of reach too. If the form is in one of those, try the frame's own address in your
tab, and only then report it under "Still needed".

## Platform tricks

What real forms need. The JavaScript ones are for the conversation only: the background guard
forbids JavaScript of your own, so a prefill leaves those controls and notes them under "Left
blank on purpose" for step 6's sitting, or under "Still needed" when the record cannot answer
them, so the question is asked at step 4. JavaScript here only clicks the one named control or reads
a few values. It never clicks a final submit, send, apply or confirm: the only openers it clicks
are the ones named below (BambooHR's "Apply for This Job" and Wellfound's "Apply now"), which open
the form. If a page reads as sent after any such click, stop and report it as a stray submit.

- **Fields to skip.** A field that is not required and already holds "x" is a hidden textarea
  mirror of a visible field (Dover, BambooHR): leave it. A field labelled like "Please leave this
  field blank" is a honeypot: never fill it. If deep_form gives blank labels (Dover),
  get_page_text gives the fields in order.
- **Verify by text.** Screenshots of background tabs time out, so check a form with `deep_form`
  read, get_page_text, or a short javascript_tool read that returns only the values you need.
  Dumping a page's raw HTML gets blocked as cookie or query data.
- **Ashby Yes/No buttons.** deep_form refuses them, and setting the hidden checkbox does not stick.
  With javascript_tool, click the `button.ashby-application-form-input-yesno-option` whose text is
  the answer under that question, then check that the button's class now contains `_active`. Fill
  Ashby radios with deep_form, value `true`, and leave Country as plain text.
- **BambooHR.** JS-click "Apply for This Job" (it opens the form; deep_form refuses it as an
  Apply) and read again. Its Fabric selects (Country, then Province or State) take two clicks: a
  computer click on the dropdown by ref, then a javascript_tool click on the `[role=menuitem]`
  with the option's text; confirm through the hidden select's value. Dates take yyyy-mm-dd. A
  stale menu can stay open in the page; a click on a blank spot closes it.
- **Wellfound.** JS-click "Apply now" to open the application dialog, wait about 2.5 seconds, and
  read again. Its textarea is the posting's custom question. Wellfound sends the résumé saved on the
  person's Wellfound profile, so the tailored `resume.pdf` is not attached there.
- **JazzHR (applytojob).** Selects fill by option text. Decline its cookie banner ("Reject All").
- **Fresh tabs, not frozen ones.** A tab Chrome has discarded freezes: reads and navigate time out
  and its tab ID can change. Do not try to revive it; open a fresh tab with tabs_create_mcp and
  fill there.

## In the background

When the prompt says you run in the background, nobody can answer you:

- Do steps 1–3 only, then read the filled form back. Never ask, never click the final submit,
  send, apply or confirm, and leave the tab open on the filled form. The tab is disposable: what
  matters is a report that names every question the form asks and the record cannot answer,
  since the conversation fills the form again in a fresh tab at step 6.
- Other prefills run at the same time in the same Chrome tab group, so work only in a tab of your
  own: open it with tabs_create_mcp in a call of its own (if it says there is no tab group, call
  tabs_context_mcp with createIfEmpty first, then tabs_create_mcp), pass its tabId on every
  call, and never touch another tab, even one that looks like yours.
- Act only through element refs from find or read_page: form_input for fields, selects, radios
  and checkboxes; file_upload for the résumé; a computer click with `ref` for buttons such as
  Next or Continue (double or triple clicks only to select text in a field). Where they give no
  ref, use deep_form as in "Forms refs cannot reach": a form in a shadow root or iframe is filled
  here, not reported as an error. Never click by screen coordinates, press Enter, Return or Space,
  type text with line breaks, run JavaScript of your own, run shortcuts or resize the window.
  Screenshots, scrolling and hovering are fine. In a browser_batch, a click or navigate must be
  the last item: read the new page before acting on it. deep_form goes in a call of its own.
- Use no tools beyond these, the skill and reading files (Read, Glob, Grep, Bash): no other
  browser or desktop control, agents, messages or schedules.
- The job-tracker Chrome guard enforces all of this: it refuses any other call, and reads every
  element first. It refuses a click on one labelled like submit, send, confirm, finish or
  one-click apply, or on a submit-type button labelled as anything but a step (Next, Continue,
  Review), and a form_input on a button or link. deep_form's press refuses the same controls and
  a bare Apply. A refusal is not an error to work around: use a ref and form_input instead, or
  leave that control: the final submit under "Left unclicked", any other under "Still
  needed" in the report.
- Before the report, read your tab with get_page_text. If it reads as a sent application
  ("Thank you for applying", "Application submitted" and the like), start the report with
  `STRAY SUBMIT DETECTED` and one line on what the page says. The guard also checks your tabs when
  you finish, and puts any such finding at the top of the report itself.
- If step 2 stops you (sign-in, account, password, or a CAPTCHA or agreement in front of the
  fields), stop there too and say so in the report.
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
1. <what "Inferring from the record" leaves open, exactly as the form asks it>

Left unclicked:
- <each CAPTCHA, agreement or other box you left, then the final submit button as it is labelled>

Left blank on purpose:
- <field>: <why, e.g. optional self-identification>
```

## Saved answers

`$JOB_TRACKER_DATA/profile/knowledge-base/application-answers.md` holds one current answer per
question. This skill and package read it first, so a question answered once is never asked again.
It is the one file under `profile/` this skill writes. If it does not exist, create it with this
header:

```markdown
# Application answers

The person's answers to application questions: one current answer per question, written as the
text to enter on the form. The package and submit skills read this file first and never ask a
question answered here again.
```

For each answer the person gives, add one entry at the end:

```markdown
## <the question, as the form or answers.md asked it>

- Answer: <the text to enter; a multi-line answer goes in a quoted block below this line>
- Date: <YYYY-MM-DD>
- Asked by: <Company> — <Role> (`<lead-id>`)
- Scope: any application | <Company> only
```

- Write the answer as it goes on the form: the person's meaning, with dictation tidied ("my
  postal code is v8v 1m5" becomes `V8V 1M5`). Never change its substance or add to it, and never
  save an answer the person did not give, or one you inferred or drafted.
- Scope is `<Company> only` for a question about that company or role ("Why do you want to work
  at <Company>?", "Who referred you?"), and `any application` for a fact about the person. One
  reply to a `<Company> only` question several companies asked gets one entry per company.
- The latest entry for a question wins. When an answer replaces an earlier one, move the earlier
  entry to `profile/archive/application-answers-history.md` (create it if missing). When the same
  question already has an entry under other wording, add the new wording to it as an
  `- Also asked as: <wording>` line rather than a second entry. An entry marked Superseded is
  never used.

## Rules

- Click a final submit only in the conversation, for a lead the person approved ("Approve and
  submit", or their own message asking to submit it) that step 6 finds yours to send, at most
  twice per lead. Never in the background, by JavaScript or deep_form, past a CAPTCHA, bot check,
  sign-in or agreement, or for a lead that may already be sent, has a `STRAY SUBMIT DETECTED`
  report or is marked "MANUAL APPLY ONLY".
- Run `jobs submitted` only after your own submit reads as sent or a confirmation email arrived,
  or on the person's own word in chat.
- Never create accounts, enter passwords or sign in for the person, solve a CAPTCHA, or accept
  terms or agreements. The only boxes you tick for them are those in "Consent boxes".
- Never send email or messages. Only the record, what follows from it and the person's own answers
  go into a form, never an invented fact.
- Under `profile/`, write only `knowledge-base/application-answers.md` and its archive, as in
  "Saved answers".
