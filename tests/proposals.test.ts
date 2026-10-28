import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { StoredProposal } from '../hooks/lib/model.ts'
import { PANE_PROPS, world } from './world.ts'

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
