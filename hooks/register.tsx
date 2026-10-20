// job-tracker: the /jobs kanban pane, the band above the prompt, a once-a-session mention of
// new leads, and the tools the model uses to read and change the board. The skills under
// skills/ do the work; this module draws it and records what the person does.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { JobPackage, JobView, PackageTab } from '../types/index.d.ts'
import { act, dataDir, EMPTY_BOARD, jobs, loadPackage, openFile, PANE, refresh } from './lib/io.ts'
import { bandText, counts, isColumn, leadsToMention, nudgeContext } from './lib/model.ts'
import type { Column, Lead } from './lib/model.ts'
import { boardView, leadView, packageView, PAGE, proposalsView } from './views.tsx'
import type { Actions, ViewContext } from './views.tsx'

// The session values the pane and band draw from (the contract is types/index.d.ts).
const board = atom({ plugin: 'job-tracker', key: 'board' } as const, EMPTY_BOARD)
const view = atom({ plugin: 'job-tracker', key: 'view' } as const, { kind: 'board' } as JobView)
const pkg = atom({ plugin: 'job-tracker', key: 'pkg' } as const, null as JobPackage | null)
const showClosed = atom({ plugin: 'job-tracker', key: 'showClosed' } as const, false)
const stage = atom({ plugin: 'job-tracker', key: 'stage' } as const, null as Column | null)
const shown = atom({ plugin: 'job-tracker', key: 'shown' } as const, PAGE)
const pending = atom({ plugin: 'job-tracker', key: 'pending' } as const, [] as string[])
const pendingTurn = atom(
  { plugin: 'job-tracker', key: 'pendingTurn' } as const,
  null as string | null,
)
const nudged = atom({ plugin: 'job-tracker', key: 'nudged' } as const, false)
const busy = atom({ plugin: 'job-tracker', key: 'busy' } as const, null as string | null)

// Matchers are written as literals: the engine reads them from the source before the module runs.

/** A person's own prompt: typed in the terminal or the desktop app, or sent from a phone. */
const isPersonOrigin = (origin: PromptOrigin) =>
  origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk'

/** Prompts that run the job search itself (a scheduled scout, a /jobs action) get no nudge. */
const isJobPrompt = (text: string) => /job-tracker|\/jobs\b/i.test(text)

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Jobs' })

async function show($: EngineInterface, next: JobView) {
  await update($, view, () => next)
  if (next.kind === 'package') await loadPackage($, next.id)
}

function submitPrompt($: EngineInterface, text: string) {
  void $.prompt.submit({ text, asUser: true }).catch((error: unknown) => {
    $.ui.toast(`job-tracker: could not send the prompt: ${String(error)}`)
  })
}

function actions($: EngineInterface): Actions {
  const move = (lead: Lead, to: Column) =>
    void act($, `Moving ${lead.company}`, ['move', lead.id, to])
  return {
    open: id => void show($, { kind: 'lead', id }),
    board: () => void show($, { kind: 'board' }),
    proposals: () => void show($, { kind: 'proposals' }),
    refresh: () => void refresh($),
    toggleClosed: () =>
      void update($, showClosed, value => !value)
        .then(() => update($, stage, () => null))
        .then(() => update($, shown, () => PAGE)),
    tab: column => void update($, stage, () => column).then(() => update($, shown, () => PAGE)),
    more: () => void update($, shown, count => count + PAGE),
    move,
    outcome: (lead, to, reason) =>
      void (async () => {
        // A second press before the redraw would record the outcome twice: only the first,
        // while the lead is still where the press saw it, counts.
        if (await read($, busy)) return
        const now = (await read($, board)).leads.find(one => one.id === lead.id)
        if (!now || now.column !== lead.column) return
        const moved = await act($, `Recording the outcome at ${lead.company}`, [
          'move',
          lead.id,
          to,
          '--note',
          reason,
        ])
        if (!moved.ok) return
        await act($, 'Recording the outcome', [
          'feedback',
          JSON.stringify({ leadId: lead.id, kind: 'outcome', reason }),
        ])
      })(),
    askPass: lead => void show($, { kind: 'lead', id: lead.id, passing: true }),
    pass: (lead, reason) =>
      void act($, `Passing on ${lead.company}`, ['pass', lead.id, reason]).then(() =>
        show($, { kind: 'lead', id: lead.id }),
      ),
    score: (lead, correction) =>
      void act($, 'Recording the correction', ['score', lead.id, correction]).then(result => {
        if (result.ok) $.ui.toast(`Noted: ${lead.company} scored ${correction.replace('-', ' ')}`)
      }),
    snooze: (lead, days) =>
      void act($, `Snoozing ${lead.company}`, ['snooze', lead.id, String(days)]).then(() =>
        show($, { kind: 'board' }),
      ),
    draft: lead =>
      submitPrompt(
        $,
        `Use the job-tracker:package skill to build the application package for lead ${lead.id} (${lead.company} — ${lead.role}).`,
      ),
    review: (lead, tab: PackageTab = 'resume') =>
      void show($, { kind: 'package', id: lead.id, tab }),
    submit: lead =>
      submitPrompt(
        $,
        `I approved the package for lead ${lead.id} (${lead.company} — ${lead.role}) on the job board. Use the job-tracker:submit skill: prefill the application and stop before the final submit so I can confirm here.`,
      ),
    openPdf: path => void openFile($, path),
    decide: (id, decision) =>
      void act($, decision === 'approve' ? 'Applying the proposal' : 'Rejecting the proposal', [
        'decide',
        id,
        decision,
      ]),
  }
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

/**
 * A tool call's own arguments: `tool.call` carries them flat on `e`, beside the keys the engine
 * reserves for itself.
 */
function toolArgs(e: object): Record<string, unknown> {
  const { tool, tool_use_id, consent, agentId, ...args } = e as Record<string, unknown>
  void [tool, tool_use_id, consent, agentId]
  return args
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jobs',
      description: 'Open the job board: scored leads, packages and learning proposals',
    })
    await $.tool.register({
      name: 'list_leads',
      description:
        "Lists job leads on the person's job board (job-tracker), best fit first. Filter by column (new, shortlisted, drafting, ready, applied, interviewing, offer, passed, archived) and minimum fit score.",
      inputSchema: {
        type: 'object',
        properties: {
          column: { type: 'string', description: 'Only leads in this column' },
          minScore: { type: 'number', description: 'Only leads with fitScore at least this' },
          limit: { type: 'number', description: 'At most this many (default 20)' },
        },
      },
    })
    await $.tool.register({
      name: 'update_lead',
      description:
        "Changes one lead on the person's job board: move it to a column, rescore it, add notes, set a follow-up or snooze date. Moving to passed needs passReason.",
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          column: { type: 'string' },
          fitScore: { type: 'number' },
          fitReason: { type: 'string' },
          notes: { type: 'string' },
          passReason: { type: 'string' },
          followUpAt: { type: 'string', description: 'ISO date' },
          snoozedUntil: { type: 'string', description: 'ISO date' },
        },
      },
    })
    await $.tool.register({
      name: 'record_feedback',
      description:
        "Records the person's feedback on a lead for the weekly learning run: pass, score-too-high, score-too-low, outcome (a reply, rejection, interview or offer) or package-edit, with a short reason.",
      inputSchema: {
        type: 'object',
        required: ['leadId', 'kind'],
        properties: {
          leadId: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['pass', 'score-too-high', 'score-too-low', 'outcome', 'package-edit'],
          },
          reason: { type: 'string' },
        },
      },
    })
    await $.tool.register({
      name: 'open_board',
      description:
        "Opens the person's job board (the /jobs pane) on the board, one lead, a lead's application package, or the learning proposals, and says whether the surface placed it.",
      inputSchema: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['board', 'lead', 'package', 'proposals'] },
          leadId: { type: 'string', description: 'The lead, for the lead and package views' },
        },
      },
    })
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'jobs' }, async $ => {
    await refresh($)
    await update($, view, () => ({ kind: 'board' }) as JobView)
    const opened = await openPane($)
    const c = counts({ version: 1, leads: (await read($, board)).leads }, await $.clock.now())
    return {
      text: opened.isPlaced
        ? `Opened the job board: ${bandText(c) ?? 'nothing new'}.`
        : `The job board is waiting for room to open (${opened.reason ?? 'not placed'}).`,
    }
  })

  on('tool.call', { tool: 'mcp__job-tracker__open_board' }, async ($, e) => {
    const { view: kind = 'board', leadId } = toolArgs(e) as { view?: string; leadId?: string }
    if ((kind === 'lead' || kind === 'package') && !leadId) {
      return { result: `Error: the ${kind} view needs leadId` }
    }
    const target: JobView =
      kind === 'lead'
        ? { kind: 'lead', id: leadId as string }
        : kind === 'package'
          ? { kind: 'package', id: leadId as string, tab: 'resume' }
          : kind === 'proposals'
            ? { kind: 'proposals' }
            : { kind: 'board' }
    await refresh($)
    await show($, target)
    const opened = await openPane($)
    // A pane whose tree the surface refused is closed again; give the first draw a moment.
    await $.clock.sleep(1500)
    const pane = (await $.ui.panes()).find(one => one.id === 'jobs')
    return {
      result: json({
        opened: opened.isPlaced ? 'placed' : `not placed: ${opened.reason}`,
        stillOpen: pane !== undefined,
        isPlaced: pane?.isPlaced ?? false,
        isShown: pane?.isShown ?? false,
        view: target,
      }),
    }
  })

  on('tool.call', { tool: 'mcp__job-tracker__list_leads' }, async ($, e) => {
    const input = toolArgs(e) as { column?: string; minScore?: number; limit?: number }
    const args = ['list', '--limit', String(input.limit ?? 20)]
    if (input.column) args.push('--column', input.column)
    if (input.minScore !== undefined) args.push('--min', String(input.minScore))
    const ran = await jobs($, args)
    return { result: ran.ok ? json(ran.value) : `Error: ${ran.error}` }
  })

  on('tool.call', { tool: 'mcp__job-tracker__update_lead' }, async ($, e) => {
    const { id, ...fields } = toolArgs(e) as { id?: string; column?: string } & Record<
      string,
      unknown
    >
    if (!id) return { result: 'Error: id is required' }
    if (fields.column !== undefined && !isColumn(fields.column)) {
      return { result: `Error: unknown column ${String(fields.column)}` }
    }
    const ran = await jobs($, ['patch', id, json(fields), '--by', 'model'])
    return { result: ran.ok ? json(ran.value) : `Error: ${ran.error}` }
  })

  on('tool.call', { tool: 'mcp__job-tracker__record_feedback' }, async ($, e) => {
    const ran = await jobs($, ['feedback', json(toolArgs(e))])
    return { result: ran.ok ? json(ran.value) : `Error: ${ran.error}` }
  })

  // The nudge: the session's first prompt from the person, when new leads were never named
  // and nothing was named in three hours, carries a note asking for one line at the end.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = isPersonOrigin(e.origin) && !e.command && !e.isMeta
    if (!isPerson) return next(e)
    const current = await refresh($).catch(() => undefined)
    if (await read($, nudged)) return next(e)
    await update($, nudged, () => true)
    if (!current?.dataDir || isJobPrompt(e.text)) return next(e)
    const named = leadsToMention({ version: 1, leads: current.leads }, await $.clock.now())
    if (named.length === 0) return next(e)
    await update($, pending, () => named.map(lead => lead.id))
    await update($, pendingTurn, () => e.turnId ?? null)
    return next({ ...e, context: [...(e.context ?? []), nudgeContext(named)] })
  })

  // Marks exactly the leads the nudge named, once the reply that names them has ended.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const ids = await read($, pending)
    // A prompt typed during another turn is answered after it: that turn's end is not the reply.
    if (ids.length > 0 && e.turnId === (await read($, pendingTurn))) return result
    if (ids.length > 0) {
      await update($, pending, () => [])
      const leads = (await read($, board)).leads.filter(lead => ids.includes(lead.id))
      const answer = e.answer.toLowerCase()
      const isNamed =
        answer.includes('/jobs') || leads.some(lead => answer.includes(lead.company.toLowerCase()))
      if (e.reason === 'answer' && isNamed) await jobs($, ['mention', ...ids])
    } else if (await dataDir($)) {
      await refresh($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const current = await read($, board)
    const text = bandText(counts({ version: 1, leads: current.leads }, current.loadedAt))
    if (!text) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isReadOnly = e.surface === 'mobile'
    return (
      <Box key="band" flexDirection="row">
        {isReadOnly ? (
          <Text>{`● ${text}`}</Text>
        ) : (
          <Button key="open-jobs" plain onPress={() => void openPane($)}>
            <Text color="claude">●</Text> {text} <Text dimColor>· /jobs</Text>
          </Button>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'jobs' }, async ($, e) => {
    const el = $.ui.resolve(e)
    const current = await read($, board)
    const at = await read($, view)
    const isReadOnly = e.surface === 'mobile'
    const all = actions($)
    const ctx: ViewContext = {
      el,
      surface: e.surface,
      board: current,
      now: current.loadedAt,
      columns: e.props.bodyColumns,
      busy: await read($, busy),
      act: isReadOnly ? undefined : all,
      nav: {
        open: all.open,
        board: all.board,
        proposals: all.proposals,
        review: all.review,
        tab: all.tab,
        more: all.more,
      },
    }
    if (at.kind === 'lead') return leadView(ctx, at.id, at.passing === true)
    if (at.kind === 'package') return packageView(ctx, at.id, at.tab, await read($, pkg))
    if (at.kind === 'proposals') return proposalsView(ctx)
    return boardView(ctx, {
      showClosed: await read($, showClosed),
      stage: await read($, stage),
      shown: await read($, shown),
    })
  })
}
