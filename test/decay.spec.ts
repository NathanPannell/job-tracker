import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ADD_MAX_POSTED_DAYS,
  addLeads,
  ago,
  archiveStale,
  columnLeads,
  correctScore,
  DECAY_MAX_POINTS,
  DECAY_POINTS_BY_DAY,
  decayNote,
  effectiveScore,
  emptyLeads,
  isStale,
  leadAges,
  leadsToMention,
  moveLead,
  nudgeContext,
  patchLead,
  postedTime,
  scoreDecay,
} from '../hooks/lib/model.ts'
import type { Column, IncomingLead, Lead, LeadsFile } from '../hooks/lib/model.ts'

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

test('a score loses 10, 8, 6, 4 and 2 points on its first five days, by the hour, then stops', () => {
  const at = (hours: number) => scoreDecay(lead({ foundAt: hoursAgo(hours) }), NOW)
  assert.deepEqual(DECAY_POINTS_BY_DAY, [10, 8, 6, 4, 2])
  assert.deepEqual([0, 1, 2].map(at), [0, 0, 0])
  assert.equal(at(3), 1)
  assert.equal(at(12), 5)
  assert.equal(at(24), 10)
  assert.equal(at(36), 14)
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(days => at(days * 24)),
    [10, 18, 24, 28, 30],
  )
  assert.equal(at(4 * 24 + 12), 29)
  assert.equal(at(7 * 24), 30)
  assert.equal(at(30 * 24), DECAY_MAX_POINTS)
  assert.equal(DECAY_MAX_POINTS, 30)
  assert.equal(scoreDecay(lead({ foundAt: daysAgo(-3) }), NOW), 0)
})

test('a fit-75 lead added three days ago shows 51 and is not archived', () => {
  const three = lead({ fitScore: 75, foundAt: daysAgo(3) })
  assert.equal(effectiveScore(three, NOW), 51)
  assert.deepEqual(archiveStale(board(three), AT).archived, [])
})

test('only leads not yet applied to age', () => {
  const old = (column: Column) => effectiveScore(lead({ column, foundAt: daysAgo(2) }), NOW)
  for (const column of ['new', 'drafting', 'ready'] as const) {
    assert.equal(old(column), 68, column)
  }
  for (const column of ['applied', 'interviewing', 'offer', 'passed', 'archived'] as const) {
    assert.equal(old(column), 86, column)
  }
})

test('age counts from when the lead was added; the posting date does not change the score', () => {
  const posted = lead({ postedAt: daysAgo(9), foundAt: daysAgo(1) })
  assert.equal(postedTime(posted), NOW - 9 * DAY)
  assert.equal(effectiveScore(posted, NOW), 76)
  assert.equal(effectiveScore(lead({ foundAt: daysAgo(1) }), NOW), 76)
  assert.equal(effectiveScore(lead({ postedAt: daysAgo(20), foundAt: AT }), NOW), 86)
  const unreadable = lead({ postedAt: 'last Tuesday', foundAt: daysAgo(1) })
  assert.equal(postedTime(unreadable), undefined)
  assert.equal(effectiveScore(unreadable, NOW), 76)
})

test('the aged score never goes under zero and the fit score is never changed', () => {
  const weak = lead({ fitScore: 10, foundAt: daysAgo(5) })
  assert.equal(effectiveScore(weak, NOW), 0)
  assert.equal(weak.fitScore, 10)
})

test('a lead shows how long since it was added and, when known, since it was posted', () => {
  assert.deepEqual(leadAges(lead({ postedAt: daysAgo(9), foundAt: daysAgo(3) }), NOW), {
    added: '3d',
    posted: '9d',
  })
  assert.deepEqual(leadAges(lead({ postedAt: 'last Tuesday', foundAt: hoursAgo(5) }), NOW), {
    added: '5h',
  })
  assert.equal(ago('3d'), '3d ago')
  assert.equal(ago('now'), 'just now')
})

test('the decay note shows the fit, the aged score and both ages', () => {
  assert.equal(
    decayNote(lead({ postedAt: daysAgo(9), foundAt: daysAgo(3) }), NOW),
    'Fit 86 → 62, added 3d ago · posted 9d ago',
  )
  assert.equal(
    decayNote(lead({ postedAt: hoursAgo(13), foundAt: hoursAgo(12) }), NOW),
    'Fit 86 → 81, added 12h ago · posted 13h ago',
  )
  assert.equal(decayNote(lead({ foundAt: hoursAgo(12) }), NOW), 'Fit 86 → 81, added 12h ago')
  assert.equal(decayNote(lead({ foundAt: hoursAgo(1) }), NOW), undefined)
  assert.equal(decayNote(lead({ postedAt: daysAgo(9), foundAt: AT }), NOW), undefined)
  assert.equal(decayNote(lead({ column: 'applied', foundAt: daysAgo(5) }), NOW), undefined)
})

test('a column re-sorts as its leads age', () => {
  const fresh = lead({ id: 'fresh', company: 'Fresh', fitScore: 80, foundAt: AT })
  const old = lead({ id: 'old', company: 'Old', fitScore: 85, postedAt: daysAgo(6), foundAt: AT })
  const order = (now: number) => columnLeads(board(old, fresh), 'new', now).map(one => one.id)
  // An old posting added today does not sink.
  assert.deepEqual(order(NOW), ['old', 'fresh'])
  // Three days on both have aged by the same 24 points: the better fit still leads.
  assert.deepEqual(order(NOW + 3 * DAY), ['old', 'fresh'])
  const earlier = lead({ ...old, foundAt: daysAgo(1) })
  assert.deepEqual(
    columnLeads(board(earlier, fresh), 'new', NOW).map(one => one.id),
    ['fresh', 'old'],
  )
  // Equal aged scores: the better fit, the older lead, leads.
  const tied = lead({ id: 'tied', company: 'Tied', fitScore: 75, foundAt: AT })
  const aged = lead({ id: 'aged', company: 'Aged', fitScore: 80, foundAt: hoursAgo(12) })
  assert.deepEqual(
    columnLeads(board(tied, aged), 'new', NOW).map(one => one.id),
    ['aged', 'tied'],
  )
})

test('the nudge names the best leads by aged score, with that score', () => {
  const fresh = lead({ id: 'fresh', company: 'Fresh', fitScore: 80 })
  const stale = lead({ id: 'stale', company: 'Stale', fitScore: 85, foundAt: daysAgo(1) })
  const named = leadsToMention(board(stale, fresh), NOW)
  assert.deepEqual(
    named.map(one => one.id),
    ['fresh', 'stale'],
  )
  assert.match(nudgeContext(named, NOW), /Stale — Backend Developer \(score 75\)/)
})

test('a New lead added over a week ago or scoring below 50 is archived; kept, restored and applied stay', () => {
  assert.equal(isStale(lead({ foundAt: daysAgo(7) }), NOW), false)
  assert.equal(isStale(lead({ foundAt: hoursAgo(7 * 24 + 1) }), NOW), true)
  assert.equal(isStale(lead({ postedAt: daysAgo(8), foundAt: AT }), NOW), false)
  const file = board(
    lead({ id: 'stale', foundAt: daysAgo(8) }),
    lead({ id: 'posted-long-ago', postedAt: daysAgo(20), foundAt: AT }),
    lead({
      id: 'restored',
      foundAt: daysAgo(9),
      history: [{ at: AT, by: 'user', action: 'moved', from: 'archived', to: 'new' }],
    }),
    // A week on the board is 30 off: 86 - 30 = 56 stays.
    lead({ id: 'week', foundAt: daysAgo(7) }),
    // Aged scores: 77 - 28 = 49 goes and 78 - 28 = 50 stays; a fresh 49 goes; a lead the person
    // marked too low stays at 49.
    lead({ id: 'low', fitScore: 77, foundAt: daysAgo(4) }),
    lead({ id: 'fifty', fitScore: 78, foundAt: daysAgo(4) }),
    lead({ id: 'too-low', fitScore: 77, foundAt: daysAgo(4), scoreCorrection: 'too-low' }),
    lead({ id: 'fresh-low', fitScore: 49, foundAt: hoursAgo(1) }),
    lead({ id: 'kept', column: 'drafting', foundAt: daysAgo(9) }),
    lead({ id: 'kept-low', column: 'ready', fitScore: 40, foundAt: daysAgo(5) }),
    lead({ id: 'applied', column: 'applied', foundAt: daysAgo(30) }),
  )
  const { leads, archived } = archiveStale(file, AT)
  assert.deepEqual(archived, ['stale', 'low', 'fresh-low'])
  assert.deepEqual(
    leads.leads.map(one => one.column),
    [
      'archived',
      'new',
      'new',
      'new',
      'archived',
      'new',
      'new',
      'archived',
      'drafting',
      'ready',
      'applied',
    ],
  )
  assert.equal(leads.leads[4]?.history.at(-1)?.note, 'score 49, below 50')
  assert.equal(leads.leads[7]?.history.at(-1)?.note, 'score 49, below 50')
  // Past a week, the age is the reason given, whatever the score.
  const moved = leads.leads[0] as Lead
  assert.deepEqual(moved.history.at(-1), {
    at: AT,
    by: 'tracker',
    action: 'moved',
    from: 'new',
    to: 'archived',
    note: 'added over 7 days ago',
  })
  // Nothing stale: the same file back, so callers can skip the write.
  const clean = board(lead({ foundAt: daysAgo(1) }))
  assert.equal(archiveStale(clean, AT).leads, clean)
})

test('scout adds a new lead on its fit score, skips postings over 30 days old, and keeps dates', () => {
  const result = addLeads(
    emptyLeads(),
    [
      incoming('Old', { fitScore: 70, postedAt: daysAgo(9) }),
      incoming('Weak', { fitScore: 59, postedAt: hoursAgo(1) }),
      incoming('New', { fitScore: 61, postedAt: hoursAgo(1) }),
      incoming('Dead', { fitScore: 100, postedAt: daysAgo(31) }),
      incoming('Month', { fitScore: 80, postedAt: daysAgo(ADD_MAX_POSTED_DAYS) }),
      // Exactly at the threshold is kept; an unreadable date is no reason to skip.
      incoming('Undated', { fitScore: 60, postedAt: 'last Tuesday' }),
    ],
    AT,
    60,
  )
  assert.equal(ADD_MAX_POSTED_DAYS, 30)
  assert.deepEqual(result.dropped, ['weak-backend-developer', 'dead-backend-developer'])
  assert.deepEqual(result.added, [
    'old-backend-developer',
    'new-backend-developer',
    'month-backend-developer',
    'undated-backend-developer',
  ])
  const kept = result.leads.leads[0] as Lead
  assert.equal(kept.postedAt, daysAgo(9))
  assert.equal(kept.foundAt, AT)
  assert.equal(kept.fitScore, 70)
  // A new lead has not aged: the board shows its fit score.
  assert.equal(effectiveScore(kept, NOW), 70)
  // Over 30 days is skipped whatever the threshold: the posting is likely filled.
  const anyScore = addLeads(
    emptyLeads(),
    [incoming('Dead', { fitScore: 100, postedAt: daysAgo(31) })],
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
  // posting is over 30 days old, and a readable earlier date replaces an unreadable or later one.
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
    60,
  )
  assert.deepEqual(refound.updated, ['acme-backend'])
  assert.equal(refound.leads.leads[0]?.comp, 'CAD 90k')
  assert.equal(refound.leads.leads[0]?.postedAt, daysAgo(35))
  const later = addLeads(
    refound.leads,
    [{ ...incoming('Acme'), id: 'acme-backend', postedAt: daysAgo(3) }],
    AT,
    60,
  )
  assert.equal(later.leads.leads[0]?.postedAt, daysAgo(35))
})

test('feedback and corrections carry the fit score, not the aged one', () => {
  const file = board(lead({ postedAt: daysAgo(28) }))
  assert.equal(correctScore(file, 'acme-backend', 'too-high', AT).event?.fitScore, 86)
  assert.equal(moveLead(file, 'acme-backend', 'drafting', AT, 'user').event?.fitScore, 86)
  const patched = patchLead(file, 'acme-backend', { postedAt: daysAgo(2) }, AT, 'scout')
  assert.equal(patched.leads.leads[0]?.postedAt, daysAgo(2))
})
