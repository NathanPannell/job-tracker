import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Lead } from '../hooks/lib/model.ts'
import {
  columnTitle,
  defaultStage,
  PIPELINE,
  previousColumn,
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
  assert.deepEqual(
    STAGE_ACTIONS.rejected.map(one => one.key),
    ['back-new'],
  )
})

test('a rejection goes to Rejected; a lead no company turned down goes to Archived', () => {
  assert.deepEqual(PIPELINE.slice(-4), ['applied', 'interviewing', 'offer', 'rejected'])
  const outcomes = Object.values(STAGE_ACTIONS)
    .flat()
    .flatMap(one => (one.kind === 'outcome' ? [[one.key, one.to, one.reason]] : []))
    .filter(([, to]) => to === 'rejected' || to === 'archived')
  assert.deepEqual(outcomes, [
    ['rejected', 'rejected', 'rejection: marked on the board'],
    ['ghosted', 'archived', 'rejection: no reply (ghosted)'],
    ['rejected', 'rejected', 'rejection: after interviews'],
    ['accepted', 'archived', 'offer: accepted'],
    ['declined', 'archived', 'offer: declined'],
  ])
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
  assert.equal(
    previousColumn({ column: 'rejected', history: [moved('interviewing', 'rejected')] }),
    'interviewing',
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
