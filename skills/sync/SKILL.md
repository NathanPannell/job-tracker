---
name: sync
description: Read Gmail and Google Calendar for replies, rejections, interview invites and offers about the person's applications, propose moves on the job board, and apply them once the person confirms. Use on request ("sync my applications", "any replies?").
---

# Sync

Keep the board in step with the inbox and the calendar. You read; the person decides.

## Steps

1. CLI: `node "$JOB_TRACKER_HOME/bin/jobs.ts" <command>`. Get the leads in Applied and
   Interviewing (`jobs list --column applied`, `jobs list --column interviewing`), plus Ready to
   review (an invite can arrive before the card moves).
2. For each, search Gmail for the last 30 days by company name and the posting's domain, plus
   generic searches: `newer_than:30d (subject:application OR subject:interview OR "unfortunately"
   OR "next steps" OR "offer")`. Read the threads that match a lead. Never send, reply, archive or
   label anything.
3. Search Google Calendar for the next 30 days for events naming those companies (interviews,
   screens).
4. Propose moves in one table: lead, what you found (one line, with the date and sender), the
   proposed column (Interviewing, Offer, Archived for a rejection) and a follow-up date if one is
   implied. Also list Applied leads with no reply after 7 days as "follow-up due" and suggest a
   follow-up date. Ask: "Apply these moves?"
5. After the person confirms (all, or the ones they name): for each, run
   `jobs move <id> <column> --by sync --note "<what you found>"` and record the outcome with
   `jobs feedback '{"leadId":"<id>","kind":"outcome","reason":"<rejection|screen|interview|offer>: <one line>"}'`.
   For follow-ups, `jobs patch <id> '{"followUpAt":"<ISO date>"}' --by sync`.
6. Reply with what changed in two lines.

## Rules

- Never send, draft or delete email; never accept or decline calendar events.
- Never move a card without the person's confirmation in this chat.
