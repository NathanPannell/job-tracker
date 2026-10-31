// How the hooks module reaches the data folder: reads through `$.fs`, every write through
// `bin/jobs.ts` (one writer, a lock and an atomic rename), and the session values the pane draws.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { JobBoard, JobPackage, PackageTab } from '../../types/index.d.ts'
import { openQuestions, parseSaved, SAVED_ANSWERS } from './answers.ts'
import {
  emptyApplications,
  emptyFeedback,
  emptyLeads,
  emptyProposals,
  isArchivable,
  isGhostable,
  migrateLeads,
  normalizeProposal,
  parseOr,
  parseStrict,
  rejectionCount,
} from './model.ts'
import type { ApplicationsFile, FeedbackFile, LeadsFile, ProposalsFile } from './model.ts'

export const PANE = 'jobs'

export const EMPTY_BOARD: JobBoard = {
  dataDir: null,
  leads: [],
  applications: [],
  proposals: [],
  loadedAt: 0,
  error: null,
}

const board = atom({ plugin: 'job-tracker', key: 'board' } as const, EMPTY_BOARD)
const pkg = atom({ plugin: 'job-tracker', key: 'pkg' } as const, null as JobPackage | null)
const busy = atom({ plugin: 'job-tracker', key: 'busy' } as const, null as string | null)
/** Leads this session already asked `jobs archive` to take, so a failure is not retried. */
const swept = atom({ plugin: 'job-tracker', key: 'swept' } as const, [] as string[])

/** The data folder: `JOB_TRACKER_DATA`, without a trailing separator; null when unset. */
export async function dataDir($: EngineInterface): Promise<string | null> {
  const dir = await $.env.get('JOB_TRACKER_DATA')
  return dir ? dir.replace(/[\\/]+$/, '') : null
}

export const join = (dir: string, ...parts: string[]) => [dir, ...parts].join('/')

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return undefined
  }
}

/** What each Ready lead with a package still needs from the person (`JobBoard.openQuestions`). */
async function readyQuestions(
  $: EngineInterface,
  dir: string,
  leads: JobBoard['leads'],
  applications: JobBoard['applications'],
): Promise<Record<string, string[]>> {
  const ready = leads.flatMap(lead => {
    const app = applications.find(one => one.leadId === lead.id)
    return lead.column === 'ready' && app?.files?.answers
      ? [{ lead, path: join(dir, app.dir, app.files.answers) }]
      : []
  })
  if (ready.length === 0) return {}
  const [saved, ...answers] = await Promise.all([
    readText($, join(dir, SAVED_ANSWERS)),
    ...ready.map(one => readText($, one.path)),
  ])
  const entries = parseSaved(saved ?? '')
  return Object.fromEntries(
    ready.flatMap(({ lead }, n) => {
      // An empty file says as little as a missing one: neither is "nothing to answer".
      const text = answers[n]
      return text?.trim() ? [[lead.id, openQuestions(text, entries, lead)]] : []
    }),
  )
}

/** The rejections `feedback.json` records; undefined for a file that cannot say, never 0. */
function countRejections(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  try {
    return rejectionCount(parseStrict<FeedbackFile>(text, emptyFeedback).events)
  } catch {
    return undefined
  }
}

/**
 * Reads the data files into the board value the pane and band draw from. A New lead whose
 * posting went up over two weeks ago is archived first, and an Applied
 * lead with no reply a month after it was submitted is marked ghosted (one `jobs archive`, only
 * when there is one), so the board never shows them; a toast names the ghosted ones. Nothing runs
 * on a timer.
 */
export async function refresh($: EngineInterface, sweep = true): Promise<JobBoard> {
  const dir = await dataDir($)
  const loadedAt = await $.clock.now()
  let next: JobBoard
  if (!dir) {
    next = { ...EMPTY_BOARD, loadedAt, error: null }
  } else {
    const [leads, applications, proposals, feedback] = await Promise.all([
      readText($, join(dir, 'leads.json')),
      readText($, join(dir, 'applications.json')),
      readText($, join(dir, 'proposals.json')),
      readText($, join(dir, 'feedback.json')),
    ])
    // The CLI saves the same migration with its next write.
    const migrated = migrateLeads(
      { version: 1, leads: parseOr<LeadsFile>(leads, emptyLeads).leads ?? [] },
      new Date(loadedAt).toISOString(),
    ).leads
    const packages = parseOr<ApplicationsFile>(applications, emptyApplications).applications ?? []
    next = {
      dataDir: dir,
      leads: migrated,
      applications: packages,
      // The note is an extra: a damaged file costs the notes, never the board.
      openQuestions: await readyQuestions($, dir, migrated, packages).catch(() => ({})),
      rejections: countRejections(feedback),
      // A proposal saved before per-change decisions reads as one decision per change.
      proposals: (parseOr<ProposalsFile>(proposals, emptyProposals).proposals ?? []).map(
        normalizeProposal,
      ),
      loadedAt,
      error:
        leads === undefined ? 'No leads.json yet: run the scout skill to fill the board.' : null,
    }
  }
  await update($, board, () => next)
  if (!sweep) return next
  // Each archivable lead is tried once a session: a failed or empty archive is not respawned.
  const tried = await read($, swept)
  // The board keeps only a count from feedback.json, so a ghostable lead here may have a reply
  // recorded there: `jobs archive` checks it and leaves such a lead alone.
  const application = (id: string) => next.applications.find(one => one.leadId === id)
  const due = next.leads
    .filter(
      lead =>
        (isArchivable(lead, loadedAt) || isGhostable(lead, application(lead.id), loadedAt)) &&
        !tried.includes(lead.id),
    )
    .map(lead => lead.id)
  if (due.length === 0) return next
  await update($, swept, ids => [...ids, ...due])
  const result = await jobs($, ['archive'])
  if (!result.ok) $.ui.toast(`job-tracker: could not archive stale leads: ${result.error}`)
  else ghostedToast($, next, result.value)
  return read($, board)
}

/** Tells the person which applications the board just marked ghosted, and how to undo it. */
function ghostedToast($: EngineInterface, before: JobBoard, value: unknown) {
  const ids = (value as { ghosted?: unknown } | null)?.ghosted
  if (!Array.isArray(ids) || ids.length === 0) return
  const names = ids.map(id => {
    const lead = before.leads.find(one => one.id === id)
    return lead ? `${lead.company} — ${lead.role}` : String(id)
  })
  $.ui.toast(
    `Marked ghosted (no reply a month after applying): ${names.join(', ')}. ` +
      'Now in Archived; "Back to Applied" on the card undoes it.',
    { timeoutMs: 15_000 },
  )
}

export type RunResult = { ok: true; value: unknown } | { ok: false; error: string }

/** Runs a jobs CLI command against the data folder and refreshes the board after a write. */
export async function jobs($: EngineInterface, args: readonly string[]): Promise<RunResult> {
  const dir = await dataDir($)
  if (!dir) return { ok: false, error: 'JOB_TRACKER_DATA is not set (see SETUP.md).' }
  const script = `${$.plugin.root}/bin/jobs.ts`
  try {
    const ran = await $.process.run(['node', script, ...args, '--data', dir], {
      timeoutMs: 120_000,
    })
    // No sweep here: a failed `jobs archive` must not run itself again.
    await refresh($, false)
    if (ran.exitCode !== 0) return { ok: false, error: ran.stderr.trim() || `exit ${ran.exitCode}` }
    return { ok: true, value: ran.stdout.trim() ? JSON.parse(ran.stdout) : null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Runs a write from a pane button: shows it as busy, toasts a failure. */
export async function act($: EngineInterface, label: string, args: readonly string[]) {
  await update($, busy, () => label)
  try {
    const result = await jobs($, args)
    if (!result.ok) $.ui.toast(`job-tracker: ${result.error}`)
    return result
  } finally {
    // A busy label left set would silently block every stage button for the session.
    await update($, busy, () => null)
  }
}

const TAB_FILES: Record<
  Exclude<PackageTab, 'resume'>,
  keyof JobBoard['applications'][number]['files']
> = {
  diff: 'resumeDiff',
  cover: 'coverLetter',
  answers: 'answers',
  brief: 'brief',
  intro: 'warmIntro',
}

/** Reads a lead's package for the viewer: the résumé strips and every text file. */
export async function loadPackage($: EngineInterface, leadId: string): Promise<JobPackage> {
  const current = await refresh($)
  const app = current.applications.find(one => one.leadId === leadId)
  if (!current.dataDir || !app) {
    return { leadId, pdfPath: null, svgs: [], texts: {}, error: 'No package for this lead yet.' }
  }
  const base = join(current.dataDir, app.dir)
  const svgs: string[] = []
  for (const strip of app.files.preview ?? []) {
    const text = await readText($, join(base, strip))
    if (text !== undefined) svgs.push(text)
  }
  const texts: JobPackage['texts'] = {}
  for (const [tab, role] of Object.entries(TAB_FILES) as [
    Exclude<PackageTab, 'resume'>,
    keyof typeof app.files,
  ][]) {
    const name = app.files[role]
    if (typeof name !== 'string') continue
    const text = await readText($, join(base, name))
    if (text !== undefined) texts[tab] = text
  }
  const loaded: JobPackage = {
    leadId,
    pdfPath: app.files.resumePdf ? join(base, app.files.resumePdf) : null,
    svgs,
    texts,
    error: null,
  }
  await update($, pkg, () => loaded)
  return loaded
}

/** Opens a local file with the system's viewer (the résumé PDF). */
export async function openFile($: EngineInterface, path: string): Promise<void> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows
    ? ['explorer.exe', path.replace(/\//g, '\\')]
    : [(await $.env.get('XDG_CURRENT_DESKTOP')) ? 'xdg-open' : 'open', path]
  try {
    await $.process.run(argv, { timeoutMs: 15_000 })
  } catch (error) {
    $.ui.toast(`job-tracker: could not open ${path}: ${String(error)}`)
  }
}
