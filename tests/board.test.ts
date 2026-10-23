import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Lead } from '../hooks/lib/model.ts'
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
    test(`a New card is two rows and a tagline; Draft package builds it in a background subagent (${surface})`, async ($, on) => {
      const w = world(on, {
        leads: [
          lead('acme-api', {
            company: 'Acme',
            location: 'Remote (Canada)',
            tagline: 'Billing APIs for dental clinics across Canada',
          }),
          lead('beta-api', { company: 'Beta', fitScore: 70 }),
        ],
      })
      const toasts: string[] = []
      on('ui.toast', (_, e) => {
        toasts.push(e.text)
        return { value: undefined }
      })
      const prompts: string[] = []
      on('prompt.submit', (_, e) => {
        prompts.push(e.text)
        return { text: e.text }
      })
      on('turn.start', (_, e) => ({ turnId: e.turnId }))
      on('turn.complete', (_, e) => ({ text: e.answer }))
      await start($)
      const ui = await $.ui.mount({ ...pane, surface })
      expect(await ui.find({ key: 'tab:new', text: /New 2/ })).toBeDefined()
      expect(await ui.find({ key: 'tab:shortlisted' })).toBeUndefined()
      expect(await ui.find({ text: /1h · Ashby board · Remote \(Canada\)/ })).toBeDefined()
      // The tagline is one line of at most 40 characters, clipped with an ellipsis.
      const tagline = await ui.find({ type: 'Text', text: /^Billing APIs/ })
      expect(tagline?.text).toBe('Billing APIs for dental clinics across…')
      expect(tagline?.props.wrap).toBe('truncate-end')
      // Until scout writes one, the card falls back to the fit reason.
      expect(await ui.find({ type: 'Text', text: /^Backend APIs in Victoria$/ })).toBeDefined()
      expect(await ui.find({ key: 'draft:acme-api', text: /^Draft package$/ })).toBeDefined()
      expect(await ui.find({ key: 'pass:acme-api', text: /^Pass$/ })).toBeDefined()
      expect(await ui.find({ key: 'shortlist:acme-api' })).toBeUndefined()

      // Two drafts start side by side, neither in the conversation.
      await ui.press({ key: 'draft:acme-api' })
      await ui.press({ key: 'draft:beta-api' })
      expect(w.leads().map(one => one.column)).toEqual(['drafting', 'drafting'])
      expect(w.spawns).toHaveLength(2)
      expect(w.spawns[0]?.prompt).toContain('job-tracker:package skill')
      expect(w.spawns[0]?.prompt).toContain('lead acme-api (Acme — Backend Developer)')
      expect(w.spawns[0]?.prompt).not.toContain('--redraft')
      expect(prompts).toEqual([])
      expect(toasts).toEqual([
        'Drafting the Acme package in the background.',
        'Drafting the Beta package in the background.',
      ])
      expect(await ui.find({ key: 'tab:drafting', text: /Drafting 2/ })).toBeDefined()
      expect(await ui.find({ text: /Package being drafted/ })).toBeDefined()

      // A second press while it builds starts nothing.
      await ui.press({ key: 'open:acme-api' })
      await ui.press({ key: 'redraft' })
      expect(w.spawns).toHaveLength(2)
      expect(toasts.at(-1)).toBe('The Acme package is already being drafted.')

      // Its end is the subagent's own turn: a toast says how it went.
      for (const [n, spawn] of w.spawns.entries()) {
        await $.turn.start({ text: spawn.prompt, turnId: `a-${n + 1}`, agentId: `agent-${n + 1}` })
      }
      await $.turn.complete({
        answer: 'Package ready: résumé, cover letter and answers.\nReview it in /jobs.',
        durationMs: 1,
        isAborted: false,
        turnId: 'a-1',
        agentId: 'agent-1',
        reason: 'answer',
      })
      expect(toasts.at(-1)).toBe('Acme package: Package ready: résumé, cover letter and answers.')
      await $.turn.complete({
        answer: '',
        durationMs: 1,
        isAborted: true,
        turnId: 'a-2',
        agentId: 'agent-2',
        reason: 'aborted',
      })
      expect(toasts.at(-1)).toBe(
        'The Beta package build stopped (aborted); Draft package starts it again.',
      )
      // An agent this pane did not start is not reported.
      await $.turn.complete({
        answer: 'Other work.',
        durationMs: 1,
        isAborted: false,
        turnId: 'a-3',
        agentId: 'agent-9',
        reason: 'answer',
      })
      expect(toasts).toHaveLength(5)
      // Once it ended, it can be drafted again.
      await ui.press({ key: 'redraft' })
      expect(w.spawns).toHaveLength(3)
      expect(w.feedback().map(event => [event.kind, event.to])).toEqual([
        ['move', 'drafting'],
        ['move', 'drafting'],
      ])
      await ui.unmount()
    })
  }

  test('a lead stored in the removed Shortlisted column shows in New', async ($, on) => {
    const legacy = 'shortlisted' as Lead['column']
    world(on, {
      leads: [
        lead('acme-api', {
          company: 'Acme',
          column: legacy,
          history: [{ at: '2026-10-19T12:00:00.000Z', by: 'user', action: 'moved', to: legacy }],
        }),
      ],
    })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ key: 'tab:new', text: /New 1/ })).toBeDefined()
    await ui.press({ key: 'open:acme-api' })
    expect(await ui.find({ text: /user: moved → shortlisted/ })).toBeDefined()
    expect(await ui.find({ text: /tracker: moved → New \(shortlisted was removed/ })).toBeDefined()
  })

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

  test('scores age until applied: the badge and order use the aged score, the lead says why', async ($, on) => {
    world(on, {
      leads: [
        lead('old-1', { company: 'Old', fitScore: 86, postedAt: '2026-10-18T12:00:00.000Z' }),
        lead('fresh-2', { company: 'Fresh', fitScore: 80 }),
        lead('sent-3', {
          company: 'Sent',
          fitScore: 86,
          column: 'applied',
          foundAt: '2026-09-01T12:00:00.000Z',
        }),
      ],
    })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    const chip = async (score: number) =>
      ui.find({ type: 'Text', text: new RegExp(`^ ${score} $`) })
    expect(await chip(80)).toBeDefined()
    expect(await chip(66)).toBeDefined()
    expect(await chip(86)).toBeUndefined()
    const order = (await ui.findAll({ type: 'Text', text: /^ \d+ $/ })).map(one => one.text)
    expect(order).toEqual([' 80 ', ' 66 '])
    await ui.press({ key: 'open:old-1' })
    expect(await ui.find({ type: 'Text', text: 'Fit 86 → 66, posted 2d ago' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'tab:applied' })
    expect(await chip(86)).toBeDefined()
    await ui.press({ key: 'open:sent-3' })
    expect(await ui.find({ type: 'Text', text: /^Fit / })).toBeUndefined()
  })

  test('a New lead posted over a week ago is archived when the board loads', async ($, on) => {
    const w = world(on, {
      leads: [
        lead('stale-1', { company: 'Stale', postedAt: '2026-10-12T12:00:00.000Z' }),
        lead('kept-2', {
          company: 'Kept',
          column: 'drafting',
          postedAt: '2026-10-01T12:00:00.000Z',
        }),
        lead('fresh-3', { company: 'Fresh' }),
      ],
    })
    await start($)
    expect(w.runs.filter(argv => argv[2] === 'archive')).toHaveLength(1)
    expect(w.leads().map(one => [one.id, one.column])).toEqual([
      ['stale-1', 'archived'],
      ['kept-2', 'drafting'],
      ['fresh-3', 'new'],
    ])
    expect(w.leads()[0]?.history.at(-1)?.by).toBe('tracker')
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.find({ key: 'open:stale-1' })).toBeUndefined()
    expect(await ui.find({ key: 'open:fresh-3' })).toBeDefined()
    // Moved back to New by hand, it stays there through later refreshes.
    await ui.press({ key: 'closed' })
    await ui.press({ key: 'tab:archived' })
    await ui.press({ key: 'back-new:stale-1' })
    await ui.press({ key: 'refresh' })
    expect(w.leads()[0]?.column).toBe('new')
    expect(w.runs.filter(argv => argv[2] === 'archive')).toHaveLength(1)
  })

  test('a board with nothing stale runs no archive', async ($, on) => {
    const w = world(on, { leads: [lead('fresh-1')] })
    await start($)
    expect(w.runs.filter(argv => argv[2] === 'archive')).toHaveLength(0)
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

  test('a Ready card offers Review and Approve and submit; approving asks in chat, redrafting builds aside', async ($, on) => {
    const w = world(on, {
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
    expect(await ui.find({ key: 'review:acme-api', text: /^Review$/ })).toBeDefined()
    expect(await ui.find({ key: 'submit:acme-api', text: /^Approve and submit$/ })).toBeDefined()
    expect(
      (await ui.findAll({ type: 'Button' })).filter(one => /:acme-api$/.test(String(one.key))),
    ).toHaveLength(3)
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'submit' })
    expect(prompts[0]?.text).toContain('job-tracker:submit')
    expect(prompts[0]?.text).toContain('ask me in one message for anything it is missing')
    expect(prompts[0]?.text).toContain('stop before the final submit')
    expect(prompts[0]?.origin).toEqual(expect.objectContaining({ kind: 'plugin', asUser: true }))
    await ui.press({ key: 'redraft' })
    expect(prompts).toHaveLength(1)
    expect(w.spawns[0]?.prompt).toContain('register it with --redraft')
    expect(w.leads()[0]?.column).toBe('drafting')
  })

  test('where no subagent can start, Draft asks the conversation to start one, queued until its turn', async ($, on) => {
    const w = world(on, { leads: [lead('acme-api', { company: 'Acme' })] })
    w.refuseSpawns('background tasks are disabled')
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    const refusals: string[] = []
    const prompts: string[] = []
    on('prompt.submit', (_, e) => {
      prompts.push(e.text)
      return refusals[0] ? { drop: refusals[0] } : { text: e.text }
    })
    const done = (turnId: string) =>
      $.turn.complete({
        answer: 'Done.',
        durationMs: 1,
        isAborted: false,
        turnId,
        reason: 'answer',
      })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'open:acme-api' })

    // A plugin's prompt waits for the running reply: the press says so instead of doing nothing.
    await $.turn.start({ text: 'what is new on my board?', turnId: 't1' })
    await ui.press({ key: 'draft' })
    expect(w.leads()[0]?.column).toBe('drafting')
    expect(w.spawns).toEqual([])
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('in a background subagent, not in this thread')
    expect(prompts[0]).toContain('run_in_background: true')
    expect(prompts[0]).toContain('job-tracker:package skill')
    expect(toasts).toEqual(['Drafting the Acme package once Claude finishes the current reply.'])
    const queued = { type: 'Text', text: /^Drafting the Acme package: queued…$/ } as const
    expect(await ui.find(queued)).toBeDefined()
    await ui.press({ key: 'redraft' })
    expect(prompts).toHaveLength(1)
    expect(toasts.at(-1)).toBe('Drafting the Acme package is already queued.')

    await done('t1')
    expect(await ui.find(queued)).toBeDefined()
    await $.turn.start({ text: prompts[0] ?? '', turnId: 't2' })
    expect(await ui.find(queued)).toBeUndefined()
    await done('t2')

    // A prompt a hook refused is reported, not silently lost.
    refusals.push('a hook refused it')
    await ui.press({ key: 'redraft' })
    expect(toasts.slice(-2)).toEqual([
      'Drafting the Acme package in the conversation.',
      'job-tracker: the prompt was not sent: a hook refused it',
    ])
    expect(await ui.find(queued)).toBeUndefined()

    // A prompt whose turn is never seen stops blocking the button after half an hour.
    refusals.length = 0
    await ui.press({ key: 'redraft' })
    await ui.press({ key: 'redraft' })
    expect(prompts).toHaveLength(3)
    await w.clock.advance(31 * 60_000)
    await ui.press({ key: 'redraft' })
    expect(prompts).toHaveLength(4)
  })

  test('mobile reads every stage but takes no action', async ($, on) => {
    world(on, { leads: [lead('acme-api'), lead('beta-api', { column: 'applied' })] })
    await start($)
    const ui = await $.ui.mount({ ...pane, surface: 'mobile' })
    expect(await ui.find({ key: 'tab:new' })).toBeDefined()
    expect(await ui.find({ key: 'draft:acme-api' })).toBeUndefined()
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
