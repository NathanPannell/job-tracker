// job-tracker: the /jobs kanban pane, the band above the prompt, a once-a-session mention of
// new leads, and the tools the model uses to read and change the board. The skills under
// skills/ do the work; this module draws it and records what the person does.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderInput } from 'claude-code'

import type { DraftRun, JobPackage, JobView, PackageTab, SentPrompt } from '../types/index.d.ts'
import { act, dataDir, EMPTY_BOARD, jobs, loadPackage, openFile, PANE, refresh } from './lib/io.ts'
import {
  bandText,
  counts,
  draftRelay,
  draftTask,
  isColumn,
  leadsToMention,
  nudgeContext,
} from './lib/model.ts'
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
const turning = atom({ plugin: 'job-tracker', key: 'turning' } as const, false)
const sent = atom({ plugin: 'job-tracker', key: 'sent' } as const, [] as SentPrompt[])
const drafts = atom({ plugin: 'job-tracker', key: 'drafts' } as const, [] as DraftRun[])

/** How long a sent prompt shows as queued before the pane stops waiting for its turn. */
const SENT_FOR_MS = 30 * 60_000
const isLive = (one: SentPrompt, now: number) => now - one.at < SENT_FOR_MS
const startsWith = (one: SentPrompt, text: string) => text.includes(one.entered ?? one.text)

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

/**
 * Sends a pane button's prompt in the person's name. A plugin's prompt waits until the session
 * is idle, so a press during a reply looked like nothing happened: say so at once, show it as
 * queued until its turn starts, and report a prompt that did not enter.
 */
async function sendPrompt($: EngineInterface, text: string, label: string): Promise<boolean> {
  const at = await $.clock.now()
  // An entry whose turn was never seen (the queue cleared, say) expires, so the button
  // never stays blocked.
  if ((await read($, sent)).some(one => one.text === text && isLive(one, at))) {
    $.ui.toast(`${label} is already queued.`)
    return true
  }
  const isTurning = await read($, turning)
  await update($, sent, list => [
    ...list.filter(one => one.text !== text && isLive(one, at)),
    { text, label, at },
  ])
  $.ui.toast(
    isTurning
      ? `${label} once Claude finishes the current reply.`
      : `${label} in the conversation.`,
  )
  const forget = () => update($, sent, list => list.filter(one => one.text !== text))
  try {
    const result = await $.prompt.submit({ text, asUser: true })
    if (result.drop !== undefined) {
      await forget()
      $.ui.toast(`job-tracker: the prompt was not sent: ${result.drop}`)
      return false
    }
    if (result.text !== text) {
      const entered = result.text
      await update($, sent, list =>
        list.map(one => (one.text === text ? { ...one, entered } : one)),
      )
    }
    return true
  } catch (error) {
    await forget()
    $.ui.toast(`job-tracker: could not send the prompt: ${String(error)}`)
    return false
  }
}

/** How long a spawned build counts as running when its end is never heard. */
const DRAFT_FOR_MS = 45 * 60_000

type Drafted =
  | { ok: true; ran: 'subagent'; agentId?: string }
  | { ok: true; ran: 'conversation' | 'already-drafting' }
  | { ok: false; error: string }

/**
 * Builds a lead's package off the person's conversation: the card moves to Drafting at once and
 * a background subagent runs the package skill, so several builds run side by side and none
 * waits for the current reply. Where the engine refuses the spawn, a pane press asks the
 * conversation to start the subagent instead (`relay`); a tool call reports the refusal. A build
 * that does not start puts the card back where it was.
 */
async function draftPackage($: EngineInterface, lead: Lead, relay: boolean): Promise<Drafted> {
  const at = await $.clock.now()
  const redraft = (await read($, board)).applications.some(one => one.leadId === lead.id)
  const task = draftTask(lead, redraft)
  // Claimed before anything slow, so a second press or tool call meanwhile starts nothing.
  let isClaimed = false
  await update($, drafts, list => {
    const live = list.filter(one => at - one.at < DRAFT_FOR_MS)
    if (live.some(one => one.leadId === lead.id)) return live
    isClaimed = true
    return [...live, { leadId: lead.id, company: lead.company, task, at }]
  })
  if (!isClaimed) {
    $.ui.toast(`The ${lead.company} package is already being drafted.`)
    return { ok: true, ran: 'already-drafting' }
  }
  const release = () => update($, drafts, list => list.filter(one => one.task !== task))
  const by = relay ? 'user' : 'model'
  const moved = await act($, `Moving ${lead.company} to Drafting`, [
    'move',
    lead.id,
    'drafting',
    '--by',
    by,
  ])
  if (!moved.ok) {
    await release()
    return { ok: false, error: moved.error }
  }
  const putBack = async () => {
    await release()
    if (lead.column === 'drafting') return
    const reason = lead.column === 'passed' ? ['--reason', lead.passReason ?? 'Not interested'] : []
    await act($, 'Undoing the move', ['move', lead.id, lead.column, ...reason])
  }
  const label = `Drafting the ${lead.company} package`
  let refused: string
  try {
    const spawned = await $.agent.spawn({
      prompt: task,
      description: `Draft ${lead.company} package`,
      subagentType: 'general-purpose',
    })
    if (spawned.deny === undefined) {
      // Core answers with the agent's id. A hook that answers for it (the test kit's) gives
      // none: that run is known by its prompt when it starts (`turn.start`).
      const { agentId } = spawned
      if (agentId) await startDraft($, agentId, task)
      $.ui.toast(`${label} in the background.`)
      return { ok: true, ran: 'subagent', ...(agentId ? { agentId } : {}) }
    }
    refused = spawned.deny
  } catch (error) {
    refused = String(error)
  }
  if (!relay) {
    await putBack()
    return { ok: false, error: `The subagent did not start: ${refused}` }
  }
  // The conversation's subagent runs with the same prompt, so its run is matched like ours.
  if (!(await sendPrompt($, draftRelay(lead, task), label))) await putBack()
  return { ok: true, ran: 'conversation' }
}

/** A subagent's run started: a build spawned without an id learns it from its prompt. */
async function startDraft($: EngineInterface, agentId: string, text: string) {
  const list = await read($, drafts)
  if (list.some(one => one.agentId === agentId)) return
  const at = list.findIndex(one => one.agentId === undefined && one.task === text)
  if (at < 0) return
  await update($, drafts, runs => runs.map((one, n) => (n === at ? { ...one, agentId } : one)))
}

/** A package build's subagent ended: the board shows where its card went, a toast says how. */
async function finishDraft($: EngineInterface, agentId: string, answer: string, reason: string) {
  const run = (await read($, drafts)).find(one => one.agentId === agentId)
  if (!run) return
  await update($, drafts, list => list.filter(one => one.agentId !== agentId))
  await refresh($)
  const line = answer.trim().split('\n')[0]?.trim() ?? ''
  $.ui.toast(
    reason === 'answer'
      ? `${run.company} package: ${line.length > 140 ? `${line.slice(0, 139)}…` : line || 'done.'}`
      : `The ${run.company} package build stopped (${reason}); Draft package starts it again.`,
  )
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
    draft: lead => void draftPackage($, lead, true),
    review: (lead, tab: PackageTab = 'resume') =>
      void show($, { kind: 'package', id: lead.id, tab }),
    submit: lead =>
      void sendPrompt(
        $,
        `I approved the package for lead ${lead.id} (${lead.company} — ${lead.role}) on the job board. Use the job-tracker:submit skill: prefill the application, ask me in one message for anything it is missing, and stop before the final submit so I can confirm here.`,
        `Prefilling the ${lead.company} application`,
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
        "Lists job leads on the person's job board (job-tracker), best first. Each lead has fitScore (the scout's fit) and score (fitScore less points for the posting's age until applied, as the board shows it). Filter by column (new, drafting, ready, applied, interviewing, offer, passed, archived) and minimum score.",
      inputSchema: {
        type: 'object',
        properties: {
          column: { type: 'string', description: 'Only leads in this column' },
          minScore: { type: 'number', description: 'Only leads whose score is at least this' },
          limit: { type: 'number', description: 'At most this many (default 20)' },
        },
      },
    })
    await $.tool.register({
      name: 'update_lead',
      description:
        "Changes one lead on the person's job board: move it to a column, rescore it, add notes, set a follow-up or snooze date, or write its company blurb, tagline and role highlights. Moving to passed needs passReason. fitScore is the fit before ageing (the board takes points off for age itself), so never set it from the aged score list_leads shows.",
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          column: { type: 'string' },
          fitScore: { type: 'number' },
          fitReason: { type: 'string', description: 'One line: why this score' },
          companyBlurb: {
            type: 'string',
            description:
              'One sentence on what the company makes: product category, who it is for, flagship product by name if known. Stage or size only as a trailing clause, never alone',
          },
          tagline: {
            type: 'string',
            description:
              "The card's one-liner, at most 40 characters: what the company makes or what the role is, e.g. 'Scheduling software for home care'. No size, stage, location or padding",
          },
          roleHighlights: {
            type: 'array',
            items: { type: 'string' },
            description:
              '2-4 short points on what is distinctive about this role, from the posting',
          },
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
      name: 'draft_package',
      description:
        "Starts building the application package for one lead on the person's job board in a background subagent and moves its card to Drafting; returns at once, and the card moves to Ready to review when the build ends. Use it whenever the person asks in this conversation to draft, build or redraft a package, instead of running the job-tracker:package skill here: a build takes several minutes and would hold the conversation.",
      inputSchema: {
        type: 'object',
        required: ['leadId'],
        properties: { leadId: { type: 'string' } },
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

  on('tool.call', { tool: 'mcp__job-tracker__draft_package' }, async ($, e) => {
    const { leadId } = toolArgs(e) as { leadId?: string }
    if (!leadId) return { result: 'Error: leadId is required' }
    const lead = (await refresh($)).leads.find(one => one.id === leadId)
    if (!lead) return { result: `Error: no lead ${leadId}` }
    const drafted = await draftPackage($, lead, false)
    return { result: drafted.ok ? json(drafted) : `Error: ${drafted.error}` }
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
    const now = await $.clock.now()
    const named = leadsToMention({ version: 1, leads: current.leads }, now)
    if (named.length === 0) return next(e)
    await update($, pending, () => named.map(lead => lead.id))
    await update($, pendingTurn, () => e.turnId ?? null)
    return next({ ...e, context: [...(e.context ?? []), nudgeContext(named, now)] })
  })

  // A sent prompt stops showing as queued once its own turn starts.
  on('turn.start', async ($, e, next) => {
    if (e.agentId) {
      await startDraft($, e.agentId, e.text)
      return next(e)
    }
    await update($, turning, () => true)
    if ((await read($, sent)).some(one => startsWith(one, e.text))) {
      await update($, sent, list => list.filter(one => !startsWith(one, e.text)))
    }
    return next(e)
  })

  // Marks exactly the leads the nudge named, once the reply that names them has ended.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) {
      await finishDraft($, e.agentId, e.answer, e.reason)
      return result
    }
    await update($, turning, () => false)
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

  // A drawing that fails (throws, overruns its budget, or returns a tree the surface refuses)
  // shows why and a way back to the board, never a blank pane.
  on('ui.render', { component: 'Pane', requestId: 'jobs' }, async ($, e) => {
    try {
      return await drawPane($, e)
    } catch (error) {
      return paneFailure($, e, describeError(error))
    }
  }).catch(($, e, next) => {
    const { kind, message } = next.error
    return paneFailure($, e, `${kind}${message ? `: ${message}` : ''}`)
  })
}

/** An error as one line and the head of its stack. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const stack = (error.stack ?? '')
    .split('\n')
    .slice(1, 4)
    .map(line => line.trim())
  return [`${error.name}: ${error.message}`, ...stack].join('\n')
}

/** Failures already reported this load, so a pane that keeps failing says so once. */
const reported = new Set<string>()

/** What the pane shows when its drawing failed: the reason, and a button back to the board. */
function paneFailure($: EngineInterface, e: RenderInput<'Pane'>, why: string) {
  if (!reported.has(why)) {
    reported.add(why)
    $.ui.log(`job-tracker: the board could not draw: ${why}`)
    $.ui.toast('job-tracker: the board could not draw; the pane says why.')
  }
  const { Box, Text, Button } = $.ui.resolve(e)
  const [first = why, ...rest] = why.split('\n')
  return (
    <Box key="pane-failure" flexDirection="column" gap={1}>
      <Text bold color="warning">{`The board could not draw: ${first}`}</Text>
      {rest.length > 0 && <Text dimColor>{rest.join('\n')}</Text>}
      {e.surface !== 'mobile' && (
        <Button
          key="pane-reset"
          label="Back to the board"
          onPress={() =>
            void update($, view, () => ({ kind: 'board' }) as JobView)
              .then(() => update($, stage, () => null))
              .then(() => update($, shown, () => PAGE))
              .then(() => refresh($))
          }
        />
      )}
    </Box>
  )
}

/** The pane's drawing: the board, a lead, a package or the proposals, as `view` says. */
async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const el = $.ui.resolve(e)
  const current = await read($, board)
  const at = await read($, view)
  const isReadOnly = e.surface === 'mobile'
  const now = await $.clock.now()
  const all = actions($)
  const ctx: ViewContext = {
    el,
    surface: e.surface,
    board: current,
    now: current.loadedAt,
    columns: e.props.bodyColumns,
    busy: await read($, busy),
    queued: (await read($, sent)).filter(one => isLive(one, now)).map(one => one.label),
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
}
