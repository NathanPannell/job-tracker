import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  addLeads,
  columnLeads,
  correctScore,
  DECAY_MAX_POINTS,
  decayNote,
  effectiveScore,
  emptyLeads,
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

test('a score keeps its value for a week, then loses five points a week, at most 25', () => {
  const at = (days: number) => scoreDecay(lead({ foundAt: daysAgo(days) }), NOW)
  assert.deepEqual([0, 3, 7, 8].map(at), [0, 0, 0, 0])
  assert.equal(at(9), 1)
  assert.equal(at(14), 5)
  assert.equal(at(21), 10)
  assert.equal(at(28), 15)
  assert.equal(at(42), 25)
  assert.equal(at(365), DECAY_MAX_POINTS)
  assert.equal(scoreDecay(lead({ foundAt: daysAgo(-3) }), NOW), 0)
})

test('only leads not yet applied to age', () => {
  const old = (column: Column) => effectiveScore(lead({ column, foundAt: daysAgo(21) }), NOW)
  for (const column of ['new', 'shortlisted', 'drafting', 'ready'] as const) {
    assert.equal(old(column), 76, column)
  }
  for (const column of ['applied', 'interviewing', 'offer', 'passed', 'archived'] as const) {
    assert.equal(old(column), 86, column)
  }
})

test('the posting date is preferred to when scout found it', () => {
  const posted = lead({ postedAt: daysAgo(21), foundAt: daysAgo(1) })
  assert.equal(postedTime(posted), NOW - 21 * DAY)
  assert.equal(effectiveScore(posted, NOW), 76)
  const unreadable = lead({ postedAt: 'last Tuesday', foundAt: daysAgo(14) })
  assert.equal(postedTime(unreadable), NOW - 14 * DAY)
  assert.equal(effectiveScore(unreadable, NOW), 81)
})

test('the aged score never goes under zero and the fit score is never changed', () => {
  const weak = lead({ fitScore: 10, foundAt: daysAgo(60) })
  assert.equal(effectiveScore(weak, NOW), 0)
  assert.equal(weak.fitScore, 10)
})

test('the decay note shows the fit, the aged score and the age', () => {
  assert.equal(
    decayNote(lead({ postedAt: daysAgo(21), foundAt: daysAgo(2) }), NOW),
    'Fit 86 → 76, posted 3w ago',
  )
  assert.equal(decayNote(lead({ foundAt: daysAgo(14) }), NOW), 'Fit 86 → 81, found 14d ago')
  assert.equal(decayNote(lead({ foundAt: daysAgo(3) }), NOW), undefined)
  assert.equal(decayNote(lead({ column: 'applied', foundAt: daysAgo(30) }), NOW), undefined)
})

test('a column re-sorts as its leads age', () => {
  const fresh = lead({ id: 'fresh', company: 'Fresh', fitScore: 80, foundAt: AT })
  const old = lead({ id: 'old', company: 'Old', fitScore: 85, postedAt: AT, foundAt: AT })
  const order = (now: number) => columnLeads(board(old, fresh), 'new', now).map(one => one.id)
  assert.deepEqual(order(NOW), ['old', 'fresh'])
  // Four weeks on both have aged by the same 15 points: the better fit still leads.
  assert.deepEqual(order(NOW + 28 * DAY), ['old', 'fresh'])
  const stale = lead({ ...old, postedAt: daysAgo(28) })
  assert.deepEqual(
    columnLeads(board(stale, fresh), 'new', NOW).map(one => one.id),
    ['fresh', 'old'],
  )
  // Equal aged scores: the better fit, the older posting, leads.
  const tied = lead({ id: 'tied', company: 'Tied', fitScore: 75, foundAt: AT })
  const aged = lead({ id: 'aged', company: 'Aged', fitScore: 80, foundAt: daysAgo(14) })
  assert.deepEqual(
    columnLeads(board(tied, aged), 'new', NOW).map(one => one.id),
    ['aged', 'tied'],
  )
})

test('the nudge names the best leads by aged score, with that score', () => {
  const fresh = lead({ id: 'fresh', company: 'Fresh', fitScore: 80 })
  const stale = lead({ id: 'stale', company: 'Stale', fitScore: 85, postedAt: daysAgo(28) })
  const named = leadsToMention(board(stale, fresh), NOW)
  assert.deepEqual(
    named.map(one => one.id),
    ['fresh', 'stale'],
  )
  assert.match(nudgeContext(named, NOW), /Stale — Backend Developer \(score 70\)/)
})

test('scout adds an old posting only when its aged score clears the threshold, and keeps its date', () => {
  const result = addLeads(
    emptyLeads(),
    [
      incoming('Old', { fitScore: 70, postedAt: daysAgo(25) }),
      incoming('Oldbutgood', { fitScore: 80, postedAt: daysAgo(25) }),
      incoming('New', { fitScore: 61, postedAt: daysAgo(2) }),
    ],
    AT,
    60,
  )
  assert.deepEqual(result.dropped, ['old-backend-developer'])
  assert.deepEqual(result.added, ['oldbutgood-backend-developer', 'new-backend-developer'])
  const kept = result.leads.leads[0] as Lead
  assert.equal(kept.postedAt, daysAgo(25))
  assert.equal(kept.fitScore, 80)
  const again = addLeads(
    result.leads,
    [incoming('Oldbutgood', { postedAt: daysAgo(1) }), incoming('New', { postedAt: undefined })],
    AT,
    0,
  )
  assert.equal(again.leads.leads[0]?.postedAt, daysAgo(25))
  assert.equal(again.leads.leads[1]?.postedAt, daysAgo(2))
  // A lead already on the board is refreshed even when its aged score is under the threshold,
  // and a readable earlier date replaces an unreadable or later one.
  const onBoard = board(lead({ column: 'applied', postedAt: 'last Tuesday', comp: '' }))
  const refound = addLeads(
    onBoard,
    [
      {
        ...incoming('Acme'),
        id: 'acme-backend',
        fitScore: 70,
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
  // Exactly at the threshold once aged is kept.
  const edge = addLeads(
    emptyLeads(),
    [incoming('Edge', { fitScore: 65, postedAt: daysAgo(14) })],
    AT,
    60,
  )
  assert.deepEqual(edge.added, ['edge-backend-developer'])
})

test('feedback and corrections carry the fit score, not the aged one', () => {
  const file = board(lead({ postedAt: daysAgo(28) }))
  assert.equal(correctScore(file, 'acme-backend', 'too-high', AT).event?.fitScore, 86)
  assert.equal(moveLead(file, 'acme-backend', 'shortlisted', AT, 'user').event?.fitScore, 86)
  const patched = patchLead(file, 'acme-backend', { postedAt: daysAgo(2) }, AT, 'scout')
  assert.equal(patched.leads.leads[0]?.postedAt, daysAgo(2))
})
