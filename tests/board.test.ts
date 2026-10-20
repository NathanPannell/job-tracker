import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DATA, lead, PANE_PROPS, world } from './world.ts'

const ACTING = ['terminal', 'desktop'] as const

const start = ($: Engine) => $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })

const pane = {
  plugin: 'job-tracker',
  component: 'Pane' as const,
  requestId: 'jobs',
  props: PANE_PROPS,
}

describe('kanban', () => {
  for (const surface of ACTING) {
    test(`a card moves right and left, and each move is recorded (${surface})`, async ($, on) => {
      const w = world(on, { leads: [lead('acme-api', { company: 'Acme' })] })
      await start($)
      const ui = await $.ui.mount({ ...pane, surface })
      expect(await ui.find({ key: 'col:new', text: /New \(1\)/ })).toBeDefined()

      await ui.press({ key: 'right:acme-api' })
      expect(w.leads()[0]?.column).toBe('shortlisted')
      expect(await ui.find({ key: 'col:shortlisted', text: /Shortlisted \(1\)/ })).toBeDefined()

      await ui.press({ key: 'left:acme-api' })
      expect(w.leads()[0]?.column).toBe('new')
      expect(w.feedback().map(event => event.kind)).toEqual(['move', 'move'])
      expect(w.leads()[0]?.history.map(entry => entry.to)).toEqual(['shortlisted', 'new'])
      await ui.unmount()
    })
  }

  for (const surface of ACTING) {
    test(`passing asks for a reason chip and records it as feedback (${surface})`, async ($, on) => {
      const w = world(on, { leads: [lead('acme-api', { company: 'Acme', fitScore: 88 })] })
      await start($)
      const ui = await $.ui.mount({ ...pane, surface })
      await ui.press({ key: 'details:acme-api' })
      await ui.press({ key: 'pass' })
      expect(await ui.find({ key: 'reason:Too senior' })).toBeDefined()
      await ui.press({ key: 'reason:Too senior' })
      expect(w.leads()[0]?.column).toBe('passed')
      expect(w.leads()[0]?.passReason).toBe('Too senior')
      expect(w.feedback()).toEqual([
        expect.objectContaining({
          kind: 'pass',
          reason: 'Too senior',
          leadId: 'acme-api',
          fitScore: 88,
          source: 'ashby',
        }),
      ])
      await ui.unmount()
    })
  }

  test('score corrections and snoozes are feedback events', async ($, on) => {
    const w = world(on, { leads: [lead('acme-api'), lead('beta-api')] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'details:acme-api' })
    await ui.press({ key: 'too-high' })
    await ui.press({ key: 'snooze-7' })
    expect(w.feedback().map(event => event.kind)).toEqual(['score-too-high', 'snooze'])
    expect(w.leads().find(one => one.id === 'acme-api')?.scoreCorrection).toBe('too-high')
    expect(w.leads().find(one => one.id === 'acme-api')?.snoozedUntil).toBeDefined()
  })

  test('draft and approve send prompts in the person’s name; the final submit stays in chat', async ($, on) => {
    world(on, {
      leads: [lead('acme-api', { company: 'Acme', column: 'ready' })],
      applications: [
        {
          leadId: 'acme-api',
          dir: 'packages/acme-api',
          createdAt: '',
          updatedAt: '',
          files: {},
          status: 'ready',
        },
      ],
    })
    const prompts: { text: string; origin: unknown }[] = []
    on('prompt.submit', (_, e) => {
      prompts.push({ text: e.text, origin: e.origin })
      return { text: e.text }
    })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'details:acme-api' })
    await ui.press({ key: 'submit' })
    expect(prompts[0]?.text).toContain('job-tracker:submit')
    expect(prompts[0]?.text).toContain('stop before the final submit')
    expect(prompts[0]?.origin).toEqual(expect.objectContaining({ kind: 'plugin', asUser: true }))
    await ui.press({ key: 'draft' })
    expect(prompts[1]?.text).toContain('job-tracker:package')
  })

  test('mobile draws the board without any action', async ($, on) => {
    world(on, { leads: [lead('acme-api')] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'mobile' })
    expect(await ui.find({ key: 'col:new' })).toBeDefined()
    expect(await ui.find({ key: 'right:acme-api' })).toBeUndefined()
    expect(await ui.find({ key: 'refresh' })).toBeUndefined()
    await ui.press({ key: 'details:acme-api' }).catch(() => undefined)
    expect(await ui.find({ key: 'too-high' })).toBeUndefined()
  })

  test('without a data folder the pane says how to set one', async ($, on) => {
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('tool.register', (_, e) => ({ value: { tool: e.name } }))
    on('env.get', () => ({ value: undefined }))
    on('clock.now', () => ({ value: 0 }))
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ type: 'Markdown', text: /JOB_TRACKER_DATA/ })).toBeDefined()
    expect(DATA).toBe('/data')
  })
})

describe('band', () => {
  test('counts new leads, packages to review and follow-ups due; hidden when all zero', async ($, on) => {
    world(on, {
      leads: [
        lead('a-1'),
        lead('b-2'),
        lead('c-3', { column: 'ready' }),
        lead('d-4', { column: 'applied', followUpAt: '2026-10-01T00:00:00.000Z' }),
        lead('e-5', { column: 'applied', followUpAt: '2026-12-01T00:00:00.000Z' }),
        lead('f-6', { snoozedUntil: '2026-12-01T00:00:00.000Z' }),
      ],
    })
    await start($)
    for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
      const band = await $.ui.mount({
        plugin: 'job-tracker',
        surface,
        component: 'AbovePrompt',
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: 10,
          bodyColumns: 100,
          scroll: { offset: 0, bodyRows: 10 },
          view: {},
        },
      })
      expect(
        await band.find({ text: /2 new leads · 1 ready to review · 1 follow-up due/ }),
      ).toBeDefined()
      await band.unmount()
    }
  })

  test('draws nothing of its own with nothing to say', async ($, on) => {
    world(on, { leads: [lead('a-1', { column: 'passed' })] })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
    await start($)
    const band = await $.ui.mount({
      plugin: 'job-tracker',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    expect(await band.find({ text: /new lead/ })).toBeUndefined()
    expect(await band.find({ key: 'engine' })).toBeDefined()
  })
})
