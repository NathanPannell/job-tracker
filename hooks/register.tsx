// job-tracker: the /jobs kanban pane, the band above the prompt, a once-a-session mention of
// new leads, and the tools the model uses to read and change the board. The skills under
// skills/ do the work; this module draws it and records what the person does.
import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  McpToolResult,
  PromptOrigin,
  Register,
  RenderInput,
  UiOpenResult,
} from 'claude-code'

import type {
  DraftRun,
  JobPackage,
  JobView,
  PackageTab,
  PrefillGuard,
  SentPrompt,
} from '../types/index.d.ts'
import {
  CHROME_SERVER,
  chromeCall,
  createdTab,
  flatten,
  isPressable,
  isStraySubmit,
  isSubmitControl,
  isTextField,
  judgeOther,
  judgePrefill,
  STRAY_SUBMIT,
  submittedLine,
  tabOf,
} from './lib/chrome.ts'
import type { ChromeCall } from './lib/chrome.ts'
import { FORM_ACTIONS, formResult, formScript, formStep } from './lib/deep-form.ts'
import type { RunStep } from './lib/deep-form.ts'
import { act, dataDir, EMPTY_BOARD, jobs, loadPackage, openFile, PANE, refresh } from './lib/io.ts'
import {
  bandText,
  clarifyKey,
  counts,
  draftRelay,
  draftTask,
  GHOSTED_REASON,
  isApprovable,
  isColumn,
  isGhosted,
  leadsToMention,
  nudgeContext,
  openClarification,
  reviseRelay,
  reviseTask,
  stageOf,
  stageTab,
  submitBatchLeft,
  submitBatchRelay,
  isManualApply,
  MANUAL_APPLY,
  submitFollowUp,
  submitRelay,
  submitTask,
} from './lib/model.ts'
import type { BatchLead, BoardTab, Column, Lead, Stage } from './lib/model.ts'
import { boardView, leadView, packageView, PAGE, proposalsView } from './views.tsx'
import type { Actions, ViewContext } from './views.tsx'

// The session values the pane and band draw from (the contract is types/index.d.ts).
const board = atom({ plugin: 'job-tracker', key: 'board' } as const, EMPTY_BOARD)
const view = atom({ plugin: 'job-tracker', key: 'view' } as const, { kind: 'board' } as JobView)
const pkg = atom({ plugin: 'job-tracker', key: 'pkg' } as const, null as JobPackage | null)
const boardTab = atom({ plugin: 'job-tracker', key: 'boardTab' } as const, 'active' as BoardTab)
const stage = atom({ plugin: 'job-tracker', key: 'stage' } as const, null as Stage | null)
const shown = atom({ plugin: 'job-tracker', key: 'shown' } as const, PAGE)
const pending = atom({ plugin: 'job-tracker', key: 'pending' } as const, [] as string[])
const pendingTurn = atom(
  { plugin: 'job-tracker', key: 'pendingTurn' } as const,
  null as string | null,
)
const nudged = atom({ plugin: 'job-tracker', key: 'nudged' } as const, false)
const busy = atom({ plugin: 'job-tracker', key: 'busy' } as const, null as string | null)
const passing = atom({ plugin: 'job-tracker', key: 'passing' } as const, null as string | null)
const clarifying = atom(
  { plugin: 'job-tracker', key: 'clarifying' } as const,
  null as string | null,
)
const turning = atom({ plugin: 'job-tracker', key: 'turning' } as const, false)
const sent = atom({ plugin: 'job-tracker', key: 'sent' } as const, [] as SentPrompt[])
const drafts = atom({ plugin: 'job-tracker', key: 'drafts' } as const, [] as DraftRun[])
const prefills = atom({ plugin: 'job-tracker', key: 'prefills' } as const, [] as PrefillGuard[])
/** A /jobs or open_board that ran before any window attached; the next one opens the board. */
const awaitingWindow = atom({ plugin: 'job-tracker', key: 'awaitingWindow' } as const, false)

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

/** Opened before any surface attached: a new chat's first message runs before its window joins. */
const isWindowless = (opened: UiOpenResult) =>
  !opened.isPlaced && opened.reason.startsWith('no-surface')

/**
 * Opens the pane for the person's /jobs, open_board or band press, and remembers an open that
 * found no window, for the next one that attaches. Only a placed open forgets it: a later open
 * while only the phone is attached leaves it waiting for the desktop.
 */
async function openAsked($: EngineInterface): Promise<UiOpenResult> {
  const opened = await openPane($)
  if (opened.isPlaced) await update($, awaitingWindow, () => false)
  if (!isWindowless(opened)) return opened
  await update($, awaitingWindow, () => true)
  // A window that attached while this open was answered found nothing waiting: open for it now.
  const surfaces = await $.session.surfaces()
  return surfaces.some(one => one !== 'mobile') ? openWaiting($) : opened
}

/** Opens the pane an open with no window left waiting, once a window that docks it is there. */
async function openWaiting($: EngineInterface): Promise<UiOpenResult> {
  const opened = await openPane($)
  if (!isWindowless(opened)) await update($, awaitingWindow, () => false)
  if (!opened.isPlaced) $.ui.log(`job-tracker: the board did not open (${opened.reason})`)
  return opened
}

/** Puts the board back on Active: every opening starts there, wherever the last visit ended. */
async function resetBoard($: EngineInterface) {
  await update($, boardTab, () => 'active' as const)
  await update($, stage, () => null)
  await update($, shown, () => PAGE)
}

async function show($: EngineInterface, next: JobView) {
  // Reasons opened on a card stay with that card, not with the page the person goes to.
  await update($, passing, () => null)
  await update($, clarifying, () => null)
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
async function draftPackage(
  $: EngineInterface,
  lead: Lead,
  relay: boolean,
  onMoved?: () => Promise<void>,
): Promise<Drafted> {
  const at = await $.clock.now()
  const redraft = (await read($, board)).applications.some(one => one.leadId === lead.id)
  const task = draftTask(lead, redraft)
  // Claimed before anything slow, so a second press or tool call meanwhile starts nothing.
  const running = await claimRun($, {
    kind: 'draft',
    leadId: lead.id,
    company: lead.company,
    task,
    at,
  })
  // A tool call is told plainly that no build runs: the application waits on the person.
  if (running?.isHandedOn && !relay) return { ok: false, error: busyNote(running) }
  if (running) {
    $.ui.toast(busyNote(running))
    await onMoved?.()
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
  // Not after the spawn: a relayed prompt can wait minutes for the current reply to end.
  await onMoved?.()
  const putBack = async () => {
    await release()
    if (lead.column === 'drafting') return
    const reason = lead.column === 'passed' ? ['--reason', lead.passReason ?? 'Not interested'] : []
    const note = isGhosted(lead) ? ['--note', GHOSTED_REASON] : []
    await act($, 'Undoing the move', ['move', lead.id, lead.column, ...reason, ...note])
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

/**
 * Revises a clarified change off the person's conversation: a background subagent follows the
 * learn skill and the revision shows on the board for review again. Where the engine refuses the
 * spawn, the conversation is asked to start the subagent instead.
 */
async function reviseClarified($: EngineInterface, proposalId: string, changeId: string) {
  // Read afresh: its revision may have landed since the page drew.
  const proposal = (await refresh($, false)).proposals.find(one => one.id === proposalId)
  const change = proposal?.changes.find(one => one.id === changeId)
  if (!change || !openClarification(change)) return
  const task = reviseTask(proposalId, change)
  const running = await claimRun($, {
    kind: 'revise',
    leadId: clarifyKey(proposalId, changeId),
    company: change.title,
    task,
    at: await $.clock.now(),
  })
  if (running) {
    $.ui.toast(busyNote(running))
    return
  }
  const label = `Revising "${change.title}"`
  try {
    const spawned = await $.agent.spawn({
      prompt: task,
      description: `Revise ${changeId} of ${proposalId}`,
      subagentType: 'general-purpose',
    })
    if (spawned.deny === undefined) {
      if (spawned.agentId) await startDraft($, spawned.agentId, task)
      $.ui.toast(`${label} in the background; it comes back here for review.`)
      return
    }
  } catch {
    // the conversation starts it instead
  }
  if (!(await sendPrompt($, reviseRelay(change.title, task), label))) {
    await update($, drafts, list => list.filter(one => one.task !== task))
  }
}

/**
 * Claims a lead for one background run, before anything slow, so a second press or tool call
 * meanwhile starts nothing: answers the run already going for that lead, if there is one.
 */
async function claimRun($: EngineInterface, run: DraftRun): Promise<DraftRun | undefined> {
  let running: DraftRun | undefined
  await update($, drafts, list => {
    const live = list.filter(one => run.at - one.at < DRAFT_FOR_MS)
    running = live.find(one => one.leadId === run.leadId)
    return running ? live : [...live, run]
  })
  return running
}

/** What a press says when the lead already has a background run going. */
const busyNote = (run: DraftRun) =>
  run.isHandedOn
    ? `The ${run.company} application is prefilled; Claude picks it up in the conversation.`
    : run.kind === 'revise'
      ? `"${run.company}" is already being revised.`
      : run.kind === 'submit'
        ? `The ${run.company} application is already being prefilled.`
        : `The ${run.company} package is already being drafted.`

/**
 * Prefills an approved package's application in Chrome off the person's conversation: a
 * background subagent runs the submit skill's slow part and never submits. Its report goes to
 * the conversation when it ends (`finishDraft`), where the person answers what the record cannot
 * and the conversation sends it, unless it needs the person's own click. A lead marked for applying
 * by hand is never opened. Where the engine refuses the spawn, the conversation is asked to do
 * all of it.
 */
async function submitApplication($: EngineInterface, lead: Lead) {
  if (isManualApply(lead)) {
    $.ui.toast(manualNote(lead))
    return
  }
  const started = await startPrefill($, lead)
  const label = `Prefilling the ${lead.company} application`
  if (started === 'spawned') {
    $.ui.toast(
      `${label} in Chrome in the background; Claude submits it once nothing is open, or says here what it needs from you.`,
    )
  } else if (started === 'refused') {
    await sendPrompt($, submitRelay(lead), label)
  } else {
    $.ui.toast(busyNote(started))
  }
}

/**
 * Starts one lead's background prefill: `spawned`, `refused` (the claim is released, so the
 * conversation can be asked instead), or the run already going for that lead.
 */
async function startPrefill(
  $: EngineInterface,
  lead: Lead,
): Promise<'spawned' | 'refused' | DraftRun> {
  const at = await $.clock.now()
  const task = submitTask(lead)
  const running = await claimRun($, {
    kind: 'submit',
    leadId: lead.id,
    company: lead.company,
    task,
    at,
  })
  if (running) return running
  try {
    const spawned = await $.agent.spawn({
      prompt: task,
      description: `Prefill ${lead.company} application`,
      subagentType: 'general-purpose',
    })
    if (spawned.deny === undefined) {
      if (spawned.agentId) await startDraft($, spawned.agentId, task)
      return 'spawned'
    }
  } catch {
    // the conversation does it instead
  }
  await update($, drafts, list => list.filter(one => one.task !== task))
  return 'refused'
}

/**
 * "Approve and submit all": every Ready lead with a package starts its prefill at once, as if
 * each card's button were pressed in turn, so their reports form one batch (`batchOf`). One
 * toast says what started; the leads whose spawn was refused go to the conversation in one
 * prompt, so it still asks once for the whole batch.
 */
async function submitAll($: EngineInterface, approved: readonly Lead[]) {
  // A lead marked for applying by hand is never opened, in a batch as alone.
  const manual = approved.filter(isManualApply).length
  const leads = approved.filter(one => !isManualApply(one))
  // One lead's failure is that lead's alone: it counts as refused, so the conversation asks.
  const settled = await Promise.allSettled(leads.map(lead => startPrefill($, lead)))
  const started = settled.map(one => (one.status === 'fulfilled' ? one.value : 'refused'))
  const spawned = started.filter(one => one === 'spawned').length
  const running = started.filter(one => typeof one === 'object').length
  const refused = leads.filter((_, n) => started[n] === 'refused')
  const notes = [
    spawned > 0 &&
      `Prefilling ${plural(spawned, 'application')} in Chrome in the background; Claude submits each once nothing is open, or says here what it needs from you.`,
    running > 0 && `${plural(running, 'application')} already underway.`,
    manual > 0 && `${manual} marked ${MANUAL_APPLY} left for you to apply by hand.`,
  ].filter(Boolean)
  if (notes.length > 0) $.ui.toast(notes.join(' '))
  if (refused.length > 0) {
    await sendPrompt(
      $,
      submitBatchRelay(refused),
      `Prefilling ${plural(refused.length, 'application')}`,
    )
  }
}

/** What the person is told when they approve a lead marked for applying by hand. */
const manualNote = (lead: Lead) =>
  `${lead.company} is marked ${MANUAL_APPLY}: apply for it by hand; its package is ready.`

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A subagent's run started: a build spawned without an id learns it from its prompt. */
async function startDraft($: EngineInterface, agentId: string, text: string) {
  // Found inside the update: a batch's other runs come and go meanwhile, so a position read
  // before it could name another lead's run.
  await update($, drafts, runs => {
    if (runs.some(one => one.agentId === agentId)) return runs
    const at = runs.findIndex(one => one.agentId === undefined && one.task === text)
    return at < 0 ? runs : runs.map((one, n) => (n === at ? { ...one, agentId } : one))
  })
  // A prefill is known to the Chrome guard from its start (`turn.start` comes before any tool
  // call) to its end, however long it runs.
  const run = (await read($, drafts)).find(one => one.agentId === agentId)
  if (run?.kind !== 'submit') return
  const at = await $.clock.now()
  await update($, prefills, list =>
    list.some(one => one.agentId === agentId) ? list : [...list, { agentId, at, tabs: [] }],
  )
}

/**
 * The other applications approved alongside a lead and not submitted yet: prefills still running
 * and prefilled ones waiting in the conversation, whose cards are still in Ready to apply.
 */
async function batchOf($: EngineInterface, leadId: string, at: number): Promise<BatchLead[]> {
  const leads = (await read($, board)).leads
  return (await read($, drafts)).flatMap(run => {
    if (run.kind !== 'submit' || run.leadId === leadId || at - run.at >= DRAFT_FOR_MS) return []
    const other = leads.find(one => one.id === run.leadId)
    if (other?.column !== 'ready') return []
    const { id, company, role } = other
    return [{ id, company, role, isPrefilled: run.isHandedOn === true }]
  })
}

/**
 * A background run's subagent ended. A package build: the board shows where its card went, a
 * toast says how. A prefill: its report goes to the conversation, which asks what is left.
 */
async function finishDraft($: EngineInterface, agentId: string, answer: string, reason: string) {
  const run = (await read($, drafts)).find(one => one.agentId === agentId)
  const guard = prefillOf(await read($, prefills), agentId)
  // Its tabs are read before the guard lets go of them, even for a run whose row has lapsed.
  const stray = guard ? await strayFinding($, guard, answer) : undefined
  if (guard) {
    await update($, prefills, list =>
      list.map(one => (one.agentId === agentId ? { ...one, isDone: true as const } : one)),
    )
  }
  if (!run) {
    if (stray) $.ui.toast(`${stray} Check that tab in Chrome.`)
    return
  }
  const report = stray ? `${stray}\n\n${answer}` : answer
  const isStray = stray !== undefined || isStraySubmit(answer)
  // A prefill's lead is handed on in the same write that ends its run, so it stays claimed
  // throughout and a batch member ending meanwhile still finds it (`batchOf`). One that stopped
  // has nothing to hand on, and leaves in that write, so nothing takes it for prefilled.
  const handedOn: DraftRun = {
    kind: 'submit',
    leadId: run.leadId,
    company: run.company,
    task: `handed on: ${run.leadId}`,
    at: await $.clock.now(),
    isHandedOn: true,
  }
  await update($, drafts, list => [
    ...list.filter(one => one.agentId !== agentId),
    ...(run.kind === 'submit' && (reason === 'answer' || isStray) ? [handedOn] : []),
  ])
  await refresh($)
  if (run.kind === 'revise') {
    const found = (await read($, board)).proposals
      .flatMap(proposal => proposal.changes.map(change => ({ proposal, change })))
      .find(({ proposal, change }) => clarifyKey(proposal.id, change.id) === run.leadId)
    // Decided while it ran, the change has nothing left to come back for.
    if (found?.change.status !== 'pending') return
    const open = openClarification(found.change)
    // Clarified again after this run started: those words were claimed by it, so they get a run.
    if (open && Date.parse(open.at) > run.at) {
      await reviseClarified($, found.proposal.id, found.change.id)
      return
    }
    const why = reason === 'answer' ? '' : ` (${reason})`
    $.ui.toast(
      open
        ? `"${run.company}" was not revised${why}; Revise now starts it again.`
        : `"${run.company}" is revised and back for review under Learning proposals.`,
    )
    return
  }
  if (run.kind === 'submit') {
    const release = () => update($, drafts, list => list.filter(one => one.task !== handedOn.task))
    const lead = (await read($, board)).leads.find(one => one.id === run.leadId)
    const named = lead ?? { id: run.leadId, company: run.company, role: 'the approved role' }
    // A conversation already holding a report of this batch may be told this lead's is coming, and
    // waits on it before saying the batch is ready, so a lead that drops out says so.
    const settle = async () => {
      const others = await batchOf($, run.leadId, await $.clock.now())
      if (!others.some(one => one.isPrefilled)) return
      await sendPrompt($, submitBatchLeft(named), `Dropping the ${run.company} application`)
    }
    if (isStray) {
      // Said first, whatever else happened. The lead stays claimed, even when the conversation
      // cannot be told, so nothing starts on it again before the person has looked.
      const others = await batchOf($, run.leadId, await $.clock.now())
      const label = `Reporting the ${run.company} application`
      const isTold = await sendPrompt($, submitFollowUp(named, report, others), label)
      $.ui.toast(
        isTold
          ? `The ${run.company} application looks submitted, but nobody approved a submit; Claude tells you in the conversation.`
          : `The ${run.company} application looks submitted, but nobody approved a submit; check its tab in Chrome.`,
      )
    } else if (reason !== 'answer') {
      $.ui.toast(
        `The ${run.company} application prefill stopped (${reason}); Approve and submit starts it again.`,
      )
      await settle()
    } else if (lead?.column !== 'ready') {
      await release()
      $.ui.toast(
        `The ${run.company} application was prefilled, but its card left Ready to apply meanwhile; nothing was sent.`,
      )
      await settle()
    } else {
      // The lead stays claimed while the conversation asks and the person submits, so neither a
      // second prefill nor a redraft (a new résumé under the uploaded one) starts meanwhile.
      const others = await batchOf($, run.leadId, await $.clock.now())
      const label = `Finishing the ${run.company} application`
      // It never reached the conversation, so nothing is asking: the lead is free again.
      if (!(await sendPrompt($, submitFollowUp(lead, answer, others), label))) {
        await release()
        await settle()
      }
    }
    return
  }
  const line = answer.trim().split('\n')[0]?.trim() ?? ''
  $.ui.toast(
    reason === 'answer'
      ? `${run.company} package: ${line.length > 140 ? `${line.slice(0, 139)}…` : line || 'done.'}`
      : `The ${run.company} package build stopped (${reason}); Draft package starts it again.`,
  )
}

/**
 * What a prefill's tabs show when it ends: the line that reads as a sent application, as the
 * first line of its report, or undefined. A tab that cannot be read proves nothing either way; a
 * report that already opens with the finding gets no second one.
 */
async function strayFinding(
  $: EngineInterface,
  guard: PrefillGuard,
  answer: string,
): Promise<string | undefined> {
  if (isStraySubmit(answer)) return undefined
  for (const tabId of guard.tabs) {
    const page = await $.mcp
      .call(guard.browser ?? CHROME_SERVER, 'get_page_text', { tabId })
      .catch(() => undefined)
    const line = page && !page.isError ? submittedLine(textOf(page)) : undefined
    if (line) {
      return `${STRAY_SUBMIT}: tab ${tabId} reads "${line}" when the background prefill ended. Nobody approved a submit.`
    }
  }
  return undefined
}

/** An MCP result's text blocks, joined. */
const textOf = (result: McpToolResult) =>
  result.content
    .flatMap(block => (block.type === 'text' && block.text ? [block.text] : []))
    .join('\n')

/** The background prefill a loop belongs to, while its subagent runs. */
const prefillOf = (guards: readonly PrefillGuard[], agentId: string | undefined) =>
  agentId === undefined ? undefined : guards.find(one => one.agentId === agentId && !one.isDone)

/**
 * The Chrome guard: a background prefill uses only the tools it needs, acts in Chrome only in
 * the tabs it opened, only through element refs, and never on a control that submits, sends or
 * confirms (the rules are lib/chrome.ts); anyone else may not touch a running prefill's tabs.
 * Undefined lets the call through.
 */
async function guardChrome(
  $: EngineInterface,
  agentId: string | undefined,
  tool: string,
  call: ChromeCall | undefined,
): Promise<string | undefined> {
  const guards = await read($, prefills)
  const guard = prefillOf(guards, agentId)
  // A prefill that ended and is sent on again would run unguarded: it does nothing more.
  if (guards.some(one => one.agentId === agentId && one.isDone)) {
    return 'This background prefill has ended and its report went to the conversation; it acts no more.'
  }
  if (!guard) {
    if (!call) return undefined
    const held = (await stillRunning($, guards)).flatMap(one => one.tabs)
    if (held.length === 0) return undefined
    const items = flatten(call)
    if (items.some(one => one.tool === 'navigate' && tabOf(one) === undefined)) {
      return 'Pass tabId: a navigate without one could land in a tab a background prefill is filling in.'
    }
    const taken = items.map(tabOf).find(tab => tab !== undefined && held.includes(tab))
    return taken === undefined
      ? undefined
      : `Tab ${taken} belongs to a background prefill that is still running; wait for its report.`
  }
  if (!call) return judgeOther(tool)
  const verdict = judgePrefill(call, guard.tabs)
  if ('deny' in verdict) return verdict.deny
  for (const { tabId, ref, kind } of verdict.checks) {
    const element = await $.mcp
      .call(call.server, 'read_page', { tabId, ref_id: ref })
      .catch(() => undefined)
    const shown = element && !element.isError ? textOf(element) : ''
    if (kind === 'click' && isSubmitControl(shown)) {
      return `${ref} looks like it submits, sends or confirms, or could not be read; a background prefill never clicks it. Leave it for the conversation.`
    }
    if (kind === 'select' && !isTextField(shown)) {
      return `${ref} is not a text field; a background prefill double- or triple-clicks only to select text in one (a button could change between the clicks).`
    }
    if (kind === 'fill' && isPressable(shown)) {
      return `${ref} is a button or link, or could not be read; form_input fills fields only. Use a computer click with its ref for a button such as Next.`
    }
  }
  return undefined
}

/**
 * The prefills still holding their tabs. Past the run hold, one whose subagent the engine no
 * longer runs (its end was never heard) lets go of them; while the agent list cannot be read,
 * every one holds on.
 */
async function stillRunning(
  $: EngineInterface,
  guards: readonly PrefillGuard[],
): Promise<PrefillGuard[]> {
  const live = guards.filter(one => !one.isDone && one.tabs.length > 0)
  const now = await $.clock.now()
  if (!live.some(one => now - one.at >= DRAFT_FOR_MS)) return live
  const agents = await $.agent.list().catch(() => undefined)
  if (!agents) return live
  const running = new Set(
    agents.flatMap(one => (['completed', 'failed', 'killed'].includes(one.status) ? [] : [one.id])),
  )
  const ended = live.filter(one => now - one.at >= DRAFT_FOR_MS && !running.has(one.agentId))
  if (ended.length === 0) return live
  const gone = new Set(ended.map(one => one.agentId))
  await update($, prefills, list =>
    list.map(one => (gone.has(one.agentId) ? { ...one, isDone: true as const } : one)),
  )
  return live.filter(one => !gone.has(one.agentId))
}

/** Records the tab a prefill just opened with tabs_create_mcp (never inside a batch) as its own. */
async function keepTab($: EngineInterface, agentId: string, call: ChromeCall, text: string) {
  const opened = call.tool === 'tabs_create_mcp' ? createdTab(text) : undefined
  if (opened === undefined) return
  await update($, prefills, list =>
    list.map(one =>
      one.agentId === agentId && !one.isDone
        ? { ...one, tabs: [...one.tabs, opened], browser: call.server }
        : one,
    ),
  )
}

/**
 * After a press that settles a lead for now (drafted, passed, moved, an outcome recorded, sent
 * to submit), the pane goes back to the board on the stage tab the lead was in, so the next one
 * is a click away. It looks when the write is done, so a press on the board, or on a lead the
 * person has since left for another, leaves the pane where it is.
 */
async function leave($: EngineInterface, lead: Lead) {
  const at = await read($, view)
  if ((at.kind !== 'lead' && at.kind !== 'package') || at.id !== lead.id) return
  const from = stageOf(lead)
  if ((await read($, stage)) !== from) {
    await update($, boardTab, () => stageTab(from))
    await update($, stage, () => from)
    await update($, shown, () => PAGE)
  }
  await show($, { kind: 'board' })
}

function actions($: EngineInterface): Actions {
  const move = (lead: Lead, to: Column, note?: string) =>
    void act($, `Moving ${lead.company}`, [
      'move',
      lead.id,
      to,
      ...(note ? ['--note', note] : []),
    ]).then(result => (result.ok ? leave($, lead) : undefined))
  return {
    open: id => void show($, { kind: 'lead', id }),
    board: () => void show($, { kind: 'board' }),
    // Refreshed on opening: a revision lands whenever its run saves it, in any session.
    proposals: () => void show($, { kind: 'proposals' }).then(() => refresh($, false)),
    refresh: () => void refresh($),
    tab: next =>
      void update($, boardTab, () => next)
        .then(() => update($, stage, () => null))
        .then(() => update($, shown, () => PAGE)),
    stage: next => void update($, stage, () => next).then(() => update($, shown, () => PAGE)),
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
        await leave($, lead)
        await act($, 'Recording the outcome', [
          'feedback',
          JSON.stringify({ leadId: lead.id, kind: 'outcome', reason }),
        ])
      })(),
    // Opens the reasons where the press was, on the card or the lead's page; a second press
    // closes them. It writes nothing, so a write still running does not hold it up.
    askPass: lead => void update($, passing, id => (id === lead.id ? null : lead.id)),
    cancelPass: () => void update($, passing, () => null),
    pass: (lead, reason) =>
      void act($, `Passing on ${lead.company}`, ['pass', lead.id, reason]).then(async result => {
        if (!result.ok) return
        await update($, passing, id => (id === lead.id ? null : id))
        await leave($, lead)
      }),
    score: (lead, correction) =>
      void act($, 'Recording the correction', ['score', lead.id, correction]).then(result => {
        if (result.ok) $.ui.toast(`Noted: ${lead.company} scored ${correction.replace('-', ' ')}`)
      }),
    draft: lead => void draftPackage($, lead, true, () => leave($, lead)),
    review: (lead, tab: PackageTab = 'resume') =>
      void show($, { kind: 'package', id: lead.id, tab }),
    // Back to the board first: a relayed prompt can wait for the current reply to end.
    submit: lead => void leave($, lead).then(() => submitApplication($, lead)),
    submitAll: leads => void submitAll($, leads),
    openPdf: path => void openFile($, path),
    decide: (id, changeId, decision) =>
      void (async () => {
        // A press on a change the board shows decided sends nothing. A second press while the
        // first is still writing reaches the CLI, which takes a repeated decision as done, so a
        // change's text is appended once.
        const proposal = (await read($, board)).proposals.find(one => one.id === id)
        const open = proposal?.changes.filter(
          one =>
            one.status === 'pending' &&
            (changeId === 'all' || one.id === changeId) &&
            (decision === 'reject' || isApprovable(one)),
        )
        if (!open?.length) return
        const what = changeId === 'all' ? `${open.length} learnings` : `"${open[0]?.title}"`
        // The ids the page drew, not `all`: a revision that landed since must not be approved
        // unseen, and the CLI would take it as no longer waiting.
        await act($, `${decision === 'approve' ? 'Approving' : 'Rejecting'} ${what}`, [
          'decide',
          id,
          open.map(one => one.id).join(','),
          decision,
        ])
      })(),
    // Opens the field on the change; a second press closes it. It writes nothing.
    askClarify: (id, changeId) => {
      const key = clarifyKey(id, changeId)
      void update($, clarifying, open => (open === key ? null : key))
    },
    clarify: (id, changeId, text) =>
      void (async () => {
        // JSON, so words that start with a dash or hold a newline reach the CLI as they are.
        const saved = await act($, 'Saving the clarification', [
          'clarify',
          JSON.stringify({ proposal: id, change: changeId, text }),
        ])
        if (!saved.ok) return
        const key = clarifyKey(id, changeId)
        await update($, clarifying, open => (open === key ? null : open))
        await reviseClarified($, id, changeId)
      })(),
    revise: (id, changeId) => void reviseClarified($, id, changeId),
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
        "Lists job leads on the person's job board (job-tracker), best first. Each lead has fitScore, the scout's fit score the board shows. Filter by column (new, drafting, ready, applied, interviewing, offer, rejected, passed, archived) and minimum fit score.",
      inputSchema: {
        type: 'object',
        properties: {
          column: { type: 'string', description: 'Only leads in this column' },
          minScore: { type: 'number', description: 'Only leads whose fit score is at least this' },
          limit: { type: 'number', description: 'At most this many (default 20)' },
        },
      },
    })
    await $.tool.register({
      name: 'update_lead',
      description:
        "Changes one lead on the person's job board: move it to a column, rescore it, add notes, or write its company blurb, tagline and role highlights. Moving to passed needs passReason.",
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
        "Starts building the application package for one lead on the person's job board in a background subagent and moves its card to Drafting; returns at once, and the card moves to Ready to apply when the build ends. Use it whenever the person asks in this conversation to draft, build or redraft a package, instead of running the job-tracker:package skill here: a build takes several minutes and would hold the conversation.",
      inputSchema: {
        type: 'object',
        required: ['leadId'],
        properties: { leadId: { type: 'string' } },
      },
    })
    await $.tool.register({
      name: 'deep_form',
      description:
        "Reads and fills a job application form in a Claude in Chrome tab when find and read_page give no ref, because it sits inside a shadow root or a same-origin iframe. Runs the mod's own fixed script, no other JavaScript. read lists every control with an id. fill sets a text field or select to value, or ticks a box (value 'false' unticks). press clicks a button, option or menu item, and refuses anything that reads like a submit. add_file_input adds a temporary file input to the page; find it, file_upload to its ref, then attach copies the file to the file input named by id and removes the temporary one. Confirm with a screenshot.",
      inputSchema: {
        type: 'object',
        required: ['tabId', 'action'],
        properties: {
          tabId: { type: 'number' },
          action: { type: 'string', enum: [...FORM_ACTIONS] },
          id: { type: 'string', description: 'A field id from read, for fill, press and attach' },
          value: { type: 'string', description: 'For fill' },
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
    await resetBoard($)
    await show($, { kind: 'board' })
    const opened = await openAsked($)
    const c = counts({ version: 1, leads: (await read($, board)).leads }, await $.clock.now())
    return {
      text: opened.isPlaced
        ? `Opened the job board: ${bandText(c) ?? 'nothing new'}.`
        : isWindowless(opened)
          ? 'The job board will open as soon as this window is ready: no window that shows panes is attached yet.'
          : `The job board is waiting for room to open (${opened.reason}).`,
    }
  })

  // A new chat's first message runs before its window attaches; the board it asked for opens
  // when one that docks a pane does. The phone keeps its read-only band and waits with it.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (e.surface === 'mobile' || e.viewport?.isFullscreen === false) return attached
    if (await read($, awaitingWindow)) await openWaiting($)
    return attached
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
    await resetBoard($)
    await show($, target)
    const opened = await openAsked($)
    // A pane whose tree the surface refused is closed again; give the first draw a moment.
    await $.clock.sleep(1500)
    const pane = (await $.ui.panes()).find(one => one.id === 'jobs')
    return {
      result: json({
        opened: opened.isPlaced
          ? 'placed'
          : isWindowless(opened)
            ? 'not placed yet: no window that shows panes is attached; it opens as soon as one attaches'
            : `not placed: ${opened.reason}`,
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

  // Every Claude in Chrome call passes the Chrome guard, and so does every call a subagent makes
  // (a background prefill's are held to its own tools). A guard that fails before the call
  // refuses a prefill's call rather than let it through; one that fails after keeps its result.
  on('tool.call', async ($, e, next) => {
    const call = chromeCall(e.tool, toolArgs(e))
    if (!call && e.agentId === undefined) return next(e)
    const refused = await guardChrome($, e.agentId, e.tool, call)
    if (refused) return { deny: refused }
    const result = await next(e)
    // A tab it fails to record is one the prefill may not use: refused, never unguarded.
    if (call && e.agentId && result.text) {
      await keepTab($, e.agentId, call, result.text).catch(() => undefined)
    }
    return result
  }).catch(async ($, e, next) => {
    if (next.called || e.agentId === undefined) return next(e)
    // Where even the record cannot be read, a subagent's call is taken for a prefill's.
    const guards = await read($, prefills).catch(() => undefined)
    if (guards && !guards.some(one => one.agentId === e.agentId)) return next(e)
    return { deny: 'The Chrome guard could not check this call, so it was not made; try again.' }
  })

  // After the guard above, which holds it to the caller's own tab.
  on('tool.call', { tool: 'mcp__job-tracker__deep_form' }, async ($, e) => {
    const step = formStep(toolArgs(e))
    if ('error' in step) return { result: step.error }
    const run: RunStep = async one => {
      const args = { action: 'javascript_exec', tabId: one.tabId, text: formScript(one) }
      const page = await $.mcp.call(CHROME_SERVER, 'javascript_tool', args)
      // Its first block is the script's result; the next is Claude in Chrome's note on the tabs.
      const first = page.content.find(block => block.type === 'text')
      return first?.text ?? ''
    }
    return { result: await formResult(step, run) }
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
    return next({ ...e, context: [...(e.context ?? []), nudgeContext(named)] })
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
    const text = bandText(counts({ version: 1, leads: current.leads }, await $.clock.now()))
    if (!text) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isReadOnly = e.surface === 'mobile'
    // Keep what the plugins beneath drew: the band is shared with other mods.
    const below = await next(e)
    return (
      <Box key="band-stack" flexDirection="column">
        {below}
        <Box key="band" flexDirection="row">
          {isReadOnly ? (
            <Text>{`● ${text}`}</Text>
          ) : (
            <Button
              key="open-jobs"
              plain
              onPress={() =>
                void resetBoard($)
                  .then(() => show($, { kind: 'board' }))
                  .then(() => openAsked($))
              }
            >
              <Text color="claude">●</Text> {text} <Text dimColor>· /jobs</Text>
            </Button>
          )}
        </Box>
      </Box>
    )
  })

  // A drawing that fails (throws, overruns its budget, or returns a tree the surface refuses)
  // shows why and a way back to the board, never a blank pane.
  on('ui.render', { component: 'Pane', requestId: 'jobs' }, async ($, e) => {
    const started = await $.clock.now()
    try {
      const tree = await drawPane($, e)
      await noteFirstDraw($, e.surface, started)
      return tree
    } catch (error) {
      return paneFailure($, e, describeError(error))
    }
  }).catch(($, e, next) => {
    const { kind, message } = next.error
    return paneFailure($, e, `${kind}${message ? `: ${message}` : ''}`)
  })
}

/** Whether this load's first drawing of the pane has been reported. */
let isFirstDrawNoted = false

/**
 * Says once a load that the pane drew, on which surface and how fast, so a blank pane with no
 * such line is one the hook never ran for, and a blank pane after it one the surface refused.
 */
async function noteFirstDraw($: EngineInterface, surface: string, started: number) {
  if (isFirstDrawNoted) return
  isFirstDrawNoted = true
  const ms = Math.round((await $.clock.now()) - started)
  try {
    $.ui.log(`job-tracker: the board drew on ${surface} in ${ms} ms`)
  } catch {
    // a report that cannot go out does not stop the drawing
  }
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
    // Under `re-entry` a `.catch` handler's own `$` calls reject: the tree below still draws.
    try {
      $.ui.log(`job-tracker: the board could not draw: ${why}`)
      $.ui.toast('job-tracker: the board could not draw; the pane says why.')
    } catch {
      // nothing more to report through
    }
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
            void show($, { kind: 'board' })
              .then(() => resetBoard($))
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
  const revising = (await read($, drafts)).filter(
    one => one.kind === 'revise' && now - one.at < DRAFT_FOR_MS,
  )
  const ctx: ViewContext = {
    el,
    surface: e.surface,
    board: current,
    now: current.loadedAt,
    columns: e.props.bodyColumns,
    busy: await read($, busy),
    passing: await read($, passing),
    clarifying: await read($, clarifying),
    revising: revising.map(one => one.leadId),
    queued: (await read($, sent)).filter(one => isLive(one, now)).map(one => one.label),
    act: isReadOnly ? undefined : all,
    nav: {
      open: all.open,
      board: all.board,
      proposals: all.proposals,
      review: all.review,
      tab: all.tab,
      stage: all.stage,
      more: all.more,
    },
  }
  if (at.kind === 'lead') return leadView(ctx, at.id)
  if (at.kind === 'package') return packageView(ctx, at.id, at.tab, await read($, pkg))
  if (at.kind === 'proposals') return proposalsView(ctx)
  return boardView(ctx, {
    tab: await read($, boardTab),
    stage: await read($, stage),
    shown: await read($, shown),
  })
}
