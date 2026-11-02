import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import * as commands from '../bin/lib/commands.ts'
import { readData } from '../bin/lib/store.ts'
import {
  checkProposal,
  CLARIFICATION_LIMIT,
  clarifyChange,
  clarifyKey,
  decideChanges,
  hasApproved,
  isApprovable,
  MAX_CHANGES,
  newProposal,
  normalizeProposal,
  openClarification,
  reviseChange,
  reviseRelay,
  reviseTask,
} from '../hooks/lib/model.ts'
import type { ProposalInput, ProposalsFile, StoredProposal } from '../hooks/lib/model.ts'

const root = mkdtempSync(join(tmpdir(), 'job-tracker-proposals-'))
after(() => rmSync(root, { recursive: true, force: true }))

let n = 0
const fresh = () => {
  const dir = join(root, `data-${(n += 1)}`)
  commands.init(dir)
  return dir
}

const change = (title: string, file: 'learnings.md' | 'preferences.md' = 'learnings.md') => ({
  file,
  title,
  rationale: `Seen 3 times: ${title}`,
  text: `Rule: ${title}.`,
})

const input = (count: number, extra: Partial<ProposalInput> = {}): ProposalInput => ({
  summary: 'Week two',
  funnel: '| a | b |',
  changes: Array.from({ length: count }, (_, k) => change(`Learning ${k + 1}`)),
  ...extra,
})

const profile = (dir: string, file: string) => {
  const path = join(dir, 'profile', file)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** The shape `proposals.json` held before per-change decisions. */
const legacy = (status: 'pending' | 'approved' | 'rejected'): StoredProposal => ({
  id: `old-${status}`,
  createdAt: '2026-10-26T01:10:51.531Z',
  status,
  summary: 'First week',
  funnel: '| x |',
  changes: [change('Old one'), change('Old two', 'preferences.md')],
  ...(status === 'pending' ? {} : { decidedAt: '2026-10-26T09:00:00.000Z' }),
})

test('propose takes 3 to 10 changes, fewer only with a reason, each pending with an id', () => {
  const dir = fresh()
  assert.throws(() => commands.propose(dir, input(MAX_CHANGES + 1)), /at most 10 changes, not 11/)
  assert.throws(() => commands.propose(dir, input(2)), /fewer than 3 changes needs a fewerReason/)
  assert.throws(() => commands.propose(dir, { summary: '', funnel: '' } as never), /changes array/)
  const ten = commands.propose(dir, input(10, { id: 'ten' }))
  assert.equal(ten.status, 'pending')
  assert.deepEqual(
    ten.changes.map(one => [one.id, one.status]),
    Array.from({ length: 10 }, (_, k) => [`c${k + 1}`, 'pending']),
  )
  const two = commands.propose(dir, input(2, { id: 'two', fewerReason: '  Only two patterns  ' }))
  assert.equal(two.fewerReason, 'Only two patterns')
  const none = commands.propose(dir, input(0, { id: 'none', fewerReason: 'A quiet week' }))
  assert.equal(none.status, 'decided')
  // A reason is for a short week only.
  const full = commands.propose(dir, input(3, { id: 'full', fewerReason: 'not needed' }))
  assert.equal(full.fewerReason, undefined)
  assert.equal(readData(dir, 'proposals').proposals.length, 4)
})

test('checkProposal names the change that is malformed', () => {
  const bad = (patch: object) =>
    input(3, { changes: [change('a'), change('b'), { ...change('c'), ...patch }] })
  assert.match(checkProposal(bad({ file: '../x.md' })) ?? '', /Change 3 needs file/)
  assert.match(checkProposal(bad({ title: ' ' })) ?? '', /Change 3 needs a title/)
  assert.match(checkProposal(bad({ text: '' })) ?? '', /Change 3 needs the text/)
  assert.equal(checkProposal(input(3)), null)
  assert.match(checkProposal(bad({ text: 'x'.repeat(1201) })) ?? '', /text is 1201 characters/)
  assert.match(checkProposal(bad({ title: 'x'.repeat(121) })) ?? '', /title is 121/)
  assert.match(checkProposal(bad({ rationale: 'x'.repeat(301) })) ?? '', /rationale is 301/)
  const made = newProposal(
    {
      ...input(3),
      changes: [{ ...change('x'), rationale: undefined as never }, change('y'), change('z')],
    },
    'p',
    'now',
  )
  assert.equal(made.changes[0]?.rationale, '')
})

test('approving one change appends only its text; rejecting writes nothing', () => {
  const dir = fresh()
  const proposal = commands.propose(dir, {
    ...input(3, { id: 'p' }),
    changes: [change('First'), change('Second', 'preferences.md'), change('Third')],
  })
  const first = commands.decide(dir, proposal.id, 'c2', 'approve')
  assert.deepEqual(first.decided, [{ id: 'c2', status: 'approved' }])
  assert.equal(first.status, 'pending')
  assert.equal(profile(dir, 'learnings.md'), '')
  assert.match(
    profile(dir, 'preferences.md'),
    /## Second \(approved \d{4}-\d\d-\d\d\)\n\nRule: Second\.\n$/,
  )

  const rejected = commands.decide(dir, proposal.id, '1', 'reject')
  assert.deepEqual(rejected.decided, [{ id: 'c1', status: 'rejected' }])
  assert.equal(profile(dir, 'learnings.md'), '')
  const stored = readData(dir, 'proposals').proposals[0]
  assert.equal(stored?.changes[0]?.status, 'rejected')
  assert.ok(stored?.changes[0]?.decidedAt)
  assert.equal(stored?.decidedAt, undefined)
})

test('mixed decisions, then all remaining; the proposal is decided once none is pending', () => {
  const dir = fresh()
  commands.propose(dir, input(5, { id: 'mix' }))
  commands.decide(dir, 'mix', 'c1', 'approve')
  commands.decide(dir, 'mix', 'c2', 'reject')
  const rest = commands.decide(dir, 'mix', 'all', 'approve')
  assert.deepEqual(
    rest.decided.map(one => one.id),
    ['c3', 'c4', 'c5'],
  )
  assert.equal(rest.status, 'decided')
  assert.deepEqual(
    rest.changes.map(one => one.status),
    ['approved', 'rejected', 'approved', 'approved', 'approved'],
  )
  const learnings = profile(dir, 'learnings.md')
  for (const k of [1, 3, 4, 5]) assert.match(learnings, new RegExp(`Rule: Learning ${k}\\.`))
  assert.doesNotMatch(learnings, /Learning 2/)
  assert.ok(readData(dir, 'proposals').proposals[0]?.decidedAt)
  // Nothing left: all remaining decides nothing.
  assert.deepEqual(commands.decide(dir, 'mix', 'all', 'reject').decided, [])
})

test('a repeated decision appends nothing twice; the opposite one is refused', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'twice' }))
  commands.decide(dir, 'twice', 'c1', 'approve')
  const again = commands.decide(dir, 'twice', 'c1', 'approve')
  assert.deepEqual(again.decided, [])
  assert.equal(profile(dir, 'learnings.md').match(/Rule: Learning 1\./g)?.length, 1)
  assert.throws(
    () => commands.decide(dir, 'twice', 'c1', 'reject'),
    /Change c1 of twice is already approved/,
  )
  assert.throws(() => commands.decide(dir, 'twice', 'c9', 'approve'), /has no change c9/)
  assert.throws(() => commands.decide(dir, 'nope', 'c1', 'approve'), /No proposal nope/)
  assert.throws(() => commands.decide(dir, 'twice', 'c2', 'maybe'), /approve or reject/)
  // A rerun of the review cannot replace a proposal the person has started deciding.
  assert.throws(
    () => commands.propose(dir, input(3, { id: 'twice' })),
    /already has decided changes/,
  )
})

test('the older decide <id> approve|reject decides every pending change', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'old-form' }))
  assert.equal(commands.decide(dir, 'old-form', 'reject').status, 'decided')
  assert.equal(profile(dir, 'learnings.md'), '')
})

test('a proposal saved before per-change decisions reads with its status on every change', () => {
  const approved = normalizeProposal(legacy('approved'))
  assert.equal(approved.status, 'decided')
  assert.deepEqual(
    approved.changes.map(one => [one.id, one.status, one.decidedAt]),
    [
      ['c1', 'approved', '2026-10-26T09:00:00.000Z'],
      ['c2', 'approved', '2026-10-26T09:00:00.000Z'],
    ],
  )
  assert.deepEqual(
    normalizeProposal(legacy('rejected')).changes.map(one => one.status),
    ['rejected', 'rejected'],
  )
  const pending = normalizeProposal(legacy('pending'))
  assert.equal(pending.status, 'pending')
  assert.equal(pending.changes[0]?.decidedAt, undefined)
  // Normalizing twice changes nothing.
  assert.deepEqual(normalizeProposal(approved), approved)
})

test('a legacy pending proposal can be decided change by change', () => {
  const file: ProposalsFile = {
    version: 1,
    proposals: [legacy('approved'), legacy('pending')] as never,
  }
  const result = decideChanges(file, 'old-pending', 'c2', 'approve', '2026-10-28T00:00:00.000Z')
  assert.deepEqual(
    result.decided.map(one => one.title),
    ['Old two'],
  )
  assert.equal(result.proposal.status, 'pending')
  // The other proposal is left as it was stored.
  assert.equal(result.file.proposals[0]?.status, 'approved')
})

test('the CLI decides one change of a legacy proposals.json and keeps the rest readable', () => {
  const dir = fresh()
  writeFileSync(
    join(dir, 'proposals.json'),
    JSON.stringify({ version: 1, proposals: [legacy('approved'), legacy('pending')] }),
  )
  const script = join(import.meta.dirname, '..', 'bin', 'jobs.ts')
  const run = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [script, ...args, '--data', dir], { encoding: 'utf8' }),
    )
  assert.deepEqual(run('decide', 'old-pending', '1', 'reject').decided, [
    { id: 'c1', status: 'rejected' },
  ])
  assert.deepEqual(run('decide', 'old-pending', 'c2', 'approve').decided, [
    { id: 'c2', status: 'approved' },
  ])
  assert.match(profile(dir, 'preferences.md'), /Rule: Old two\./)
  assert.equal(profile(dir, 'learnings.md'), '')
  const [old, decided] = readData(dir, 'proposals').proposals
  assert.equal(old?.status, 'approved')
  assert.equal(decided?.status, 'decided')
})

test('ids go by place when a hand-edited file has one missing or repeated', () => {
  const ids = (changes: object[]) =>
    normalizeProposal({ ...legacy('pending'), changes } as never).changes.map(one => one.id)
  assert.deepEqual(
    ids([
      { ...change('a'), id: '' },
      { ...change('b'), id: 'c1' },
    ]),
    ['c1', 'c2'],
  )
  assert.deepEqual(ids([{ ...change('a'), id: 'c2' }, change('b')]), ['c1', 'c2'])
  assert.deepEqual(
    ids([
      { ...change('a'), id: 'x' },
      { ...change('b'), id: 'x' },
    ]),
    ['c1', 'c2'],
  )
  assert.deepEqual(
    ids([
      { ...change('a'), id: 'b7' },
      { ...change('b'), id: 'c1' },
    ]),
    ['b7', 'c1'],
  )
})

test('a clarification keeps the change pending, keeps the words and writes no profile file', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'p' }))
  const change = commands.clarify(dir, { proposal: 'p', change: '2', text: '  Only startups.\n' })
  assert.equal(change.status, 'pending')
  assert.equal(change.text, 'Rule: Learning 2.')
  const [stored] = readData(dir, 'proposals').proposals
  assert.equal(stored?.status, 'pending')
  const words = stored?.changes[1]?.clarifications
  assert.equal(words?.length, 1)
  assert.equal(words?.[0]?.text, 'Only startups.')
  assert.equal(words?.[0]?.was, 'Rule: Learning 2.')
  assert.equal(words?.[0]?.revisedAt, undefined)
  assert.equal(profile(dir, 'learnings.md'), '')
  assert.equal(profile(dir, 'preferences.md'), '')
})

test('clarify refuses what it cannot keep; the same words again change nothing', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'p' }))
  const clarify = (text: unknown, change = 'c1') =>
    commands.clarify(dir, { proposal: 'p', change, text: text as string })
  assert.throws(() => clarify('   '), /needs some text/)
  assert.throws(() => clarify(undefined), /needs some text/)
  assert.throws(
    () => clarify('x'.repeat(CLARIFICATION_LIMIT + 1)),
    /1001 characters; keep it under 1000/,
  )
  assert.throws(() => clarify('hm', 'c9'), /has no change c9/)
  assert.throws(
    () => commands.clarify(dir, { proposal: 'nope', change: 'c1', text: 'hm' }),
    /No proposal nope/,
  )
  commands.decide(dir, 'p', 'c2', 'reject')
  assert.throws(() => clarify('hm', 'c2'), /Change c2 of p is already rejected/)
  clarify('Narrower')
  clarify('Narrower')
  assert.equal(readData(dir, 'proposals').proposals[0]?.changes[0]?.clarifications?.length, 1)
  assert.throws(() => clarify('Other words'), /Change c1 of p is waiting for its revision/)
})

test('revise replaces the text, answers the clarification and leaves the change pending', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'p' }))
  commands.clarify(dir, { proposal: 'p', change: 'c1', text: 'Only startups.' })
  const revised = commands.revise(dir, { proposal: 'p', change: '1', text: 'Rule: startups only.' })
  assert.equal(revised.status, 'pending')
  assert.equal(revised.text, 'Rule: startups only.')
  assert.equal(revised.title, 'Learning 1')
  assert.equal(revised.rationale, 'Seen 3 times: Learning 1')
  assert.equal(revised.file, 'learnings.md')
  assert.ok(revised.clarifications?.[0]?.revisedAt)
  assert.equal(revised.clarifications?.[0]?.was, 'Rule: Learning 1.')
  assert.equal(profile(dir, 'learnings.md'), '')
  // Back for review: it can be clarified again, and only approving it writes the file.
  commands.clarify(dir, { proposal: 'p', change: 'c1', text: 'And remote.' })
  const again = commands.revise(dir, {
    proposal: 'p',
    change: 'c1',
    text: 'Rule: remote startups only.',
    title: '  Remote startups  ',
    rationale: 'You said so',
    file: 'preferences.md',
  })
  assert.equal(again.title, 'Remote startups')
  assert.equal(again.rationale, 'You said so')
  assert.equal(again.file, 'preferences.md')
  assert.deepEqual(
    again.clarifications?.map(one => [one.text, one.was]),
    [
      ['Only startups.', 'Rule: Learning 1.'],
      ['And remote.', 'Rule: startups only.'],
    ],
  )
  commands.decide(dir, 'p', 'c1', 'approve')
  assert.match(profile(dir, 'preferences.md'), /## Remote startups \(approved .*\n\nRule: remote/)
  assert.equal(profile(dir, 'learnings.md'), '')
})

test('revise refuses a change with nothing to answer, a decided one and a malformed one', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'p' }))
  const revise = (change: string, patch: object = {}) =>
    commands.revise(dir, { proposal: 'p', change, text: 'New.', ...patch })
  assert.throws(() => revise('c1'), /Change c1 of p has no clarification to answer/)
  commands.clarify(dir, { proposal: 'p', change: 'c1', text: 'Hm' })
  assert.throws(() => revise('c1', { text: ' ' }), /Change c1 needs the text/)
  assert.throws(() => revise('c1', { text: 'x'.repeat(1201) }), /text is 1201 characters/)
  assert.throws(() => revise('c1', { file: 'notes.md' }), /needs file/)
  // A refused revision leaves the change waiting.
  assert.ok(openClarification(readData(dir, 'proposals').proposals[0]?.changes[0] as never))
  commands.decide(dir, 'p', 'c1', 'reject')
  assert.throws(() => revise('c1'), /Change c1 of p is already rejected/)
})

test('a change waiting for its revision cannot be approved; it can be rejected', () => {
  const dir = fresh()
  commands.propose(dir, input(4, { id: 'p' }))
  commands.clarify(dir, { proposal: 'p', change: 'c1', text: 'Hm' })
  commands.clarify(dir, { proposal: 'p', change: 'c2', text: 'Hm' })
  assert.throws(
    () => commands.decide(dir, 'p', 'c1', 'approve'),
    /Change c1 of p is waiting for its revision/,
  )
  const rest = commands.decide(dir, 'p', 'all', 'approve')
  assert.deepEqual(
    rest.decided.map(one => one.id),
    ['c3', 'c4'],
  )
  assert.equal(rest.status, 'pending')
  assert.doesNotMatch(profile(dir, 'learnings.md'), /Learning 1|Learning 2/)
  assert.deepEqual(commands.decide(dir, 'p', 'c1', 'reject').decided, [
    { id: 'c1', status: 'rejected' },
  ])
  assert.equal(commands.decide(dir, 'p', 'all', 'reject').status, 'decided')
  assert.equal(isApprovable({ status: 'pending' }), true)
  assert.equal(isApprovable({ status: 'approved' }), false)
})

test('a rerun of the review never replaces a proposal the person clarified', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'same-day' }))
  commands.clarify(dir, { proposal: 'same-day', change: 'c1', text: 'Hm' })
  assert.throws(
    () => commands.propose(dir, input(3, { id: 'same-day' })),
    /already has clarified changes/,
  )
  // A clarification answered long ago counts too: the words are what is kept.
  commands.revise(dir, { proposal: 'same-day', change: 'c1', text: 'New.' })
  assert.throws(
    () => commands.propose(dir, input(3, { id: 'same-day' })),
    /already has clarified changes/,
  )
})

test('a clarification survives the proposal being decided, for later runs to read', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'kept' }))
  commands.clarify(dir, { proposal: 'kept', change: 'c1', text: 'Not this.' })
  commands.decide(dir, 'kept', 'all', 'reject')
  const stored = readData(dir, 'proposals').proposals[0]
  assert.equal(stored?.status, 'decided')
  assert.equal(stored?.changes[0]?.clarifications?.[0]?.text, 'Not this.')
  assert.equal(normalizeProposal(stored as never).changes[0]?.clarifications?.length, 1)
})

test('a legacy proposal takes a clarification and leaves the others as they were stored', () => {
  const file = { version: 1, proposals: [legacy('approved'), legacy('pending')] } as ProposalsFile
  const input = { proposal: 'old-pending', change: 'c2', text: 'Narrower' }
  const clarified = clarifyChange(file, input, '2026-10-28T00:00:00.000Z')
  assert.equal(clarified.file.proposals[0]?.status, 'approved')
  assert.equal(clarified.change.id, 'c2')
  const revised = reviseChange(
    clarified.file,
    { proposal: 'old-pending', change: 'c2', text: 'New' },
    '2026-10-29T00:00:00.000Z',
  )
  assert.equal(revised.change.clarifications?.[0]?.revisedAt, '2026-10-29T00:00:00.000Z')
})

test('the revision task names the change and sends the subagent to the skill section', () => {
  const task = reviseTask('proposal-2026-11-02', { id: 'c3', title: 'Senior roles' })
  assert.match(task, /revise change c3 of proposal proposal-2026-11-02 \("Senior roles"\)/)
  assert.match(task, /"Revise a clarified change" section/)
  assert.match(task, /nobody can answer a question here/)
  const relay = reviseRelay('Senior roles', task)
  assert.match(relay, /run_in_background: true/)
  assert.ok(relay.endsWith(`PROMPT: ${task}`))
  assert.equal(clarifyKey('p', 'c1'), 'p:c1')
})

test('the CLI clarifies and revises from a JSON argument, whatever the words start with', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'p' }))
  const script = join(import.meta.dirname, '..', 'bin', 'jobs.ts')
  const run = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [script, ...args, '--data', dir], { encoding: 'utf8' }),
    )
  const text = '--not this, "senior"\nroles'
  const change = run('clarify', JSON.stringify({ proposal: 'p', change: 'c1', text }))
  assert.equal(change.clarifications[0].text, text)
  const revision = JSON.stringify({ proposal: 'p', change: 'c1', text: 'New.' })
  assert.equal(run('revise', revision).text, 'New.')
})

test('an approval whose append landed but whose save failed is not appended again', () => {
  const dir = fresh()
  commands.propose(dir, input(3, { id: 'retry' }))
  // As if an earlier try appended c1 on another day, then failed to save proposals.json.
  mkdirSync(join(dir, 'profile'), { recursive: true })
  writeFileSync(
    join(dir, 'profile', 'learnings.md'),
    '# Learnings\n\n## Learning 1 (approved 2026-10-01)\n\nRule: Learning 1.\n',
  )
  commands.decide(dir, 'retry', 'all', 'approve')
  const learnings = profile(dir, 'learnings.md')
  assert.equal(learnings.match(/Rule: Learning 1\./g)?.length, 1)
  assert.match(learnings, /Rule: Learning 2\./)
  const other = '## Learning 1 (approved 2026-10-01)\n\nOther.\n'
  assert.equal(hasApproved(other, change('Learning 1')), false)
})
