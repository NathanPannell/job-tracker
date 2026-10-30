import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Lead } from '../hooks/lib/model.ts'
import { DATA, lead, PANE_PROPS, world } from './world.ts'

const pane = {
  plugin: 'job-tracker',
  component: 'Pane' as const,
  requestId: 'jobs',
  props: PANE_PROPS,
}

const start = ($: Engine) => $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>

const SAVED = `${DATA}/profile/knowledge-base/application-answers.md`
const answers = (id: string) => `${DATA}/packages/${id}/answers.md`

const ready = (id: string, company: string, fields: Partial<Lead> = {}) =>
  lead(id, { company, column: 'ready', ...fields })

const application = (leadId: string) => ({
  leadId,
  dir: `packages/${leadId}`,
  createdAt: '',
  updatedAt: '',
  files: { answers: 'answers.md' },
  status: 'ready' as const,
})

const saved = (question: string, scope: string) =>
  `## ${question}\n\n- Answer: yes\n- Date: 2026-10-24\n- Scope: ${scope}\n\n`

const two =
  'NEEDS ANSWER: What is your salary expectation?\n\n- NEEDS ANSWER: When can you start?\n'

/** Every readiness note drawn, in order. */
async function notes(ui: Pick<Mounted, 'findAll'>) {
  const drawn = await ui.findAll({
    type: 'Text',
    text: /^(?:\d+ answers? needed|Ready to submit)$/,
  })
  return drawn.map(one => one.text)
}

describe('ready notes', () => {
  test('a Ready card says what its package still needs, or that it can go', async ($, on) => {
    world(
      on,
      {
        leads: [
          ready('acme-api', 'Acme', { fitScore: 90 }),
          ready('beta-api', 'Beta', { fitScore: 85 }),
          ready('gamma-api', 'Gamma', { fitScore: 80 }),
        ],
        applications: [application('acme-api'), application('beta-api')],
      },
      {
        [answers('acme-api')]: two,
        [answers('beta-api')]: 'No question on this form is left as NEEDS ANSWER.\n',
      },
    )
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })

    // Gamma has no package: it offers Draft package and no note.
    expect(await notes(ui)).toEqual(['2 answers needed', 'Ready to submit'])
    expect(await ui.find({ key: 'draft:gamma-api', text: /^Draft package$/ })).toBeDefined()
    const open = await ui.find({ type: 'Text', text: /^2 answers needed$/ })
    expect(open?.props.color).toBe('warning')
    const clear = await ui.find({ type: 'Text', text: /^Ready to submit$/ })
    expect(clear?.props.color).toBe('success')
  })

  test('a package whose answers file cannot be read gets no note', async ($, on) => {
    world(on, { leads: [ready('acme-api', 'Acme')], applications: [application('acme-api')] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ key: 'submit:acme-api' })).toBeDefined()
    expect(await notes(ui)).toEqual([])
  })

  test('only Ready cards carry it', async ($, on) => {
    world(
      on,
      {
        leads: [lead('acme-api', { company: 'Acme', column: 'applied' })],
        applications: [application('acme-api')],
      },
      { [answers('acme-api')]: two },
    )
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'tab:applied' })
    expect(await ui.find({ key: 'interview:acme-api' })).toBeDefined()
    expect(await notes(ui)).toEqual([])
  })

  test('a saved answer clears the question on the next refresh, answers.md as drafted', async ($, on) => {
    const w = world(
      on,
      { leads: [ready('acme-api', 'Acme')], applications: [application('acme-api')] },
      { [answers('acme-api')]: two },
    )
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await notes(ui)).toEqual(['2 answers needed'])

    const first = saved('What is your salary expectation?', 'any application')
    w.files.set(SAVED, first)
    await ui.press({ key: 'refresh' })
    expect(await notes(ui)).toEqual(['1 answer needed'])

    w.files.set(SAVED, `${first}${saved('When can you start?', 'Acme only')}`)
    await ui.press({ key: 'refresh' })
    expect(await notes(ui)).toEqual(['Ready to submit'])
    expect(w.files.get(answers('acme-api'))).toBe(two)
  })

  test('an answer scoped to another company does not clear it', async ($, on) => {
    world(
      on,
      { leads: [ready('acme-api', 'Acme')], applications: [application('acme-api')] },
      {
        [answers('acme-api')]: 'NEEDS ANSWER: Who referred you?\n',
        [SAVED]: saved('Who referred you?', 'Beta only'),
      },
    )
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await notes(ui)).toEqual(['1 answer needed'])
  })

  test('the lead page names the questions, on every surface', async ($, on) => {
    world(
      on,
      { leads: [ready('acme-api', 'Acme')], applications: [application('acme-api')] },
      { [answers('acme-api')]: two },
    )
    await start($)
    for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...pane, surface })
      await ui.press({ key: 'open:acme-api' })
      expect(await notes(ui)).toEqual(['2 answers needed'])
      expect(
        await ui.find({ type: 'Text', text: /^1\. What is your salary expectation\?$/ }),
      ).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^2\. When can you start\?$/ })).toBeDefined()
      // The page outlives the mount: the next surface starts from the board.
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  })

  test('a lead page with nothing open says so and lists nothing', async ($, on) => {
    world(
      on,
      { leads: [ready('acme-api', 'Acme')], applications: [application('acme-api')] },
      { [answers('acme-api')]: '1. **Why Acme?** Their API.\n' },
    )
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'open:acme-api' })
    expect(await notes(ui)).toEqual(['Ready to submit'])
    expect(await ui.find({ type: 'Text', text: /^1\. / })).toBeUndefined()
  })

  test('a long list stays small: the page clips and caps what it draws', async ($, on) => {
    const long = Array.from(
      { length: 40 },
      (_, n) => `- NEEDS ANSWER: Question ${n} ${'word '.repeat(200)}?`,
    ).join('\n')
    world(
      on,
      { leads: [ready('acme-api', 'Acme')], applications: [application('acme-api')] },
      { [answers('acme-api')]: long },
    )
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await notes(ui)).toEqual(['40 answers needed'])
    await ui.press({ key: 'open:acme-api' })
    expect(await ui.find({ type: 'Text', text: /^12\. Question 11 / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^13\. / })).toBeUndefined()
    expect(
      await ui.find({ type: 'Text', text: /^28 more in the package's Answers$/ }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1\. Question 0 .{1,200}…$/ })).toBeDefined()
    // Twelve clipped questions, far longer than a real one.
    expect(JSON.stringify((await ui.findAll({}))[0]).length).toBeLessThan(10_000)
  })

  test('a full page of Ready cards stays well under the pane tree cap', async ($, on) => {
    const ids = Array.from({ length: 10 }, (_, n) => `lead-${n}`)
    world(
      on,
      { leads: ids.map(id => ready(id, id)), applications: ids.map(application) },
      Object.fromEntries(ids.map(id => [answers(id), two])),
    )
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await notes(ui)).toHaveLength(10)
    expect(JSON.stringify((await ui.findAll({}))[0]).length).toBeLessThan(25_000)
  })
})
