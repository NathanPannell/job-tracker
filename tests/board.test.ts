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
    test(`a card is shortlisted and sent back with labelled buttons, each move recorded (${surface})`, async ($, on) => {
      const w = world(on, { leads: [lead('acme-api', { company: 'Acme' })] })
      await start($)
      const ui = await $.ui.mount({ ...pane, surface })
      expect(await ui.find({ key: 'tab:new', text: /New 1/ })).toBeDefined()

      await ui.press({ key: 'shortlist:acme-api' })
      expect(w.leads()[0]?.column).toBe('shortlisted')
      expect(await ui.find({ key: 'tab:shortlisted', text: /Shortlisted 1/ })).toBeDefined()

      await ui.press({ key: 'tab:shortlisted' })
      expect(await ui.find({ key: 'draft:acme-api', text: /Draft package/ })).toBeDefined()
      await ui.press({ key: 'back-new:acme-api' })
      expect(w.leads()[0]?.column).toBe('new')
      expect(w.feedback().map(event => event.kind)).toEqual(['move', 'move'])
      expect(w.leads()[0]?.history.map(entry => entry.to)).toEqual(['shortlisted', 'new'])
      await ui.unmount()
    })
  }

  for (const surface of ACTING) {
    test(`tabs show one stage at a time and open on New (${surface})`, async ($, on) => {
      world(on, {
        leads: [
          lead('a-1', { company: 'Alpha', fitScore: 95 }),
          lead('b-2', { company: 'Beta', fitScore: 80, column: 'applied' }),
        ],
      })
      await start($)
      const ui = await $.ui.mount({ ...pane, surface })
      expect(await ui.find({ key: 'card:a-1' })).toBeDefined()
      expect(await ui.find({ key: 'card:b-2' })).toBeUndefined()
      expect(await ui.find({ key: 'tab:drafting', text: /Drafting 0/ })).toBeDefined()
      await ui.press({ key: 'tab:applied' })
      expect(await ui.find({ key: 'card:b-2' })).toBeDefined()
      expect(await ui.find({ key: 'card:a-1' })).toBeUndefined()
      expect(await ui.find({ key: 'interview:b-2', text: /Got interview/ })).toBeDefined()
      await ui.press({ key: 'tab:drafting' })
      expect(await ui.find({ text: /Nothing in Drafting yet/ })).toBeDefined()
      await ui.unmount()
    })
  }

  for (const surface of ACTING) {
    test(`passing asks for a reason chip and records it as feedback (${surface})`, async ($, on) => {
      const w = world(on, { leads: [lead('acme-api', { company: 'Acme', fitScore: 88 })] })
      await start($)
      const ui = await $.ui.mount({ ...pane, surface })
      await ui.press({ key: 'open:acme-api' })
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

  test('a rejection is an outcome, not a pass, and can be undone in place', async ($, on) => {
    const w = world(on, { leads: [lead('acme-api', { company: 'Acme', column: 'applied' })] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'tab:applied' })
    await ui.press({ key: 'rejected:acme-api' })
    expect(w.leads()[0]?.column).toBe('archived')
    expect(w.leads()[0]?.passReason).toBeUndefined()
    expect(w.feedback().map(event => [event.kind, event.reason])).toEqual([
      ['move', undefined],
      ['outcome', 'rejection: marked on the board'],
    ])
    await ui.press({ key: 'closed' })
    await ui.press({ key: 'tab:archived' })
    expect(await ui.find({ key: 'restore:acme-api', text: /Back to Applied/ })).toBeDefined()
    await ui.press({ key: 'restore:acme-api' })
    expect(w.leads()[0]?.column).toBe('applied')
  })

  test('a Ready lead without a package offers to draft one', async ($, on) => {
    world(on, { leads: [lead('acme-api', { column: 'ready' })] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ key: 'draft:acme-api', text: /Draft package/ })).toBeDefined()
    expect(await ui.find({ key: 'review:acme-api' })).toBeUndefined()
  })

  test('New shows ten cards, best first, and Show more adds ten', async ($, on) => {
    const leads = Array.from({ length: 23 }, (_, n) =>
      lead(`l-${n}`, { company: `Co ${n}`, fitScore: 50 + n }),
    )
    world(on, { leads })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ key: 'card:l-22' })).toBeDefined()
    expect(await ui.find({ key: 'card:l-12' })).toBeUndefined()
    expect(await ui.find({ key: 'more', text: /Show 10 more \(13 left\)/ })).toBeDefined()
    await ui.press({ key: 'more' })
    expect(await ui.find({ key: 'card:l-3' })).toBeDefined()
    expect(await ui.find({ key: 'more', text: /Show 3 more/ })).toBeDefined()
  })

  test('the fit score is a coloured badge and the source reads as words', async ($, on) => {
    world(on, {
      leads: [
        lead('a-1', { fitScore: 93, source: 'careers:SSI' }),
        lead('b-2', { fitScore: 80, source: 'gmail:linkedin' }),
        lead('c-3', { fitScore: 61, source: 'web' }),
      ],
    })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    const chip = async (score: number) =>
      (await ui.find({ type: 'Text', text: new RegExp(`^ ${score} $`) }))?.props.backgroundColor
    expect(await chip(93)).toBe('success')
    expect(await chip(80)).toBe('warning')
    expect(await chip(61)).toBe('subtle')
    expect(await ui.find({ text: /SSI careers/ })).toBeDefined()
    expect(await ui.find({ text: /LinkedIn alert/ })).toBeDefined()
  })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    test(`the lead view shows the company and role summary; the card keeps the one-liner (${surface})`, async ($, on) => {
      world(on, {
        leads: [
          lead('acme-api', {
            company: 'Acme',
            fitReason: 'Backend APIs in Victoria',
            companyBlurb: 'Builds billing software for dental clinics; Series A, ~40 people.',
            roleHighlights: ['Owns the claims API end to end', 'Equity on top of CAD 110k'],
          }),
        ],
      })
      await start($)
      const ui = await $.ui.mount({ ...pane, surface })
      expect(await ui.find({ text: /Backend APIs in Victoria/ })).toBeDefined()
      expect(await ui.find({ text: /dental clinics/ })).toBeUndefined()
      expect(await ui.find({ text: /claims API/ })).toBeUndefined()

      await ui.press({ key: 'open:acme-api' })
      const summary = await ui.find({ key: 'summary', type: 'Markdown' })
      expect(summary?.props.text).toBe(
        [
          '**Company:** Builds billing software for dental clinics; Series A, ~40 people.',
          '**The role:**\n- Owns the claims API end to end\n- Equity on top of CAD 110k',
        ].join('\n\n'),
      )
      expect(await ui.find({ text: /Why this score:\*\* Backend APIs in Victoria/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('a lead without a summary opens with only the score rationale', async ($, on) => {
    world(on, { leads: [lead('acme-api', { company: 'Acme', roleHighlights: [' '] })] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'open:acme-api' })
    expect(await ui.find({ key: 'summary' })).toBeUndefined()
    expect(await ui.find({ text: /Why this score/ })).toBeDefined()
    await ui.unmount()
  })

  test('score corrections and snoozes are feedback events', async ($, on) => {
    const w = world(on, { leads: [lead('acme-api'), lead('beta-api')] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'too-high' })
    await ui.select({ key: 'snooze', value: '7' })
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
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'submit' })
    expect(prompts[0]?.text).toContain('job-tracker:submit')
    expect(prompts[0]?.text).toContain('stop before the final submit')
    expect(prompts[0]?.origin).toEqual(expect.objectContaining({ kind: 'plugin', asUser: true }))
    await ui.press({ key: 'redraft' })
    expect(prompts[1]?.text).toContain('job-tracker:package')
  })

  test('mobile reads every stage but takes no action', async ($, on) => {
    world(on, { leads: [lead('acme-api'), lead('beta-api', { column: 'applied' })] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'mobile' })
    expect(await ui.find({ key: 'tab:new' })).toBeDefined()
    expect(await ui.find({ key: 'shortlist:acme-api' })).toBeUndefined()
    expect(await ui.find({ key: 'refresh' })).toBeUndefined()
    await ui.press({ key: 'tab:applied' })
    expect(await ui.find({ key: 'card:beta-api' })).toBeDefined()
    await ui.press({ key: 'open:beta-api' }).catch(() => undefined)
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
