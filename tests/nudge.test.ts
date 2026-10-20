import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { DATA, lead, NOW, world } from './world.ts'

const HOUR = 3_600_000

function bottoms(on: On) {
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return contexts
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'sdk' as const } })

describe('nudge', () => {
  test('the first prompt names the top new leads once, and the reply marks exactly those', async ($, on) => {
    const w = world(on, {
      leads: [
        lead('alpha-backend', { company: 'Alpha', fitScore: 91 }),
        lead('beta-api', { company: 'Beta', fitScore: 84 }),
        lead('gamma-data', { company: 'Gamma', fitScore: 77 }),
        lead('delta-ml', { company: 'Delta', fitScore: 70 }),
        lead('old-one', { company: 'Old', fitScore: 99, column: 'applied' }),
      ],
    })
    const contexts = bottoms(on)
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

    await $.prompt.submit(typed('How do I reverse a list in Python?'))
    const note = contexts[0]?.join('\n') ?? ''
    expect(note).toContain('Alpha')
    expect(note).toContain('Beta')
    expect(note).toContain('Gamma')
    expect(note).not.toContain('Delta')
    expect(note).not.toContain('Old')
    expect(note).toContain('/jobs')
    expect(note).toContain("Answer the user's actual request first")

    await $.turn.complete({
      answer: 'Use reversed(xs).\n\nNew leads: Alpha, Beta, Gamma — see /jobs.',
      durationMs: 10,
      isAborted: false,
      turnId: 't1',
      reason: 'answer',
    })
    const marked = w
      .leads()
      .filter(one => one.mentionedAt)
      .map(one => one.id)
    expect(marked.sort()).toEqual(['alpha-backend', 'beta-api', 'gamma-data'])

    await $.prompt.submit(typed('And how do I sort it?'))
    expect(contexts[1]).toBeUndefined()
  })

  test('nothing is attached when a lead was mentioned in the last three hours', async ($, on) => {
    const recent = new Date(NOW - 2 * HOUR).toISOString()
    world(on, {
      leads: [
        lead('alpha-backend', { fitScore: 91 }),
        lead('seen-before', { fitScore: 60, mentionedAt: recent }),
      ],
    })
    const contexts = bottoms(on)
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    await $.prompt.submit(typed('hello'))
    expect(contexts[0]).toBeUndefined()
  })

  test('scheduled runs, plugin prompts, commands and job prompts get no nudge', async ($, on) => {
    world(on, { leads: [lead('alpha-backend', { fitScore: 91 })] })
    const contexts = bottoms(on)
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    await $.prompt.submit({
      text: 'Run the scout',
      wait: false,
      origin: { kind: 'scheduled-trigger' },
    })
    await $.prompt.submit({
      text: 'from a plugin',
      wait: false,
      origin: { kind: 'plugin', name: 'x' },
    })
    expect(contexts).toEqual([undefined, undefined])
    await $.prompt.submit(typed('Use the job-tracker:scout skill now'))
    expect(contexts[2]).toBeUndefined()
    // the first person prompt was the job prompt, so the session is done nudging
    await $.prompt.submit(typed('unrelated question'))
    expect(contexts[3]).toBeUndefined()
  })

  test('a prompt typed during another turn is marked by its own reply, not that turn', async ($, on) => {
    const w = world(on, { leads: [lead('alpha-backend', { company: 'Alpha', fitScore: 91 })] })
    bottoms(on)
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    await $.prompt.submit({ ...typed('quick question'), turnId: 'running' })
    await $.turn.complete({
      answer: 'Package drafted. Review it in /jobs.',
      durationMs: 1,
      isAborted: false,
      turnId: 'running',
      reason: 'answer',
    })
    expect(w.leads()[0]?.mentionedAt).toBeUndefined()
    await $.turn.complete({
      answer: 'Answer. New lead: Alpha — see /jobs.',
      durationMs: 1,
      isAborted: false,
      turnId: 'mine',
      reason: 'answer',
    })
    expect(w.leads()[0]?.mentionedAt).toBeDefined()
  })

  test('an interrupted reply marks nothing', async ($, on) => {
    const w = world(on, { leads: [lead('alpha-backend', { company: 'Alpha', fitScore: 91 })] })
    bottoms(on)
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    await $.prompt.submit(typed('hi'))
    await $.turn.complete({
      answer: '',
      durationMs: 1,
      isAborted: true,
      turnId: 't',
      reason: 'aborted',
    })
    expect(w.leads()[0]?.mentionedAt).toBeUndefined()
    expect(w.runs.some(run => run.includes('mention'))).toBe(false)
    expect(DATA).toBe('/data')
  })
})
