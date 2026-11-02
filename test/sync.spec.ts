import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GHOST_NOTE,
  isMovedByEmail,
  noteUnclear,
  openUnclear,
  restoreNote,
  SYNC_NOTICE_DAYS,
  syncNotices,
} from '../hooks/lib/model.ts'
import type { HistoryEntry, Lead, LeadsFile } from '../hooks/lib/model.ts'

const AT = '2026-10-20T12:00:00.000Z'
const NOW = Date.parse(AT)
const DAY = 86_400_000

const daysAgo = (days: number, ms = 0) => new Date(NOW - days * DAY - ms).toISOString()

const moved = (at: string, by: HistoryEntry['by'], to: Lead['column']): HistoryEntry => ({
  at,
  by,
  action: 'moved',
  from: 'applied',
  to,
})
const unclear = (at: string, note = 'Oct 19, recruiter: asks for references'): HistoryEntry => ({
  at,
  by: 'sync',
  action: 'unclear',
  note,
})

const board = (...histories: HistoryEntry[][]): LeadsFile => ({
  version: 1,
  leads: histories.map((history, n) => ({ id: `lead-${n}`, column: 'applied', history }) as Lead),
})

const ids = (leads: readonly Lead[]) => leads.map(one => one.id)

test('the board names what email moved this week, most recent first', () => {
  const file = board(
    [moved(daysAgo(3), 'sync', 'rejected')],
    [moved(daysAgo(1), 'sync', 'interviewing')],
    [moved(daysAgo(SYNC_NOTICE_DAYS), 'sync', 'offer')],
    [moved(daysAgo(SYNC_NOTICE_DAYS, 1), 'sync', 'offer')],
    [moved(daysAgo(1), 'user', 'rejected')],
    [],
  )
  assert.deepEqual(ids(syncNotices(file, NOW).moved), ['lead-1', 'lead-0', 'lead-2'])
})

test('a card moved since is out of the notice: the last move is not email', () => {
  const file = board([moved(daysAgo(2), 'sync', 'rejected'), moved(daysAgo(1), 'user', 'applied')])
  assert.deepEqual(syncNotices(file, NOW).moved, [])
})

test('what email left unclear shows for a week, until the card moves on', () => {
  const file = board(
    [unclear(daysAgo(2))],
    [unclear(daysAgo(1))],
    [unclear(daysAgo(SYNC_NOTICE_DAYS, 1))],
    [unclear(daysAgo(2)), moved(daysAgo(1), 'user', 'rejected')],
    [moved(daysAgo(3), 'sync', 'interviewing'), unclear(daysAgo(1))],
  )
  const notices = syncNotices(file, NOW)
  assert.deepEqual(ids(notices.unclear), ['lead-1', 'lead-4', 'lead-0'])
  assert.deepEqual(ids(notices.moved), ['lead-4'])
})

test('a lead keeps its latest unclear note until the card moves', () => {
  const [lead] = board([unclear(daysAgo(3), 'first'), unclear(daysAgo(1), 'second')]).leads
  assert.equal(openUnclear(lead as Lead)?.note, 'second')
  assert.equal(openUnclear({ history: [] }), undefined)
  assert.equal(
    openUnclear({ history: [unclear(daysAgo(3)), moved(daysAgo(1), 'sync', 'offer')] }),
    undefined,
  )
})

test('the board ghosting a lead leaves its unclear reply standing', () => {
  const swept = { ...moved(daysAgo(1), 'tracker', 'archived'), note: GHOST_NOTE }
  assert.equal(openUnclear({ history: [unclear(daysAgo(3)), swept] })?.note, unclear('').note)
  const file = board([unclear(daysAgo(3)), swept])
  assert.deepEqual(ids(syncNotices(file, NOW).unclear), ['lead-0'])
})

test('a card email moved last can be undone; one moved since cannot be taken for it', () => {
  assert.ok(isMovedByEmail({ history: [moved(daysAgo(1), 'sync', 'interviewing')] }))
  assert.ok(
    !isMovedByEmail({
      history: [moved(daysAgo(2), 'sync', 'interviewing'), moved(daysAgo(1), 'user', 'offer')],
    }),
  )
  assert.ok(!isMovedByEmail({ history: [] }))
})

test('a ghosted lead sent elsewhere goes back with its ghosted note', () => {
  const ghosted = { ...moved(daysAgo(3), 'tracker', 'archived'), note: GHOST_NOTE }
  const rejected = { ...moved(daysAgo(1), 'sync', 'rejected'), from: 'archived' as const }
  assert.equal(restoreNote({ column: 'rejected', history: [ghosted, rejected] }), GHOST_NOTE)
  const archived = moved(daysAgo(3), 'user', 'archived')
  assert.equal(restoreNote({ column: 'rejected', history: [archived, rejected] }), undefined)
  assert.equal(restoreNote({ column: 'new', history: [] }), undefined)
})

test('noteUnclear records the note on the lead and leaves its column alone', () => {
  const file = board([])
  const { leads, event } = noteUnclear(file, 'lead-0', '  Oct 19, recruiter: which role?  ', AT)
  assert.equal(event, undefined)
  assert.equal(leads.leads[0]?.column, 'applied')
  assert.deepEqual(leads.leads[0]?.history, [
    { at: AT, by: 'sync', action: 'unclear', note: 'Oct 19, recruiter: which role?' },
  ])
})

test('the same words again record nothing: every run reads the same inbox', () => {
  const once = noteUnclear(board([]), 'lead-0', 'Oct 19, recruiter: which role?', AT).leads
  const twice = noteUnclear(once, 'lead-0', 'Oct 19, recruiter: which role?', AT).leads
  assert.equal(twice, once)
  const other = noteUnclear(once, 'lead-0', 'Oct 20, recruiter: any news?', AT).leads
  assert.equal(other.leads[0]?.history.length, 2)
})

test('noteUnclear refuses an unknown lead and an empty note', () => {
  assert.equal(noteUnclear(board([]), 'nope', 'x', AT).error, 'No lead nope')
  assert.equal(noteUnclear(board([]), 'lead-0', '   ', AT).error, 'Say what is unclear')
})
