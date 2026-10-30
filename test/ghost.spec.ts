import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  addMonths,
  appliedTime,
  emptyApplications,
  emptyFeedback,
  GHOST_AFTER_MONTHS,
  ghostSilent,
  isGhostable,
  previousColumn,
  recentlyGhosted,
} from '../hooks/lib/model.ts'
import type {
  Application,
  ApplicationsFile,
  FeedbackEvent,
  HistoryEntry,
  Lead,
  LeadsFile,
} from '../hooks/lib/model.ts'

const AT = '2026-10-20T12:00:00.000Z'
const NOW = Date.parse(AT)
const MINUTE = 60_000

/** The time `months` calendar months before NOW, less `ms`. */
const before = (months: number, ms = 0) => new Date(addMonths(NOW, -months) - ms).toISOString()

const applied = (at: string): HistoryEntry => ({
  at,
  by: 'submit',
  action: 'moved',
  from: 'ready',
  to: 'applied',
})

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
  column: 'applied',
  foundAt: '2026-08-01T12:00:00.000Z',
  history: [applied(before(GHOST_AFTER_MONTHS))],
  ...fields,
})

const application = (leadId: string, submittedAt?: string): Application => ({
  leadId,
  dir: `packages/${leadId}`,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  files: {},
  status: 'submitted',
  ...(submittedAt ? { submittedAt } : {}),
})

const board = (...leads: Lead[]): LeadsFile => ({ version: 1, leads })
const apps = (...applications: Application[]): ApplicationsFile => ({ version: 1, applications })

test('a month is a calendar month, its day clamped to the shorter month', () => {
  assert.equal(GHOST_AFTER_MONTHS, 1)
  assert.equal(
    new Date(addMonths(Date.parse('2026-09-20T12:00:00.000Z'), 1)).toISOString(),
    '2026-10-20T12:00:00.000Z',
  )
  assert.equal(
    new Date(addMonths(Date.parse('2026-01-31T09:00:00.000Z'), 1)).toISOString(),
    '2026-02-28T09:00:00.000Z',
  )
  assert.equal(
    new Date(addMonths(Date.parse('2026-12-15T00:00:00.000Z'), 1)).toISOString(),
    '2027-01-15T00:00:00.000Z',
  )
})

test('the submission time is the later of the application and the last move into Applied', () => {
  const moved = lead({ history: [applied('2026-09-01T00:00:00.000Z')] })
  assert.equal(
    appliedTime(moved, application(moved.id, '2026-09-03T00:00:00.000Z')),
    Date.parse('2026-09-03T00:00:00.000Z'),
  )
  assert.equal(appliedTime(moved, application(moved.id)), Date.parse('2026-09-01T00:00:00.000Z'))
  assert.equal(appliedTime(moved), Date.parse('2026-09-01T00:00:00.000Z'))
  // Applied again by hand after an old submission: counts from the move.
  assert.equal(
    appliedTime(moved, application(moved.id, '2026-08-01T00:00:00.000Z')),
    Date.parse('2026-09-01T00:00:00.000Z'),
  )
  assert.equal(appliedTime(lead({ history: [] })), undefined)
})

test('an Applied lead is ghostable a month after submitting, not a minute before', () => {
  const at = (ms: number) => lead({ history: [applied(before(1, ms))] })
  assert.equal(isGhostable(at(0), undefined, NOW), true)
  assert.equal(isGhostable(at(MINUTE), undefined, NOW), true)
  assert.equal(isGhostable(at(-MINUTE), undefined, NOW), false)
  // A later submission time on the application counts over the move.
  const old = at(MINUTE)
  assert.equal(isGhostable(old, application(old.id, before(1, -MINUTE)), NOW), false)
  assert.equal(
    isGhostable(lead({ history: [] }), application('acme-backend', before(2)), NOW),
    true,
  )
  // No submission time at all: left alone.
  assert.equal(isGhostable(lead({ history: [] }), undefined, NOW), false)
})

test('a lead with a reply, put back by hand, or in any other column is never ghostable', () => {
  const month = before(2)
  const outcome: Pick<FeedbackEvent, 'leadId' | 'kind'> = {
    leadId: 'acme-backend',
    kind: 'outcome',
  }
  assert.equal(isGhostable(lead(), undefined, NOW, [outcome]), false)
  assert.equal(isGhostable(lead(), undefined, NOW, [{ ...outcome, leadId: 'other' }]), true)
  assert.equal(isGhostable(lead(), undefined, NOW, [{ ...outcome, kind: 'move' }]), true)
  // Back from an interview, or restored after Rejected or Ghosted.
  for (const from of ['interviewing', 'archived', 'passed'] as const) {
    const history = [
      applied(month),
      { at: month, by: 'user' as const, action: 'moved', from: 'applied' as const, to: from },
      { at: month, by: 'user' as const, action: 'moved', from, to: 'applied' as const },
    ]
    assert.equal(isGhostable(lead({ history }), undefined, NOW), false, from)
  }
  for (const column of ['new', 'drafting', 'ready', 'interviewing', 'offer', 'archived'] as const) {
    assert.equal(isGhostable(lead({ column }), undefined, NOW), false, column)
  }
})

test('ghostSilent moves silent applications to Archived and records the Ghosted outcome', () => {
  const file = board(
    lead({ id: 'quiet' }),
    lead({ id: 'fresh', history: [applied(before(1, -MINUTE))] }),
    lead({ id: 'heard' }),
    lead({ id: 'talking', column: 'interviewing' }),
    lead({ id: 'offer', column: 'offer' }),
  )
  const feedback = {
    ...emptyFeedback(),
    events: [{ id: 'e1', at: AT, leadId: 'heard', kind: 'outcome' as const, reason: 'screen: x' }],
  }
  const result = ghostSilent(file, emptyApplications(), feedback, AT)
  assert.deepEqual(result.ghosted, ['quiet'])
  assert.deepEqual(
    result.leads.leads.map(one => one.column),
    ['archived', 'applied', 'applied', 'interviewing', 'offer'],
  )
  const quiet = result.leads.leads[0] as Lead
  assert.deepEqual(quiet.history.at(-1), {
    at: AT,
    by: 'tracker',
    action: 'moved',
    from: 'applied',
    to: 'archived',
    note: 'no reply 1 month after applying (ghosted)',
  })
  // The Ghosted button's outcome, marked as the board's own.
  assert.deepEqual(result.feedback.events.at(-1), {
    id: '20261020120000000-outcome-quiet',
    at: AT,
    leadId: 'quiet',
    kind: 'outcome',
    reason: 'rejection: no reply (ghosted)',
    by: 'tracker',
    source: 'ashby',
    fitScore: 86,
  })
  assert.equal(result.feedback.events.length, 2)
  // Undo is a click: the archived card offers Back to Applied, and is then left there.
  assert.equal(previousColumn(quiet), 'applied')
  const restored: Lead = {
    ...quiet,
    column: 'applied',
    history: [
      ...quiet.history,
      { at: AT, by: 'user', action: 'moved', from: 'archived', to: 'applied' },
    ],
  }
  assert.equal(isGhostable(restored, undefined, NOW + 90 * 86_400_000), false)
})

test('ghostSilent returns the same files when nothing is due', () => {
  const file = board(lead({ history: [applied(before(0))] }))
  const feedback = emptyFeedback()
  const result = ghostSilent(file, apps(), feedback, AT)
  assert.equal(result.leads, file)
  assert.equal(result.feedback, feedback)
  assert.deepEqual(result.ghosted, [])
})

test('the board lists the leads it ghosted in the last week, newest first', () => {
  const ghost = (id: string, days: number, fields: Partial<Lead> = {}): Lead => {
    const at = new Date(NOW - days * 86_400_000).toISOString()
    const entry = { at, by: 'tracker' as const, action: 'moved', from: 'applied' as const }
    return lead({
      id,
      column: 'archived',
      history: [
        applied(before(2)),
        { ...entry, to: 'archived', note: 'no reply 1 month after applying (ghosted)' },
      ],
      ...fields,
    })
  }
  const restored = ghost('restored', 1)
  restored.column = 'applied'
  restored.history.push({ at: AT, by: 'user', action: 'moved', from: 'archived', to: 'applied' })
  const file = board(
    ghost('older', 3),
    ghost('newer', 1),
    ghost('stale', 8),
    restored,
    // Ghosted by hand: the person already knows.
    ghost('by-hand', 1, {
      history: [
        {
          at: AT,
          by: 'user',
          action: 'moved',
          from: 'applied',
          to: 'archived',
          note: 'rejection: no reply (ghosted)',
        },
      ],
    }),
    lead({ id: 'waiting' }),
  )
  assert.deepEqual(
    recentlyGhosted(file, NOW).map(one => one.id),
    ['newer', 'older'],
  )
})
