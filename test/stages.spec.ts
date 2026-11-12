import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Application, HistoryEntry, Lead, LeadsFile, Stage } from '../hooks/lib/model.ts'
import {
  applicationTime,
  BOARD_TABS,
  COLUMNS,
  columnTitle,
  defaultStage,
  GHOST_NOTE,
  GHOSTED_REASON,
  isApplication,
  isGhosted,
  previousColumn,
  scoreTone,
  sourceLabel,
  STAGE_ACTIONS,
  STAGE_TITLES,
  stageCount,
  stageLeads,
  stageOf,
  TAB_STAGES,
  tabCount,
  stageTab,
  tabStages,
} from '../hooks/lib/model.ts'

const AT = '2026-10-20T12:00:00.000Z'

const moved = (from: Lead['column'], to: Lead['column'], note?: string): HistoryEntry => ({
  at: AT,
  by: 'user',
  action: 'moved',
  from,
  to,
  ...(note ? { note } : {}),
})

const board = (...leads: Partial<Lead>[]): LeadsFile => ({
  version: 1,
  leads: leads.map(one => ({ company: '', foundAt: '', history: [], ...one }) as Lead),
})
const only = (column: Lead['column']) => board({ column })

const ghosted: Pick<Lead, 'column' | 'history'> = {
  column: 'archived',
  history: [moved('applied', 'archived', GHOST_NOTE)],
}
const ghostedByHand: Pick<Lead, 'column' | 'history'> = {
  column: 'archived',
  history: [moved('applied', 'archived', GHOSTED_REASON)],
}

test('each tab opens on its first stage with leads, and never leaves the tab', () => {
  assert.equal(defaultStage(only('new')), 'new')
  assert.equal(defaultStage(only('ready')), 'ready')
  assert.equal(defaultStage(only('drafting')), 'drafting')
  // An empty Active stays on Active, however much is elsewhere.
  assert.equal(defaultStage(only('applied')), 'new')
  assert.equal(defaultStage(only('passed')), 'new')
  assert.equal(defaultStage({ version: 1, leads: [] }), 'new')
  assert.equal(defaultStage(only('new'), 'applications'), 'applied')
  assert.equal(defaultStage(only('offer'), 'applications'), 'offer')
  assert.equal(defaultStage(only('new'), 'settled'), 'passed')
  assert.equal(defaultStage(only('rejected'), 'settled'), 'rejected')
  assert.equal(defaultStage(board(ghosted), 'settled'), 'ghosted')
})

test('every column is one stage of one tab, in the order the board shows them', () => {
  const stages = BOARD_TABS.flatMap(tab => TAB_STAGES[tab])
  assert.equal(new Set(stages).size, stages.length)
  for (const column of COLUMNS) assert.ok(stages.includes(column), column)
  assert.deepEqual(TAB_STAGES.active, ['new', 'drafting', 'ready'])
  assert.deepEqual(TAB_STAGES.applications, ['applied', 'interviewing', 'offer'])
  assert.deepEqual(TAB_STAGES.settled, ['passed', 'archived', 'rejected', 'ghosted'])
  for (const stage of stages) assert.ok(TAB_STAGES[stageTab(stage)].includes(stage), stage)
  assert.deepEqual(
    (['applied', 'interviewing', 'offer'] as const).map(stage => STAGE_TITLES[stage]),
    ['Current', 'Interviews', 'Offers'],
  )
  assert.equal(STAGE_TITLES.ready, 'Ready to apply')
})

test('Drafting, Interviews and Offers show only with cards in them', () => {
  assert.deepEqual(tabStages(only('applied'), 'active'), ['new', 'ready'])
  assert.deepEqual(tabStages(only('drafting'), 'active'), ['new', 'drafting', 'ready'])
  assert.deepEqual(tabStages(only('new'), 'applications'), ['applied'])
  assert.deepEqual(
    tabStages(board({ column: 'offer' }, { column: 'interviewing' }), 'applications'),
    ['applied', 'interviewing', 'offer'],
  )
  assert.deepEqual(tabStages(only('new'), 'settled'), ['passed', 'archived', 'rejected', 'ghosted'])
})

test('a ghosted lead is in Ghosted and not in Archived, however it got there', () => {
  assert.equal(stageOf(ghosted), 'ghosted')
  assert.equal(stageOf(ghostedByHand), 'ghosted')
  assert.ok(isGhosted(ghosted) && isGhosted(ghostedByHand))
  assert.equal(stageOf({ column: 'archived', history: [] }), 'archived')
  assert.equal(stageOf({ column: 'archived', history: [moved('new', 'archived')] }), 'archived')
  // Back to Applied leaves Ghosted, and archiving it again later is no ghosting.
  const restored = [...ghosted.history, moved('archived', 'applied')]
  assert.equal(stageOf({ column: 'applied', history: restored }), 'applied')
  assert.equal(
    stageOf({ column: 'archived', history: [...restored, moved('applied', 'archived')] }),
    'archived',
  )
  const file = board(ghosted, ghostedByHand, { column: 'archived' })
  assert.equal(stageCount(file, 'ghosted'), 2)
  assert.equal(stageCount(file, 'archived'), 1)
  assert.deepEqual(
    (['archived', 'ghosted'] as Stage[]).map(stage => stageLeads(file, stage).length),
    [1, 2],
  )
})

test('Active adds up its stages, Settled is its total, nothing shows twice', () => {
  const file = board(
    { column: 'new' },
    { column: 'drafting' },
    { column: 'ready' },
    { column: 'applied' },
    { column: 'passed' },
    { column: 'archived' },
    { column: 'rejected' },
    ghosted,
  )
  assert.equal(tabCount(file, 'active'), 3)
  assert.equal(tabCount(file, 'settled'), 4)
  const shown = BOARD_TABS.flatMap(tab => TAB_STAGES[tab]).reduce(
    (sum, stage) => sum + stageCount(file, stage),
    0,
  )
  assert.equal(shown, file.leads.length)
})

test('Applications counts every application ever made, not what the tab shows', () => {
  const file = board(
    { column: 'applied' },
    { column: 'interviewing' },
    { column: 'offer' },
    { column: 'rejected', history: [moved('applied', 'rejected')] },
    ghosted,
    ghostedByHand,
    // Accepted or declined: an offer settled in Archived.
    { column: 'archived', history: [moved('applied', 'offer'), moved('offer', 'archived')] },
    // Reached Interviewing with no stop in Applied, then passed on.
    {
      column: 'passed',
      history: [moved('ready', 'interviewing'), moved('interviewing', 'passed')],
    },
    // Never applied to.
    { column: 'archived', history: [moved('new', 'archived')] },
    { column: 'passed', history: [moved('new', 'passed')] },
    { column: 'new' },
    // Undone: moved back to the start, it is work to do again.
    { column: 'new', history: [moved('ready', 'applied'), moved('applied', 'new')] },
  )
  assert.equal(tabCount(file, 'applications'), 8)
  assert.equal(stageCount(file, 'applied'), 1)
  assert.equal(file.leads.filter(isApplication).length, 8)
})

test('New sorts best fit first, then by company', () => {
  const file = board(
    { id: 'a', column: 'new', company: 'Zed', fitScore: 80, foundAt: '2026-10-03' },
    { id: 'b', column: 'new', company: 'Acme', fitScore: 80, foundAt: '2026-10-01' },
    { id: 'c', column: 'new', company: 'Mid', fitScore: 95, foundAt: '2026-10-02' },
  )
  assert.deepEqual(
    stageLeads(file, 'new').map(one => one.id),
    ['c', 'b', 'a'],
  )
})

test('Current sorts by application date, newest first', () => {
  const into = (at: string) => [{ ...moved('ready', 'applied'), at }]
  const application = (leadId: string, submittedAt?: string) =>
    ({ leadId, ...(submittedAt ? { submittedAt } : {}) }) as Application
  const file = board(
    { id: 'old', column: 'applied', company: 'A', fitScore: 99, history: into('2026-09-01') },
    { id: 'recent', column: 'applied', company: 'B', fitScore: 10, history: into('2026-09-02') },
    { id: 'moved', column: 'applied', company: 'C', history: into('2026-09-10') },
    { id: 'none', column: 'applied', company: 'D' },
  )
  const applications = [application('old', '2026-09-05'), application('recent', '2026-09-20')]
  assert.deepEqual(
    stageLeads(file, 'applied', applications).map(one => one.id),
    ['recent', 'moved', 'old', 'none'],
  )
})

test('the application date is the submission, even after a lead was put back in Applied', () => {
  const back = { ...moved('archived', 'applied'), at: '2026-10-15T00:00:00.000Z' }
  const date = '2026-09-01T00:00:00.000Z'
  assert.equal(applicationTime({ history: [back] }, { submittedAt: date }), Date.parse(date))
  assert.equal(applicationTime({ history: [back] }, {}), Date.parse(back.at))
  assert.equal(
    applicationTime({ history: [back] }, { submittedAt: 'not a date' }),
    Date.parse(back.at),
  )
  assert.equal(applicationTime({ history: [] }), 0)
})

test('every other stage sorts by when the lead was found, newest first', () => {
  for (const column of [
    'drafting',
    'ready',
    'interviewing',
    'offer',
    'rejected',
    'passed',
  ] as const) {
    const file = board(
      { id: 'a', column, company: 'A', fitScore: 99, foundAt: '2026-10-01T00:00:00.000Z' },
      { id: 'b', column, company: 'B', fitScore: 10, foundAt: '2026-10-09T00:00:00.000Z' },
      { id: 'c', column, company: 'C', foundAt: 'never' },
    )
    assert.deepEqual(
      stageLeads(file, column).map(one => one.id),
      ['b', 'a', 'c'],
    )
  }
  const file = board(
    { ...ghosted, id: 'a', company: 'A', foundAt: '2026-10-01T00:00:00.000Z' },
    { ...ghostedByHand, id: 'b', company: 'B', foundAt: '2026-10-09T00:00:00.000Z' },
  )
  assert.deepEqual(
    stageLeads(file, 'ghosted').map(one => one.id),
    ['b', 'a'],
  )
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
  for (const column of COLUMNS) {
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
  assert.ok(!(COLUMNS as readonly string[]).includes('shortlisted'))
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
  assert.equal(columnTitle('ready'), 'Ready to apply')
})
