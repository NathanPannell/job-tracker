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
    await ui.press({ key: 'details:acme-api' })
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
    await ui.press({ key: 'details:acme-api' })
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
})

describe('tools', () => {
  test('list_leads, update_lead and record_feedback read and change the board', async ($, on) => {
    const w = world(on, { leads: [lead('acme-api'), lead('beta-api', { fitScore: 95 })] })
    await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
    const listed = await $.tool.call({ tool: 'mcp__job-tracker__list_leads', input: {} } as never)
    expect(String((listed as { result?: unknown }).result)).toContain('beta-api')

    await $.tool.call({
      tool: 'mcp__job-tracker__update_lead',
      input: { id: 'acme-api', column: 'shortlisted', notes: 'Ask about the team' },
    } as never)
    expect(w.leads()[0]?.column).toBe('shortlisted')
    expect(w.leads()[0]?.notes).toBe('Ask about the team')

    await $.tool.call({
      tool: 'mcp__job-tracker__record_feedback',
      input: { leadId: 'beta-api', kind: 'outcome', reason: 'Rejection email' },
    } as never)
    expect(w.feedback().at(-1)).toEqual(
      expect.objectContaining({ kind: 'outcome', leadId: 'beta-api' }),
    )

    const bad = await $.tool.call({
      tool: 'mcp__job-tracker__update_lead',
      input: { id: 'acme-api', column: 'nowhere' },
    } as never)
    expect(String((bad as { result?: unknown }).result)).toContain('unknown column')
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
