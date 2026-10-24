import { describe, expect, test } from 'claude-code/testing'

import { DATA, lead, PANE_PROPS, world } from './world.ts'

const STRIP =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
const pkgDir = `${DATA}/packages/acme-api`

const seed = {
  leads: [lead('acme-api', { company: 'Acme', column: 'ready' as const })],
  applications: [
    {
      leadId: 'acme-api',
      dir: 'packages/acme-api',
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
      status: 'ready' as const,
      files: {
        resumePdf: 'resume.pdf',
        resumeDiff: 'resume.diff',
        coverLetter: 'cover-letter.md',
        brief: 'company-brief.md',
        preview: ['preview/page-1-0.svg', 'preview/page-1-1.svg'],
      },
    },
  ],
}

const files = {
  [`${pkgDir}/preview/page-1-0.svg`]: STRIP,
  [`${pkgDir}/preview/page-1-1.svg`]: STRIP,
  [`${pkgDir}/resume.diff`]: '@@ -1,2 +1,2 @@\n-old line\n+new line\n same\n',
  [`${pkgDir}/cover-letter.md`]: '# Dear Acme\n\nHello.',
  [`${pkgDir}/company-brief.md`]: '## Acme\n\nMakes things.',
}

const pane = {
  plugin: 'job-tracker',
  component: 'Pane' as const,
  requestId: 'jobs',
  props: PANE_PROPS,
}

describe('package viewer', () => {
  test('desktop draws the résumé as SVG strips and the texts as Markdown', async ($, on) => {
    const w = world(on, seed, files)
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'review' })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
    expect(await ui.find({ key: 'open-pdf' })).toBeDefined()
    await ui.press({ key: 'open-pdf' })
    expect(w.runs.at(-1)?.[0]).toBe('explorer.exe')
    expect(w.runs.at(-1)?.[1]).toMatch(/resume\.pdf$/)

    await ui.press({ key: 'tab:diff' })
    expect(await ui.find({ type: 'Code', text: /new line/ })).toBeDefined()
    await ui.press({ key: 'tab:cover' })
    expect(await ui.find({ type: 'Markdown', text: /Dear Acme/ })).toBeDefined()
    expect(await ui.find({ key: 'tab:answers' })).toBeUndefined()
  })

  test('the terminal, which has no Svg, offers Open PDF instead', async ($, on) => {
    world(on, seed, files)
    await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'review' })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect(await ui.find({ key: 'open-pdf' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /draws in the desktop app/ })).toBeDefined()
  })

  test('mobile can read the package but not act on it', async ($, on) => {
    world(on, seed, files)
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...pane, surface: 'mobile' })
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'review' })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
    expect(await ui.find({ key: 'submit' })).toBeUndefined()
  })

  test('a preview past the pane tree bound draws the pages that fit, never a refused tree', async ($, on) => {
    const page = (size: number) =>
      `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(size)}--></svg>`
    world(on, seed, {
      ...files,
      [`${pkgDir}/preview/page-1-0.svg`]: page(50_000),
      [`${pkgDir}/preview/page-1-1.svg`]: page(50_000),
    })
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'review' })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
    expect(
      await ui.find({ type: 'Text', text: /The rest of the résumé is in the PDF/ }),
    ).toBeDefined()
    const tree = JSON.stringify((await ui.findAll({}))[0])
    expect(tree.length).toBeLessThan(100_000)
  })

  test('a preview no page of which fits says so and offers the PDF', async ($, on) => {
    world(on, seed, {
      ...files,
      [`${pkgDir}/preview/page-1-0.svg`]: `<svg>${'x'.repeat(95_000)}</svg>`,
    })
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    await ui.press({ key: 'open:acme-api' })
    await ui.press({ key: 'review' })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect(await ui.find({ key: 'open-pdf' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /too large to draw here/ })).toBeDefined()
  })
})

describe('tools', () => {
  test('list_leads, update_lead and record_feedback read and change the board', async ($, on) => {
    const w = world(on, { leads: [lead('acme-api'), lead('beta-api', { fitScore: 95 })] })
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const listed = await $.tool.call({ tool: 'mcp__job-tracker__list_leads', limit: 5 })
    expect(String((listed as { result?: unknown }).result)).toContain('beta-api')

    await $.tool.call({
      tool: 'mcp__job-tracker__update_lead',
      id: 'acme-api',
      column: 'drafting',
      notes: 'Ask about the team',
    })
    expect(w.leads()[0]?.column).toBe('drafting')
    expect(w.leads()[0]?.notes).toBe('Ask about the team')

    await $.tool.call({
      tool: 'mcp__job-tracker__update_lead',
      id: 'acme-api',
      companyBlurb: 'Builds billing APIs for clinics.',
      tagline: 'Billing APIs for clinics',
      roleHighlights: ['Owns the payments service', 'Fully remote in Canada'],
    })
    expect(w.leads()[0]?.companyBlurb).toBe('Builds billing APIs for clinics.')
    expect(w.leads()[0]?.tagline).toBe('Billing APIs for clinics')
    expect(w.leads()[0]?.roleHighlights).toEqual([
      'Owns the payments service',
      'Fully remote in Canada',
    ])

    await $.tool.call({
      tool: 'mcp__job-tracker__record_feedback',
      leadId: 'beta-api',
      kind: 'outcome',
      reason: 'Rejection email',
    })
    expect(w.feedback().at(-1)).toEqual(
      expect.objectContaining({ kind: 'outcome', leadId: 'beta-api' }),
    )

    const bad = await $.tool.call({
      tool: 'mcp__job-tracker__update_lead',
      id: 'acme-api',
      column: 'nowhere',
    })
    expect(String((bad as { result?: unknown }).result)).toContain('unknown column')
  })

  test('draft_package moves the card and builds it in a background subagent', async ($, on) => {
    const w = world(on, { leads: [lead('acme-api', { company: 'Acme' }), lead('beta-api')] })
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const call = async (args: Record<string, unknown>) =>
      String(
        (
          (await $.tool.call({ tool: 'mcp__job-tracker__draft_package', ...args })) as {
            result?: unknown
          }
        ).result,
      )
    const started = JSON.parse(await call({ leadId: 'acme-api' })) as Record<string, unknown>
    expect(started).toEqual({ ok: true, ran: 'subagent' })
    expect(w.leads()[0]?.column).toBe('drafting')
    expect(w.spawns[0]?.prompt).toContain('lead acme-api (Acme — Backend Developer)')
    expect(JSON.parse(await call({ leadId: 'acme-api' }))).toEqual({
      ok: true,
      ran: 'already-drafting',
    })
    expect(await call({})).toBe('Error: leadId is required')
    expect(await call({ leadId: 'nope' })).toBe('Error: no lead nope')
    // A tool call does not relay a refused spawn to the conversation: it says so.
    w.refuseSpawns('background tasks are disabled')
    expect(await call({ leadId: 'beta-api' })).toBe(
      'Error: The subagent did not start: background tasks are disabled',
    )
    expect(w.spawns).toHaveLength(1)
    // The card goes back where it was, and nothing blocks a later try.
    expect(w.leads()[1]?.column).toBe('new')
    expect(w.leads()[1]?.history.map(entry => entry.to)).toEqual(['drafting', 'new'])
    w.refuseSpawns(undefined)
    expect(JSON.parse(await call({ leadId: 'beta-api' }))).toEqual({ ok: true, ran: 'subagent' })
  })

  test('open_board opens the pane on a package and reports that it stayed open', async ($, on) => {
    const w = world(on, seed, files)
    const opened: string[] = []
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.panes', () => ({
      value: [{ id: 'jobs', title: 'Jobs', isShown: true, isFocused: false, isPlaced: true }],
    }))
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const ran = $.tool.call({
      tool: 'mcp__job-tracker__open_board',
      view: 'package',
      leadId: 'acme-api',
    })
    await w.clock.advance(2000)
    const result = String(((await ran) as { result?: unknown }).result)
    expect(opened).toEqual(['jobs'])
    expect(result).toContain('"stillOpen": true')
    const ui = await $.ui.mount({ ...pane, surface: 'desktop' })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
    const bad = await $.tool.call({ tool: 'mcp__job-tracker__open_board', view: 'lead' })
    expect(String((bad as { result?: unknown }).result)).toContain('needs leadId')
  })

  test('/jobs opens the pane on the board', async ($, on) => {
    world(on, { leads: [lead('acme-api')] })
    const opened: string[] = []
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const ran = await $.command.run({ command: 'jobs', args: '' } as never)
    expect(opened).toEqual(['jobs'])
    expect(ran.text).toContain('1 new lead')
  })
})
