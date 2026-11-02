import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { reviseChange } from '../hooks/lib/model.ts'
import type { StoredProposal } from '../hooks/lib/model.ts'
import { DATA, NOW, PANE_PROPS, world } from './world.ts'

const start = ($: Engine) => $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

const pane = {
  plugin: 'job-tracker',
  component: 'Pane' as const,
  requestId: 'jobs',
  props: PANE_PROPS,
}

const words = (count: number) => Array.from({ length: count }, (_, k) => `word${k}`).join(' ')

/** A proposal as the learn skill saves it: every change pending, ids c1, c2, ... */
function proposal(id: string, count: number, createdAt = '2026-10-27T01:00:00.000Z') {
  return {
    id,
    createdAt,
    status: 'pending' as const,
    summary: `Summary of ${id}. ${words(60)}`,
    funnel: '| Source | Found |\n|---|---|\n| web | 64 |\n| hn | 29 |',
    changes: Array.from({ length: count }, (_, k) => ({
      id: `c${k + 1}`,
      file: k % 3 === 2 ? ('preferences.md' as const) : ('learnings.md' as const),
      title: `Learning ${k + 1}`,
      rationale: `Seen ${k + 2} times in pass reasons`,
      text: `Rule ${k + 1}: ${words(70)}`,
      status: 'pending' as const,
    })),
  }
}

/** Every change of a proposal approved. */
const decided = (one: ReturnType<typeof proposal>) => ({
  ...one,
  status: 'decided' as const,
  changes: one.changes.map(change => ({
    ...change,
    status: 'approved' as const,
    decidedAt: '2026-10-19T00:00:00.000Z',
  })),
})

/** `proposal-2026-10-26` as it sits in proposals.json: approved, before per-change decisions. */
const LEGACY: StoredProposal = {
  id: 'proposal-2026-10-26',
  createdAt: '2026-10-26T01:10:51.531Z',
  status: 'approved',
  decidedAt: '2026-10-26T09:00:00.000Z',
  summary: 'First week on the board.',
  funnel: '| Source | Found |\n|---|---|\n| web | 64 |',
  changes: [
    { file: 'learnings.md', title: 'Unstated level', rationale: '3 passes', text: 'Do not dock.' },
    { file: 'learnings.md', title: 'Data platform', rationale: '2 passes', text: 'Score lower.' },
  ],
}

const decides = (runs: string[][]) =>
  runs.filter(argv => argv[2] === 'decide').map(argv => argv.slice(3, 6))

const FIELD = 'clarification:p:c1'
const WORDS = 'Only for roles at big companies; startups can ask for more.'

/** Clarify on c1, then the words typed into its field and sent. */
async function clarified($: Engine, text = WORDS) {
  await $.ui.press({ plugin: 'job-tracker', key: 'clarify:p:c1' })
  await $.ui.input({ plugin: 'job-tracker', key: FIELD, text })
}

/** Subagent a1's own turn ends. */
const subagentEnds = ($: Engine, answer: string, reason: 'answer' | 'error') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason })

const statuses = (w: ReturnType<typeof world>) => w.proposals()[0]?.changes.map(one => one.status)

describe('learning proposals', () => {
  test('each change has its own Approve and Reject; approving appends only its text', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    // The board counts the learnings left to review.
    expect(await ui.find({ key: 'proposals', text: /^Learning proposals \(3\)$/ })).toBeDefined()
    await ui.press({ key: 'proposals' })
    expect(await ui.find({ type: 'Text', text: /^2026-10-27 · 3 of 3 to review$/ })).toBeDefined()
    for (const id of ['c1', 'c2', 'c3']) {
      expect(await ui.find({ key: `approve:p:${id}`, text: /^Approve$/ })).toBeDefined()
      expect(await ui.find({ key: `reject:p:${id}`, text: /^Reject$/ })).toBeDefined()
    }
    expect(await ui.find({ key: 'approve:p:all', text: /^Approve all remaining$/ })).toBeDefined()
    expect(await ui.find({ key: 'reject:p:all', text: /^Reject all remaining$/ })).toBeDefined()

    await ui.press({ key: 'approve:p:c2' })
    expect(decides(w.runs)).toEqual([['p', 'c2', 'approve']])
    expect(w.profile('learnings.md')).toMatch(
      /^\n\n## Learning 2 \(approved 2026-10-20\)\n\nRule 2:/,
    )
    expect(w.profile('learnings.md')).not.toMatch(/Learning 1|Learning 3/)
    expect(w.profile('preferences.md')).toBe('')
    expect(await ui.find({ key: 'approve:p:c2' })).toBeUndefined()
    expect(await ui.find({ key: 'text:p:c2' })).toBeUndefined()
    expect(
      await ui.find({
        type: 'Text',
        text: /^✓ Approved 2026-10-20 · Learning 2 → learnings\.md$/,
      }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2026-10-27 · 2 of 3 to review$/ })).toBeDefined()

    await ui.press({ key: 'reject:p:c3' })
    expect(
      await ui.find({ type: 'Text', text: /^✗ Rejected 2026-10-20 · Learning 3$/ }),
    ).toBeDefined()
    expect(w.profile('preferences.md')).toBe('')
    // One change left: no "all remaining" pair for it.
    expect(await ui.find({ key: 'approve:p:all' })).toBeUndefined()
    await ui.press({ key: 'reject:p:c1' })
    expect(w.proposals()[0]?.status).toBe('decided')
    expect(w.proposals()[0]?.changes.map(one => one.status)).toEqual([
      'rejected',
      'approved',
      'rejected',
    ])
    expect(await ui.find({ type: 'Text', text: /^2026-10-27 · 1 of 3 approved$/ })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'proposals' })).toBeUndefined()
  })

  test('a double press on Approve appends the change once', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await Promise.all([ui.press({ key: 'approve:p:c1' }), ui.press({ key: 'approve:p:c1' })])
    // However the presses interleave, the change is approved and appended once.
    expect(decides(w.runs).length).toBeGreaterThanOrEqual(1)
    expect(w.profile('learnings.md').match(/## Learning 1 /g)).toHaveLength(1)
    expect(w.proposals()[0]?.changes.map(one => one.status)).toEqual([
      'approved',
      'pending',
      'pending',
    ])
    expect(toasts).toEqual([])
  })

  test('Approve all remaining and Reject all remaining decide only pending changes', async ($, on) => {
    const w = world(on, {
      proposals: [proposal('p', 4), proposal('q', 3, '2026-10-20T00:00:00.000Z')],
    })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ key: 'proposals', text: /\(7\)$/ })).toBeDefined()
    await ui.press({ key: 'proposals' })
    await ui.press({ key: 'reject:p:c1' })
    await ui.press({ key: 'approve:p:all' })
    expect(decides(w.runs)).toEqual([
      ['p', 'c1', 'reject'],
      ['p', 'all', 'approve'],
    ])
    const statuses = (id: string) =>
      w
        .proposals()
        .find(one => one.id === id)
        ?.changes.map(one => one.status)
    expect(statuses('p')).toEqual(['rejected', 'approved', 'approved', 'approved'])
    expect(w.profile('learnings.md')).not.toMatch(/Learning 1 /)
    expect(w.profile('learnings.md')).toMatch(/Learning 2 [\s\S]*Learning 4 /)
    expect(w.profile('preferences.md')).toMatch(/Learning 3 /)
    // The other proposal waits until it is decided too.
    expect(statuses('q')).toEqual(['pending', 'pending', 'pending'])
    const before = w.profile('learnings.md')
    await ui.press({ key: 'reject:q:all' })
    expect(w.profile('learnings.md')).toBe(before)
    expect(w.proposals().find(one => one.id === 'q')?.status).toBe('decided')
  })

  test('Clarify opens a field on that change only, and a second press closes it', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    for (const id of ['c1', 'c2', 'c3']) {
      expect(await ui.find({ key: `clarify:p:${id}`, text: /^Clarify$/ })).toBeDefined()
    }
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    await ui.press({ key: 'clarify:p:c1' })
    expect(await ui.find({ key: FIELD })).toBeDefined()
    expect(await ui.find({ key: 'clarification:p:c2' })).toBeUndefined()
    await ui.press({ key: 'clarify:p:c2' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await ui.find({ key: 'clarification:p:c2' })).toBeDefined()
    await ui.press({ key: 'clarify:p:c2' })
    expect(await ui.find({ key: 'clarification:p:c2' })).toBeUndefined()
    // Leaving the page closes it too.
    await ui.press({ key: 'clarify:p:c1' })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'proposals' })
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(w.runs.filter(argv => argv[2] === 'clarify')).toEqual([])
  })

  test('a clarification keeps the change open, writes no profile file and starts a revision', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    const before = w.proposals()[0]?.changes[0]?.text
    await clarified($)
    const change = w.proposals()[0]?.changes[0]
    expect(change?.status).toBe('pending')
    expect(change?.text).toBe(before)
    expect(change?.clarifications).toEqual([
      { at: new Date(NOW).toISOString(), text: WORDS, was: before },
    ])
    expect(w.proposals()[0]?.status).toBe('pending')
    expect(w.profile('learnings.md')).toBe('')
    expect(w.profile('preferences.md')).toBe('')
    // The field closed and the words show on the change; only Reject stays while it is revised.
    expect(await ui.find({ key: FIELD })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Your clarification: Only for/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude is revising this/ })).toBeDefined()
    expect(await ui.find({ key: 'approve:p:c1' })).toBeUndefined()
    expect(await ui.find({ key: 'clarify:p:c1' })).toBeUndefined()
    expect(await ui.find({ key: 'revise:p:c1' })).toBeUndefined()
    expect(await ui.find({ key: 'reject:p:c1' })).toBeDefined()
    // The other changes carry on as they were.
    expect(await ui.find({ key: 'approve:p:c2' })).toBeDefined()
    expect(w.spawns).toHaveLength(1)
    expect(w.spawns[0]?.prompt).toMatch(/revise change c1 of proposal p \("Learning 1"\)/)
    expect(w.spawns[0]?.prompt).toMatch(/"Revise a clarified change" section/)
  })

  test('words that start with a dash or hold a newline reach the CLI as one JSON argument', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    const text = '--no, keep "senior"\nroles'
    await clarified($, text)
    expect(w.proposals()[0]?.changes[0]?.clarifications?.[0]?.text).toBe(text)
    expect(w.spawns).toHaveLength(1)
    const [argv] = w.runs.filter(one => one[2] === 'clarify')
    expect(argv?.[3]).toBe(JSON.stringify({ proposal: 'p', change: 'c1', text }))
  })

  test('the revision comes back for review, and only approving it writes the file', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await clarified($)
    const task = w.spawns[0]?.prompt ?? ''
    await $.turn.start({ agentId: 'a1', text: task, turnId: 't1' })
    // The subagent saves its revision through the CLI.
    const path = `${DATA}/proposals.json`
    const stored = JSON.parse(w.files.get(path) ?? '{}')
    const input = { proposal: 'p', change: 'c1', text: 'Rule 1, for big companies only.' }
    w.files.set(path, JSON.stringify(reviseChange(stored, input, '2026-10-20T13:00:00.000Z').file))
    await subagentEnds($, 'Narrowed it.', 'answer')
    expect(toasts.at(-1)).toMatch(/"Learning 1" is revised and back for review/)
    expect(
      await ui.find({ key: 'text:p:c1', text: /Rule 1, for big companies only\./ }),
    ).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /^Revised from your clarification: Only for/ }),
    ).toBeDefined()
    expect(w.profile('learnings.md')).toBe('')
    await ui.press({ key: 'approve:p:c1' })
    expect(w.profile('learnings.md')).toMatch(/Rule 1, for big companies only\./)
    expect(w.proposals()[0]?.changes[0]?.clarifications?.[0]).toEqual({
      at: new Date(NOW).toISOString(),
      text: WORDS,
      was: expect.stringMatching(/^Rule 1: word0/),
      revisedAt: '2026-10-20T13:00:00.000Z',
    })
  })

  test('a revision that stopped offers Revise now, and a press starts it again', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await clarified($)
    await $.turn.start({ agentId: 'a1', text: w.spawns[0]?.prompt ?? '', turnId: 't1' })
    await subagentEnds($, '', 'error')
    expect(toasts.at(-1)).toMatch(/"Learning 1" was not revised \(error\); Revise now/)
    expect(await ui.find({ type: 'Text', text: /Waiting to be revised/ })).toBeDefined()
    await ui.press({ key: 'revise:p:c1' })
    expect(w.spawns).toHaveLength(2)
    expect(await ui.find({ key: 'revise:p:c1' })).toBeUndefined()
  })

  test('a change rejected while it is revised gets no word from the run', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await clarified($)
    await $.turn.start({ agentId: 'a1', text: w.spawns[0]?.prompt ?? '', turnId: 't1' })
    await ui.press({ key: 'reject:p:c1' })
    const before = toasts.length
    await subagentEnds($, 'It was already rejected.', 'answer')
    expect(toasts).toHaveLength(before)
    expect(statuses(w)?.[0]).toBe('rejected')
  })

  test('where a spawn is refused the conversation is asked to revise it', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    const sent: string[] = []
    on('prompt.submit', (_, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
    w.refuseSpawns('no agents here')
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await clarified($)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/^Revise the learning "Learning 1" in a background subagent/)
    expect(sent[0]).toMatch(/PROMPT: Use the job-tracker:learn skill to revise change c1/)
    expect(w.proposals()[0]?.changes[0]?.clarifications).toHaveLength(1)
  })

  test('a blank clarification saves nothing and leaves the field open', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await clarified($, '   ')
    expect(toasts).toEqual(['job-tracker: A clarification needs some text'])
    expect(await ui.find({ key: FIELD })).toBeDefined()
    expect(w.proposals()[0]?.changes[0]?.clarifications).toBeUndefined()
    expect(w.spawns).toEqual([])
  })

  test('Approve all remaining leaves a change waiting for its revision open', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await clarified($)
    await ui.press({ key: 'approve:p:all' })
    expect(statuses(w)).toEqual(['pending', 'approved', 'approved'])
    expect(w.profile('learnings.md')).not.toMatch(/Learning 1 /)
    expect(w.proposals()[0]?.status).toBe('pending')
  })

  test('only a waiting change left: no Approve all, and Reject still ends it', async ($, on) => {
    const w = world(on, { proposals: [proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    await clarified($)
    await ui.press({ key: 'clarify:p:c2' })
    await $.ui.input({ plugin: 'job-tracker', key: 'clarification:p:c2', text: 'Narrower.' })
    await ui.press({ key: 'reject:p:c3' })
    expect(await ui.find({ key: 'approve:p:all' })).toBeUndefined()
    expect(await ui.find({ key: 'reject:p:all' })).toBeDefined()
    await ui.press({ key: 'reject:p:all' })
    expect(statuses(w)).toEqual(['rejected', 'rejected', 'rejected'])
    expect(w.profile('learnings.md')).toBe('')
    expect(w.proposals()[0]?.changes[0]?.clarifications?.[0]?.text).toBe(WORDS)
  })

  test('mobile shows a clarification but no field or Clarify', async ($, on) => {
    const seeded = proposal('p', 3)
    const first = seeded.changes[0]
    const clarifications = [{ at: '2026-10-20T00:00:00.000Z', text: WORDS, was: 'Old' }]
    world(on, {
      proposals: [
        { ...seeded, changes: [{ ...first, clarifications }, ...seeded.changes.slice(1)] },
      ],
    } as never)
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'mobile' })
    await ui.press({ key: 'proposals' })
    expect(await ui.find({ type: 'Text', text: /Your clarification/ })).toBeDefined()
    expect(await ui.find({ key: 'clarify:p:c1' })).toBeUndefined()
    expect(await ui.find({ key: 'revise:p:c1' })).toBeUndefined()
  })

  test('a proposal saved before per-change decisions shows each change approved', async ($, on) => {
    const w = world(on, { proposals: [LEGACY, proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    // Only the new proposal's learnings count.
    expect(await ui.find({ key: 'proposals', text: /\(3\)$/ })).toBeDefined()
    await ui.press({ key: 'proposals' })
    const old = 'proposal-2026-10-26'
    expect(await ui.find({ type: 'Text', text: /^2026-10-26 · 2 of 2 approved$/ })).toBeDefined()
    expect(
      await ui.find({
        type: 'Text',
        text: /^✓ Approved 2026-10-26 · Unstated level → learnings\.md$/,
      }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Data platform/ })).toBeDefined()
    expect(await ui.find({ key: `approve:${old}:c1` })).toBeUndefined()
    // Deciding the new one leaves the old entry as it was stored.
    await ui.press({ key: 'approve:p:c1' })
    expect(w.proposals()[0]).toEqual(LEGACY)
  })

  test('mobile shows the changes and outcomes without buttons', async ($, on) => {
    world(on, { proposals: [proposal('p', 3)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'mobile' })
    await ui.press({ key: 'proposals' })
    expect(await ui.find({ key: 'text:p:c1' })).toBeDefined()
    expect(await ui.find({ key: 'approve:p:c1' })).toBeUndefined()
    expect(await ui.find({ key: 'approve:p:all' })).toBeUndefined()
  })

  test('a week with no changes shows its summary and reason', async ($, on) => {
    const w = world(on, {
      proposals: [
        {
          ...proposal('quiet', 0),
          status: 'decided',
          summary: 'A quiet week.',
          fewerReason: 'Only one pass reason repeated.',
        },
      ],
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.panes', () => ({
      value: [{ id: 'jobs', title: 'Jobs', isShown: true, isFocused: false, isPlaced: true }],
    }))
    await start($)
    const board = await $.ui.mount({ ...pane, surface: 'desktop' })
    // Nothing to decide: no button on the board.
    expect(await board.find({ key: 'proposals' })).toBeUndefined()
    await board.unmount()
    const ran = $.tool.call({ tool: 'mcp__job-tracker__open_board', view: 'proposals' })
    await w.clock.advance(2000)
    await ran
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(
      await ui.find({ type: 'Text', text: /^2026-10-27 · no changes proposed$/ }),
    ).toBeDefined()
    expect(
      await ui.find({ key: 'summary:quiet', text: /A quiet week\.[\s\S]*Only one pass reason/ }),
    ).toBeDefined()
  })

  test('one proposal of ten long changes is a small tree', async ($, on) => {
    world(on, { proposals: [proposal('p', 10)] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    expect(await ui.find({ key: 'approve:p:c10' })).toBeDefined()
    const size = JSON.stringify((await ui.findAll({}))[0]).length
    // Measured about 18,000.
    expect(size).toBeLessThan(25_000)
  })

  test('a page of changes each with a longest clarification stays under the cap', async ($, on) => {
    const clarifications = [
      { at: '2026-10-20T00:00:00.000Z', text: 'x'.repeat(1000), was: 'y'.repeat(1200) },
    ]
    const heavy = (id: string) => {
      const one = proposal(id, 10)
      return { ...one, changes: one.changes.map(change => ({ ...change, clarifications })) }
    }
    world(on, { proposals: [heavy('a'), heavy('b')] } as never)
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'proposals' })
    expect(await ui.find({ key: 'revise:b:c10' })).toBeDefined()
    const size = JSON.stringify((await ui.findAll({}))[0]).length
    // The pane refuses a tree over 100,000 characters: the words are clipped, `was` never drawn.
    expect(size).toBeLessThan(70_000)
  })

  test('a full page of ten-change proposals stays well under the pane tree cap', async ($, on) => {
    // Four weeks waiting (two more than draw in full) and four decided ones, with change texts
    // far longer than the learn skill writes.
    const proposals = [
      ...Array.from({ length: 4 }, (_, k) => proposal(`w${k}`, 10, `2026-10-2${k}T00:00:00.000Z`)),
      ...Array.from({ length: 4 }, (_, k) =>
        decided(proposal(`d${k}`, 10, `2026-10-1${k}T00:00:00.000Z`)),
      ),
    ]
    world(on, { proposals })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ key: 'proposals', text: /\(40\)$/ })).toBeDefined()
    await ui.press({ key: 'proposals' })
    expect(await ui.find({ key: 'approve:w3:c10' })).toBeDefined()
    expect(await ui.find({ key: 'approve:w2:c10' })).toBeDefined()
    expect(await ui.find({ key: 'approve:w1:c1' })).toBeUndefined()
    expect(
      await ui.find({
        type: 'Text',
        text: /^2 older proposals wait: they show once one above is decided.$/,
      }),
    ).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /^✓ Approved 2026-10-19 · Learning 10/ }),
    ).toBeDefined()
    expect(await ui.find({ key: 'text:d3:c1' })).toBeUndefined()
    const size = JSON.stringify((await ui.findAll({}))[0]).length
    // The pane refuses a tree over 100,000 characters; this page measured about 43,000.
    expect(size).toBeLessThan(50_000)
  })
})
