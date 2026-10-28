import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ADD_MIN_SCORE,
  addLeads,
  ago,
  archiveStale,
  columnLeads,
  correctScore,
  emptyLeads,
  isStale,
  leadAges,
  leadsToMention,
  moveLead,
  nudgeContext,
  patchLead,
  POSTING_MAX_DAYS,
  postedTime,
  postingTime,
} from '../hooks/lib/model.ts'
import type { IncomingLead, Lead, LeadsFile } from '../hooks/lib/model.ts'

const AT = '2026-10-20T12:00:00.000Z'
const NOW = Date.parse(AT)
const DAY = 86_400_000
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString()
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

const lead = (fields: Partial<Lead> = {}): Lead => ({
  id: 'acme-backend',
  company: 'Acme',
  role: 'Backend Developer',
  url: 'https://jobs.example.com/acme',
  source: 'ashby',
  location: 'Victoria',
  comp: '',
  fitScore: 86,
  fitReason: 'fits',
  column: 'new',
  foundAt: AT,
  history: [],
  ...fields,
})

const incoming = (company: string, fields: Partial<IncomingLead> = {}): IncomingLead => ({
  company,
  role: 'Backend Developer',
  url: `https://jobs.example.com/${company}`,
  source: 'ashby',
  location: 'Victoria',
  comp: '',
  fitScore: 80,
  fitReason: 'fits',
  ...fields,
})

const board = (...leads: Lead[]): LeadsFile => ({ version: 1, leads })

test('a posting date parses or is unknown; the score never ages', () => {
  assert.equal(postedTime(lead({ postedAt: daysAgo(9) })), NOW - 9 * DAY)
  assert.equal(postedTime(lead({ postedAt: 'last Tuesday' })), undefined)
  assert.equal(postedTime(lead()), undefined)
  // A month-old lead in New still ranks on its fit, and the nudge names that score.
  const old = lead({ id: 'old', company: 'Old', fitScore: 85, foundAt: daysAgo(30) })
  const fresh = lead({ id: 'fresh', company: 'Fresh', fitScore: 80 })
  assert.deepEqual(
    columnLeads(board(fresh, old), 'new').map(one => one.id),
    ['old', 'fresh'],
  )
  const named = leadsToMention(board(fresh, old), NOW)
  assert.deepEqual(
    named.map(one => one.id),
    ['old', 'fresh'],
  )
  assert.match(nudgeContext(named), /Old — Backend Developer \(score 85\)/)
})

test('a lead shows how long since it was added and, when known, since it was posted', () => {
  assert.deepEqual(leadAges(lead({ postedAt: daysAgo(9), foundAt: daysAgo(3) }), NOW), {
    added: '3d',
    posted: '9d',
  })
  assert.deepEqual(leadAges(lead({ postedAt: 'last Tuesday', foundAt: hoursAgo(5) }), NOW), {
    added: '5h',
  })
  // A posting date in the future is a source's mistake: not shown.
  assert.deepEqual(leadAges(lead({ postedAt: daysAgo(-2), foundAt: hoursAgo(5) }), NOW), {
    added: '5h',
  })
  assert.equal(ago('3d'), '3d ago')
  assert.equal(ago('now'), 'just now')
})

test('a New lead is archived once its posting is over 14 days old; worked-on and restored leads stay', () => {
  assert.equal(POSTING_MAX_DAYS, 14)
  assert.equal(isStale(lead({ postedAt: daysAgo(14), foundAt: AT }), NOW), false)
  assert.equal(isStale(lead({ postedAt: hoursAgo(14 * 24 + 1), foundAt: AT }), NOW), true)
  // Without a posting date that parses, it counts from when the lead was added.
  assert.equal(isStale(lead({ foundAt: daysAgo(14) }), NOW), false)
  assert.equal(isStale(lead({ postedAt: 'last Tuesday', foundAt: daysAgo(15) }), NOW), true)
  // A posting dated after it was found counts from when it was found.
  assert.equal(postingTime(lead({ postedAt: daysAgo(-2), foundAt: daysAgo(3) })), NOW - 3 * DAY)
  assert.equal(isStale(lead({ postedAt: daysAgo(-2), foundAt: daysAgo(15) }), NOW), true)
  const file = board(
    lead({ id: 'posted', postedAt: daysAgo(15), foundAt: daysAgo(2) }),
    lead({ id: 'undated', foundAt: daysAgo(15) }),
    lead({ id: 'future', postedAt: daysAgo(-30), foundAt: daysAgo(15) }),
    lead({ id: 'fortnight', postedAt: daysAgo(14), foundAt: daysAgo(14) }),
    // A low score is no reason to archive: scores do not age.
    lead({ id: 'low', fitScore: 40, postedAt: daysAgo(3), foundAt: daysAgo(3) }),
    lead({
      id: 'restored',
      postedAt: daysAgo(20),
      history: [{ at: AT, by: 'user', action: 'moved', from: 'archived', to: 'new' }],
    }),
    lead({ id: 'drafting', column: 'drafting', postedAt: daysAgo(30) }),
    lead({ id: 'ready', column: 'ready', foundAt: daysAgo(30) }),
    lead({ id: 'applied', column: 'applied', postedAt: daysAgo(60), foundAt: daysAgo(60) }),
  )
  const { leads, archived } = archiveStale(file, AT)
  assert.deepEqual(archived, ['posted', 'undated', 'future'])
  assert.deepEqual(
    leads.leads.map(one => one.column),
    ['archived', 'archived', 'archived', 'new', 'new', 'new', 'drafting', 'ready', 'applied'],
  )
  assert.deepEqual(leads.leads[0]?.history.at(-1), {
    at: AT,
    by: 'tracker',
    action: 'moved',
    from: 'new',
    to: 'archived',
    note: 'posted over 14 days ago',
  })
  assert.equal(leads.leads[1]?.history.at(-1)?.note, 'added over 14 days ago')
  assert.equal(leads.leads[2]?.history.at(-1)?.note, 'added over 14 days ago')
  // Nothing stale: the same file back, so callers can skip the write.
  const clean = board(lead({ postedAt: daysAgo(3) }))
  assert.equal(archiveStale(clean, AT).leads, clean)
})

test('scout adds a new lead scoring 70 or more, skips postings over 14 days old, and keeps dates', () => {
  const result = addLeads(
    emptyLeads(),
    [
      incoming('Old', { fitScore: 75, postedAt: daysAgo(9) }),
      incoming('Weak', { fitScore: 69, postedAt: hoursAgo(1) }),
      incoming('New', { fitScore: 71, postedAt: hoursAgo(1) }),
      incoming('Dead', { fitScore: 100, postedAt: daysAgo(15) }),
      incoming('Fortnight', { fitScore: 80, postedAt: daysAgo(POSTING_MAX_DAYS) }),
      // Exactly at the threshold is kept; an unreadable date is no reason to skip.
      incoming('Undated', { fitScore: 70, postedAt: 'last Tuesday' }),
    ],
    AT,
    ADD_MIN_SCORE,
  )
  assert.equal(ADD_MIN_SCORE, 70)
  assert.deepEqual(result.dropped, ['weak-backend-developer', 'dead-backend-developer'])
  assert.deepEqual(result.added, [
    'old-backend-developer',
    'new-backend-developer',
    'fortnight-backend-developer',
    'undated-backend-developer',
  ])
  const kept = result.leads.leads[0] as Lead
  assert.equal(kept.postedAt, daysAgo(9))
  assert.equal(kept.foundAt, AT)
  assert.equal(kept.fitScore, 75)
  // Over 14 days is skipped whatever the threshold: the posting is likely filled.
  const anyScore = addLeads(
    emptyLeads(),
    [incoming('Dead', { fitScore: 100, postedAt: daysAgo(15) })],
    AT,
    0,
  )
  assert.deepEqual(anyScore.dropped, ['dead-backend-developer'])
  // Found again a day later: it keeps when it was first added and its earlier posting date.
  const again = addLeads(
    result.leads,
    [incoming('Old', { postedAt: daysAgo(1) }), incoming('New', { postedAt: undefined })],
    new Date(NOW + DAY).toISOString(),
    0,
  )
  assert.deepEqual(again.updated, ['old-backend-developer', 'new-backend-developer'])
  assert.equal(again.leads.leads[0]?.foundAt, AT)
  assert.equal(again.leads.leads[0]?.postedAt, daysAgo(9))
  assert.equal(again.leads.leads[1]?.postedAt, hoursAgo(1))
  // A lead already on the board is refreshed even when its score is under the threshold or its
  // posting is over 14 days old, and a readable earlier date replaces an unreadable or later one.
  const onBoard = board(lead({ column: 'applied', postedAt: 'last Tuesday', comp: '' }))
  const refound = addLeads(
    onBoard,
    [
      {
        ...incoming('Acme'),
        id: 'acme-backend',
        fitScore: 50,
        postedAt: daysAgo(35),
        comp: 'CAD 90k',
      },
    ],
    AT,
    ADD_MIN_SCORE,
  )
  assert.deepEqual(refound.updated, ['acme-backend'])
  assert.equal(refound.leads.leads[0]?.comp, 'CAD 90k')
  assert.equal(refound.leads.leads[0]?.postedAt, daysAgo(35))
  const later = addLeads(
    refound.leads,
    [{ ...incoming('Acme'), id: 'acme-backend', postedAt: daysAgo(3) }],
    AT,
    ADD_MIN_SCORE,
  )
  assert.equal(later.leads.leads[0]?.postedAt, daysAgo(35))
})

test('feedback and corrections carry the fit score', () => {
  const file = board(lead({ postedAt: daysAgo(28) }))
  assert.equal(correctScore(file, 'acme-backend', 'too-high', AT).event?.fitScore, 86)
  assert.equal(moveLead(file, 'acme-backend', 'drafting', AT, 'user').event?.fitScore, 86)
  const patched = patchLead(file, 'acme-backend', { postedAt: daysAgo(2) }, AT, 'scout')
  assert.equal(patched.leads.leads[0]?.postedAt, daysAgo(2))
})
