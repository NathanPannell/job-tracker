import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FeedbackEvent, Lead } from '../hooks/lib/model.ts'
import {
  bigDigits,
  bigNumberSvg,
  columnTitle,
  defaultStage,
  emptyFeedback,
  ghostSilent,
  GHOSTED_REASON,
  PIPELINE,
  previousColumn,
  rejectionCount,
  scoreTone,
  sourceLabel,
  STAGE_ACTIONS,
} from '../hooks/lib/model.ts'

const only = (column: Lead['column']) => ({ version: 1 as const, leads: [{ column } as Lead] })

test('the board opens on New while it has leads, else the first stage with any', () => {
  assert.equal(defaultStage(only('new')), 'new')
  assert.equal(defaultStage(only('applied')), 'applied')
  assert.equal(defaultStage(only('passed')), 'new')
  assert.equal(defaultStage({ version: 1, leads: [] }), 'new')
})

test('scores are strong from 90, worth a look from 75, weak below', () => {
  assert.equal(scoreTone(90), 'success')
  assert.equal(scoreTone(89), 'warning')
  assert.equal(scoreTone(75), 'warning')
  assert.equal(scoreTone(74), 'subtle')
})

test('sources read as words', () => {
  assert.equal(sourceLabel('web'), 'Web search')
  assert.equal(sourceLabel('gmail:viatec'), 'VIATEC The Loop')
  assert.equal(sourceLabel('careers:Elastic Energy'), 'Elastic Energy careers')
  assert.equal(sourceLabel('signal:betakit'), 'betakit (news)')
  assert.equal(sourceLabel('gmail:jobbank'), 'jobbank email')
  assert.equal(sourceLabel('VIATEC job board'), 'VIATEC job board')
  assert.equal(sourceLabel('careers:'), 'careers:')
})

test('every stage offers one highlighted next step, and outcomes say what happened', () => {
  for (const column of PIPELINE) {
    const actions = STAGE_ACTIONS[column]
    assert.ok(actions.length > 0, column)
    assert.ok(actions.filter(one => one.primary).length <= 1, column)
    assert.equal(new Set(actions.map(one => one.key)).size, actions.length, column)
  }
  for (const column of ['new', 'ready', 'applied', 'interviewing', 'offer'] as const) {
    assert.ok(STAGE_ACTIONS[column][0]?.primary, column)
  }
  // The main flow: New drafts or passes; Ready is reviewed, then approved and submitted.
  assert.deepEqual(
    STAGE_ACTIONS.new.map(one => [one.label, one.kind]),
    [
      ['Draft package', 'draft'],
      ['Pass', 'pass'],
    ],
  )
  assert.deepEqual(
    STAGE_ACTIONS.ready.map(one => [one.label, one.kind]),
    [
      ['Review', 'review'],
      ['Approve and submit', 'submit'],
    ],
  )
  assert.ok(!(PIPELINE as readonly string[]).includes('shortlisted'))
  const outcomes = Object.values(STAGE_ACTIONS)
    .flat()
    .filter(one => one.kind === 'outcome')
  assert.ok(outcomes.length >= 4)
  for (const one of outcomes) {
    // A company's decision is never recorded as the person's pass.
    assert.ok(one.kind === 'outcome' && one.to !== 'passed', one.key)
    assert.match(one.kind === 'outcome' ? one.reason : '', /^(interview|offer|rejection): /)
  }
  assert.deepEqual(
    STAGE_ACTIONS.passed.map(one => one.key),
    ['back-new'],
  )
})

test('a closed lead remembers the column it came from', () => {
  const moved = (from: Lead['column'], to: Lead['column']) => ({
    at: '',
    by: 'user' as const,
    action: 'moved',
    from,
    to,
  })
  assert.equal(
    previousColumn({
      column: 'archived',
      history: [moved('new', 'applied'), moved('applied', 'archived')],
    }),
    'applied',
  )
  assert.equal(previousColumn({ column: 'new', history: [] }), undefined)
  assert.equal(
    previousColumn({ column: 'passed', history: [{ ...moved('new', 'passed'), from: undefined }] }),
    undefined,
  )
  // History from before Shortlisted was removed names it; there is no going back there.
  const legacy = 'shortlisted' as Lead['column']
  assert.equal(previousColumn({ column: 'passed', history: [moved(legacy, 'passed')] }), undefined)
  assert.equal(columnTitle(legacy), 'shortlisted')
  assert.equal(columnTitle('ready'), 'Ready to review')
})

const outcome = (leadId: string, reason?: string) => ({ leadId, kind: 'outcome', reason }) as const
const moved = (leadId: string, from: Lead['column'], to: Lead['column']) =>
  ({ leadId, kind: 'move', from, to }) as const

test('rejections count every way one is recorded, and nothing else', () => {
  const buttons = Object.values(STAGE_ACTIONS)
    .flat()
    .flatMap(one => (one.kind === 'outcome' ? [one.reason] : []))
    .filter(reason => reason.startsWith('rejection:') && reason !== GHOSTED_REASON)
  assert.deepEqual(buttons, ['rejection: marked on the board', 'rejection: after interviews'])
  assert.equal(
    rejectionCount([
      outcome('sync', "rejection: Acme won't be progressing"),
      ...buttons.map((reason, n) => outcome(`button-${n}`, reason)),
      outcome('reply', 'interview: screen on Monday'),
      outcome('offer', 'offer: accepted'),
      outcome('blank'),
      { leadId: 'a-pass', kind: 'pass', reason: 'rejection: not a company’s word' },
      moved('moved', 'applied', 'archived'),
    ]),
    3,
  )
  assert.equal(rejectionCount([]), 0)
})

test('a ghosted lead sent no email, so it is no rejection unless one comes after all', () => {
  assert.equal(rejectionCount([outcome('acme', GHOSTED_REASON)]), 0)
  // Sync records a late rejection on a lead the board ghosted, and the lead stays in Archived.
  assert.equal(
    rejectionCount([outcome('acme', GHOSTED_REASON), outcome('acme', 'rejection: late reply')]),
    1,
  )
  assert.equal(
    rejectionCount([outcome('acme', 'rejection: reply'), outcome('acme', GHOSTED_REASON)]),
    1,
  )
})

test('the board ghosting a lead writes a row that is no rejection', () => {
  const lead = {
    id: 'acme',
    column: 'applied',
    source: 'ashby',
    fitScore: 80,
    history: [{ at: '2026-09-01T00:00:00.000Z', by: 'submit', action: 'moved', to: 'applied' }],
  } as Lead
  const { feedback, ghosted } = ghostSilent(
    { version: 1, leads: [lead] },
    { version: 1, applications: [] },
    emptyFeedback(),
    '2026-10-20T12:00:00.000Z',
  )
  assert.deepEqual(ghosted, ['acme'])
  assert.equal(feedback.events[0]?.reason, GHOSTED_REASON)
  assert.equal(rejectionCount(feedback.events), 0)
})

test('a lead counts once, however many rejections it has', () => {
  assert.equal(
    rejectionCount([outcome('acme', 'rejection: one'), outcome('acme', 'rejection: two')]),
    1,
  )
})

test('a rejection taken back no longer counts, and the row that stays does not revive it', () => {
  const rejected: Pick<FeedbackEvent, 'leadId' | 'kind' | 'reason' | 'to'>[] = [
    moved('acme', 'applied', 'archived'),
    outcome('acme', 'rejection: marked on the board'),
  ]
  assert.equal(rejectionCount(rejected), 1)
  const undone = [...rejected, moved('acme', 'archived', 'applied')]
  assert.equal(rejectionCount(undone), 0)
  // Back to New or a pass from Archived takes it back the same way.
  assert.equal(rejectionCount([...rejected, moved('acme', 'archived', 'new')]), 0)
  assert.equal(
    rejectionCount([...rejected, { ...moved('acme', 'archived', 'passed'), kind: 'pass' }]),
    0,
  )
  // Archiving it by hand afterwards is not the company saying no again.
  assert.equal(rejectionCount([...undone, moved('acme', 'applied', 'archived')]), 0)
  // Rejected for real this time.
  assert.equal(
    rejectionCount([
      ...undone,
      moved('acme', 'applied', 'archived'),
      outcome('acme', 'rejection: an email'),
    ]),
    1,
  )
})

test('a move out of Archived before the rejection does not take it back', () => {
  // The lead was archived as stale and restored, then applied to and rejected.
  assert.equal(
    rejectionCount([
      moved('acme', 'archived', 'new'),
      moved('acme', 'ready', 'applied'),
      moved('acme', 'applied', 'archived'),
      outcome('acme', 'rejection: an email'),
    ]),
    1,
  )
})

test('another lead’s move leaves a rejection alone', () => {
  assert.equal(
    rejectionCount([outcome('acme', 'rejection: an email'), moved('beta', 'archived', 'applied')]),
    1,
  )
})

test('a big number is five rows of block digits', () => {
  assert.equal(bigDigits(3), ['███', '  █', ' ██', '  █', '███'].join('\n'))
  assert.equal(bigDigits(0), ['███', '█ █', '█ █', '█ █', '███'].join('\n'))
  const twelve = bigDigits(12).split('\n')
  assert.deepEqual(twelve, [' █  ███', '██    █', ' █  ███', ' █  █  ', '███ ███'])
  for (const digit of [1, 2, 4, 5, 6, 7, 8, 9]) {
    const rows = bigDigits(digit).split('\n')
    assert.equal(rows.length, 5, String(digit))
    assert.ok(
      rows.every(row => row.length === 3),
      String(digit),
    )
  }
  assert.equal(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(bigDigits)).size, 10)
})

test('a big number draws as rectangles, one for each block of its digits', () => {
  const blocks = (value: number) => [...bigDigits(value)].filter(cell => cell === '█').length
  const rects = (value: number) => bigNumberSvg(value).match(/<rect /g)?.length
  for (const value of [0, 3, 12, 120]) assert.equal(rects(value), blocks(value), String(value))
  assert.match(bigNumberSvg(3), /width="36" height="60"/)
  assert.match(bigNumberSvg(120), /width="132" height="60"/)
  // The second digit starts past the first and the gap: four blocks of twelve pixels.
  assert.match(bigNumberSvg(11), /<rect x="48" y="0"/)
  assert.ok(!bigNumberSvg(3).includes('<text'))
})
