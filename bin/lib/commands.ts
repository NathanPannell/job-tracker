// What `bin/jobs.ts` does, one function per command. Each takes the data folder and plain
// arguments and returns a JSON-able result; the CLI prints it.
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  ADD_MIN_SCORE,
  addLeads,
  appendEvent,
  archiveStale,
  byScore,
  checkSummary,
  COLUMN_TITLES,
  correctScore,
  counts,
  eventId,
  ghostSilent,
  hasBlurb,
  hasHighlights,
  hasTagline,
  isColumn,
  markMentioned,
  missingSummaries,
  moveLead,
  patchLead,
} from '../../hooks/lib/model.ts'
import type {
  Actor,
  Application,
  Column,
  Counts,
  FeedbackEvent,
  FeedbackKind,
  IncomingLead,
  Lead,
  LeadPatch,
  MoveResult,
  PackageFiles,
  Proposal,
} from '../../hooks/lib/model.ts'
import { fetchBoards, isReachable } from './ats.ts'
import type { Ats, Board, Fetch, Posting } from './ats.ts'
import { renderPreview } from './preview.ts'
import type { Run } from './preview.ts'
import type { Change, Data } from './store.ts'
import { init, readData, transact, withLock, writeAtomic } from './store.ts'

export { init }

const now = () => new Date().toISOString()

/** Writes a move, pass or score result: the lead and its feedback event together. */
function commit(data: Data, result: MoveResult, id: string): Change<Lead | undefined> {
  if (result.error) throw new Error(result.error)
  return {
    write: {
      leads: result.leads,
      ...(result.event ? { feedback: appendEvent(data.feedback, result.event) } : {}),
    },
    result: result.leads.leads.find(lead => lead.id === id),
  }
}

export type ListOptions = { column?: string; min?: string | number; limit?: string | number }

export function list(dir: string, { column, min, limit }: ListOptions = {}): Lead[] {
  const { leads } = readData(dir, 'leads')
  return leads
    .filter(lead => (column ? lead.column === column : true))
    .filter(lead => (min !== undefined ? lead.fitScore >= Number(min) : true))
    .sort(byScore)
    .slice(0, limit !== undefined ? Number(limit) : undefined)
}

export function summary(dir: string): Counts {
  return counts(readData(dir, 'leads'), Date.now())
}

/** Everything scout should skip: what is already on the board, in any column. */
export function seen(dir: string) {
  return readData(dir, 'leads').leads.map(({ id, company, role, url, column }) => ({
    id,
    company,
    role,
    url,
    column,
  }))
}

export type AddSummary = {
  added: string[]
  updated: string[]
  dropped: string[]
  /** New leads moved to Archived: their posting went up over two weeks ago. */
  archived: string[]
  /** Applied leads marked ghosted: no reply a month after they were submitted. */
  ghosted: string[]
  /** Added leads with a fit score of 90 or more: worth a push notification. */
  alerts: Pick<Lead, 'id' | 'company' | 'role' | 'fitScore'>[]
  /** Leads added without the tagline they came with, and why it was refused. */
  warnings: string[]
}

export function add(
  dir: string,
  incoming: IncomingLead[],
  threshold: string | number = ADD_MIN_SCORE,
) {
  if (!Array.isArray(incoming)) throw new Error('add takes a JSON array of leads')
  const warnings: string[] = []
  const checked = incoming.map(one => {
    const error = checkSummary(one)
    if (!error) return one
    // A bad tagline costs only itself: the lead goes on without it, for the backfill to write.
    const { tagline, ...rest } = one
    if (tagline !== undefined && !checkSummary(rest)) {
      warnings.push(`${one.company} — ${one.role}: ${error}; added without it`)
      return rest
    }
    throw new Error(`${one.company} — ${one.role}: ${error}`)
  })
  const at = now()
  return transact<AddSummary>(dir, data => {
    const merged = addLeads(data.leads, checked, at, Number(threshold))
    const swept = sweep({ ...data, leads: merged.leads }, at)
    const result = { ...merged, leads: swept.leads }
    const alerts = result.leads.leads
      .filter(lead => result.added.includes(lead.id))
      .filter(lead => lead.fitScore >= 90)
      .map(({ id, company, role, fitScore }) => ({ id, company, role, fitScore }))
    return {
      write: {
        leads: result.leads,
        ...(swept.ghosted.length > 0 ? { feedback: swept.feedback } : {}),
      },
      result: {
        added: result.added,
        updated: result.updated,
        dropped: result.dropped,
        archived: swept.archived,
        ghosted: swept.ghosted,
        alerts,
        warnings,
      },
    }
  })
}

/**
 * The board's own moves, time-based and run whenever the board or the CLI is used: stale New
 * leads to Archived (`archiveStale`), and Applied leads with no reply a month on to Ghosted
 * (`ghostSilent`).
 */
function sweep(data: Pick<Data, 'leads' | 'applications' | 'feedback'>, at: string) {
  const stale = archiveStale(data.leads, at)
  const silent = ghostSilent(stale.leads, data.applications, data.feedback, at)
  return { ...silent, archived: stale.archived }
}

/**
 * Moves New leads whose posting went up over two weeks ago to Archived, and marks Applied leads
 * with no reply a month after submitting ghosted; prints their ids.
 */
export function archive(dir: string): { archived: string[]; ghosted: string[] } {
  return transact(dir, data => {
    const { leads, feedback, archived, ghosted } = sweep(data, now())
    return {
      write: {
        ...(archived.length + ghosted.length > 0 ? { leads } : {}),
        ...(ghosted.length > 0 ? { feedback } : {}),
      },
      result: { archived, ghosted },
    }
  })
}

export type MoveOptions = { reason?: string; by?: string; note?: string }

export function move(dir: string, id: string, column: string, options: MoveOptions = {}) {
  if (!isColumn(column)) throw new Error(`Unknown column ${column}`)
  const by = (options.by ?? 'user') as Actor
  return transact(dir, data =>
    commit(
      data,
      moveLead(data.leads, id, column, now(), by, {
        passReason: options.reason,
        note: options.note,
      }),
      id,
    ),
  )
}

export function score(dir: string, id: string, correction: string) {
  if (correction !== 'too-high' && correction !== 'too-low') {
    throw new Error('A score correction is too-high or too-low')
  }
  return transact(dir, data => commit(data, correctScore(data.leads, id, correction, now()), id))
}

export function patch(dir: string, id: string, fields: LeadPatch, by = 'model') {
  return transact(dir, data =>
    commit(data, patchLead(data.leads, id, fields, now(), by as Actor), id),
  )
}

export type SummaryInput = Pick<Lead, 'id' | 'companyBlurb' | 'tagline' | 'roleHighlights'>

/**
 * Without input, the open leads that lack a company blurb, tagline or role highlights, for scout
 * to fill. With an array of `{ id, companyBlurb?, tagline?, roleHighlights? }`, fills the fields
 * each lead lacks, in one transaction; a field already written is kept (`patch` replaces one on
 * purpose).
 */
export function summaries(dir: string): ReturnType<typeof missingSummaries>
export function summaries(
  dir: string,
  input: SummaryInput[] | undefined,
): ReturnType<typeof missingSummaries> | { updated: string[]; errors: string[] }
export function summaries(dir: string, input?: SummaryInput[]) {
  if (input === undefined) return missingSummaries(readData(dir, 'leads'))
  if (!Array.isArray(input)) throw new Error('summaries takes a JSON array')
  const at = now()
  return transact(dir, data => {
    let leads = data.leads
    const updated: string[] = []
    const errors: string[] = []
    for (const entry of input as unknown[]) {
      const { id, companyBlurb, tagline, roleHighlights } = (entry ?? {}) as Partial<SummaryInput>
      if (typeof id !== 'string') {
        errors.push(`${JSON.stringify(entry)}: needs an id`)
        continue
      }
      const lead = leads.leads.find(one => one.id === id)
      const isEmpty = (value: unknown) =>
        value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
      const fields: LeadPatch = {
        ...(!isEmpty(companyBlurb) && !(lead && hasBlurb(lead)) ? { companyBlurb } : {}),
        ...(!isEmpty(tagline) && !(lead && hasTagline(lead)) ? { tagline } : {}),
        ...(!isEmpty(roleHighlights) && !(lead && hasHighlights(lead)) ? { roleHighlights } : {}),
      }
      const result = patchLead(leads, id, fields, at, 'scout')
      if (result.error) errors.push(`${id}: ${result.error}`)
      else if (result.leads !== leads) {
        leads = result.leads
        updated.push(id)
      }
    }
    return { write: { leads }, result: { updated, errors } }
  })
}

export function mention(dir: string, ids: string[]) {
  return transact(dir, data => ({
    write: { leads: markMentioned(data.leads, ids, now()) },
    result: { mentioned: ids },
  }))
}

const FEEDBACK_KINDS: readonly FeedbackKind[] = [
  'pass',
  'score-too-high',
  'score-too-low',
  'move',
  'outcome',
  'package-edit',
]

export type FeedbackInput = { leadId: string; kind: string; reason?: string }

export function feedback(dir: string, { leadId, kind, reason }: FeedbackInput) {
  if (!FEEDBACK_KINDS.includes(kind as FeedbackKind))
    throw new Error(`Unknown feedback kind ${kind}`)
  const at = now()
  return transact<FeedbackEvent>(dir, data => {
    const lead = data.leads.leads.find(one => one.id === leadId)
    if (!lead) throw new Error(`No lead ${leadId}`)
    const event: FeedbackEvent = {
      id: eventId(at, leadId, kind),
      at,
      leadId,
      kind: kind as FeedbackKind,
      ...(reason ? { reason } : {}),
      source: lead.source,
      fitScore: lead.fitScore,
    }
    return { write: { feedback: appendEvent(data.feedback, event) }, result: event }
  })
}

const PACKAGE_FILES: Record<Exclude<keyof PackageFiles, 'preview'>, string> = {
  resumeTex: 'resume.tex',
  resumePdf: 'resume.pdf',
  resumeDiff: 'resume.diff',
  coverLetter: 'cover-letter.md',
  answers: 'answers.md',
  brief: 'company-brief.md',
  warmIntro: 'warm-intro.md',
}

/** A unified diff of two files as `git diff --no-index` gives it, hunks only; '' when equal. */
export function diffFiles(before: string, after: string, context = 2): string {
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', `-U${context}`, before, after], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return ''
  } catch (error) {
    // git diff --no-index exits 1 when the files differ, with the diff on stdout.
    const text = String((error as { stdout?: string }).stdout ?? '')
    const at = text.indexOf('@@')
    return at < 0 ? '' : text.slice(at)
  }
}

/** The tailored résumé against the master, saved as `resume.diff` in the package. */
export function resumeDiff(dir: string, id: string): string {
  const pkg = join(dir, 'packages', id)
  const master = join(dir, 'profile', 'master-resume.tex')
  const tailored = join(pkg, 'resume.tex')
  if (!existsSync(master) || !existsSync(tailored)) return ''
  const hunks = diffFiles(master, tailored)
  writeFileSync(join(pkg, 'resume.diff'), hunks)
  return hunks
}

/** Copies the drafted text files into `.draft/`, so learn can diff them against the person's edits. */
function snapshotDraft(pkg: string): void {
  mkdirSync(join(pkg, '.draft'), { recursive: true })
  for (const name of Object.values(PACKAGE_FILES)) {
    if (name.endsWith('.pdf') || name.endsWith('.diff')) continue
    if (existsSync(join(pkg, name))) copyFileSync(join(pkg, name), join(pkg, '.draft', name))
  }
}

export type PackageOptions = { column?: string; draftId?: string; redraft?: boolean }

/** The registered application, the column the card ended in, and why it stayed when it did. */
export type PackageResult = Application & { column: Column; notice?: string }

/**
 * Records a lead's package from the files in `packages/<id>/`, renders the résumé preview and
 * diff, snapshots the draft, and moves the card to Ready to review (or `column`).
 *
 * The card moves only from Drafting, where the package skill put it when the build began. In any
 * other column the person (or another flow) moved it during the build, most often to Archived or
 * Passed, so the files are still registered but the card stays where it is, with a `notice`.
 */
export function registerPackage(
  dir: string,
  id: string,
  options: PackageOptions = {},
): PackageResult {
  const column = (options.column ?? 'ready') as Column
  if (!isColumn(column)) throw new Error(`Unknown column ${String(column)}`)
  const pkg = join(dir, 'packages', id)
  if (!existsSync(pkg)) throw new Error(`No package folder ${pkg}`)
  if (existsSync(join(pkg, 'resume.tex'))) resumeDiff(dir, id)
  const preview = existsSync(join(pkg, 'resume.pdf'))
    ? renderPreview(join(pkg, 'resume.pdf'), join(pkg, 'preview')).map(name => `preview/${name}`)
    : []
  if (options.redraft || !existsSync(join(pkg, '.draft'))) snapshotDraft(pkg)
  const files: PackageFiles = {}
  for (const [role, name] of Object.entries(PACKAGE_FILES) as [
    keyof typeof PACKAGE_FILES,
    string,
  ][]) {
    if (existsSync(join(pkg, name))) files[role] = name
  }
  if (preview.length > 0) files.preview = preview
  const at = now()
  return transact<PackageResult>(dir, data => {
    const lead = data.leads.leads.find(one => one.id === id)
    if (!lead) throw new Error(`No lead ${id}`)
    const stays = lead.column !== column && lead.column !== 'drafting'
    const ends = stays ? lead.column : column
    const existing = data.applications.applications.find(one => one.leadId === id)
    const draftId = options.draftId ?? existing?.warmIntroDraftId
    const application: Application = {
      leadId: id,
      dir: `packages/${id}`,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      files,
      status: ends === 'ready' ? 'ready' : (existing?.status ?? 'drafting'),
      ...(existing?.submittedAt ? { submittedAt: existing.submittedAt } : {}),
      ...(draftId ? { warmIntroDraftId: draftId } : {}),
    }
    const moved: MoveResult =
      lead.column === ends ? { leads: data.leads } : moveLead(data.leads, id, ends, at, 'package')
    if (moved.error) throw new Error(moved.error)
    return {
      write: {
        applications: {
          ...data.applications,
          applications: [
            ...data.applications.applications.filter(one => one.leadId !== id),
            application,
          ],
        },
        leads: moved.leads,
        ...(moved.event ? { feedback: appendEvent(data.feedback, moved.event) } : {}),
      },
      result: {
        ...application,
        column: ends,
        ...(stays
          ? {
              notice:
                `Package registered, but the card stays in ${COLUMN_TITLES[ends]}, where it ` +
                `was put by hand: only a card still in Drafting is moved to ` +
                `${COLUMN_TITLES[column]}.`,
            }
          : {}),
      },
    }
  })
}

/**
 * Renders a registered package's résumé preview again and records its pages, changing nothing
 * else: for packages drawn before the preview fitted the pane.
 */
export function rerenderPreview(dir: string, id: string, run?: Run): Application {
  const pkg = join(dir, 'packages', id)
  const preview = renderPreview(join(pkg, 'resume.pdf'), join(pkg, 'preview'), run).map(
    name => `preview/${name}`,
  )
  return transact<Application>(dir, data => {
    const existing = data.applications.applications.find(one => one.leadId === id)
    if (!existing) throw new Error(`No package registered for ${id}`)
    const application = { ...existing, files: { ...existing.files, preview } }
    return {
      write: {
        applications: {
          ...data.applications,
          applications: data.applications.applications.map(one =>
            one.leadId === id ? application : one,
          ),
        },
      },
      result: application,
    }
  })
}

/** The person submitted it: the card moves to Applied with a follow-up a week out. */
export function submitted(dir: string, id: string) {
  const at = now()
  const followUpAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
  return transact(dir, data => {
    const moved = moveLead(data.leads, id, 'applied', at, 'submit')
    if (moved.error || !moved.event) throw new Error(moved.error ?? `No lead ${id}`)
    const leads = patchLead(moved.leads, id, { followUpAt }, at, 'submit').leads
    return {
      write: {
        leads,
        applications: {
          ...data.applications,
          applications: data.applications.applications.map(one =>
            one.leadId === id
              ? { ...one, status: 'submitted' as const, submittedAt: at, updatedAt: at }
              : one,
          ),
        },
        feedback: appendEvent(data.feedback, moved.event),
      },
      result: { id, followUpAt },
    }
  })
}

export type ProposalInput = Pick<Proposal, 'summary' | 'funnel' | 'changes'> & { id?: string }

export function propose(dir: string, input: ProposalInput) {
  if (!Array.isArray(input.changes)) throw new Error('A proposal needs a changes array')
  const at = now()
  const id = input.id ?? `proposal-${at.slice(0, 10)}`
  return transact<Proposal>(dir, data => {
    const entry: Proposal = {
      id,
      createdAt: at,
      status: 'pending',
      summary: input.summary,
      funnel: input.funnel,
      changes: input.changes,
    }
    return {
      write: {
        proposals: {
          ...data.proposals,
          proposals: [...data.proposals.proposals.filter(one => one.id !== id), entry],
        },
      },
      result: entry,
    }
  })
}

/** Approves or rejects a pending proposal; approving appends each change to its profile file. */
export function decide(dir: string, id: string, decision: string) {
  if (decision !== 'approve' && decision !== 'reject') throw new Error('Decide approve or reject')
  const at = now()
  return transact(dir, data => {
    const proposal = data.proposals.proposals.find(one => one.id === id)
    if (!proposal) throw new Error(`No proposal ${id}`)
    if (proposal.status !== 'pending')
      throw new Error(`Proposal ${id} is already ${proposal.status}`)
    if (decision === 'approve') {
      mkdirSync(join(dir, 'profile'), { recursive: true })
      for (const change of proposal.changes) {
        const file = change.file === 'preferences.md' ? 'preferences.md' : 'learnings.md'
        appendFileSync(
          join(dir, 'profile', file),
          `\n\n## ${change.title} (approved ${at.slice(0, 10)})\n\n${change.text.trim()}\n`,
        )
      }
    }
    const status = decision === 'approve' ? ('approved' as const) : ('rejected' as const)
    return {
      write: {
        proposals: {
          ...data.proposals,
          proposals: data.proposals.proposals.map(one =>
            one.id === id ? { ...one, status, decidedAt: at } : one,
          ),
        },
      },
      result: { id, status },
    }
  })
}

export type PackageEdit = { leadId: string; file: string; diff: string }

/** The person's edits to each drafted package: a diff per file changed since it was drafted. */
export function edits(dir: string): PackageEdit[] {
  return readData(dir, 'applications').applications.flatMap(app => {
    const draft = join(dir, app.dir, '.draft')
    if (!existsSync(draft)) return []
    return readdirSync(draft).flatMap(name => {
      const current = join(dir, app.dir, name)
      if (!existsSync(current)) return []
      const diff = diffFiles(join(draft, name), current, 1)
      return diff ? [{ leadId: app.leadId, file: name, diff }] : []
    })
  })
}

/** Reads a JSON argument: inline JSON, or `@path` to a file holding it. */
export function readJsonArg<T>(arg: string | undefined): T {
  if (arg === undefined) throw new Error('Missing JSON argument')
  return JSON.parse(arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg) as T
}

export type AtsSummary = {
  file: string
  boards: number
  postings: number
  fresh: number
  errors: { company: string; ats: Ats; slug: string; error: string }[]
}

/**
 * Reads every board in `profile/ats-boards.json`, keeps the postings workable from Canada
 * that are not on the board yet, and writes them to `scout/ats-<date>.json` for scoring.
 */
export async function ats(dir: string, options: { all?: boolean; fetcher?: Fetch } = {}) {
  const path = join(dir, 'profile', 'ats-boards.json')
  if (!existsSync(path)) throw new Error(`No ${path}: list boards as [{ company, ats, slug }]`)
  const boards = JSON.parse(readFileSync(path, 'utf8')) as Board[]
  const results = await fetchBoards(boards, options.fetcher)
  const known = new Set(seen(dir).flatMap(one => [one.url.toLowerCase(), one.id]))
  const postings: Posting[] = results.flatMap(result => result.postings)
  const fresh = postings
    .filter(posting => options.all || isReachable(posting))
    .filter(posting => !known.has(posting.url.toLowerCase()))
  const day = new Date().toISOString().slice(0, 10)
  mkdirSync(join(dir, 'scout'), { recursive: true })
  const file = join(dir, 'scout', `ats-${day}.json`)
  writeFileSync(
    file,
    `${JSON.stringify(fresh, null, 2)}
`,
  )
  const summary: AtsSummary = {
    file,
    boards: boards.length,
    postings: postings.length,
    fresh: fresh.length,
    errors: results
      .filter(result => result.error)
      .map(result => ({ ...result.board, error: result.error ?? '' })),
  }
  return summary
}

/** Adds a public board to `profile/ats-boards.json` so `ats` reads it from the next run on. */
export function addBoard(dir: string, company: string, ats: string, slug: string) {
  if (ats !== 'greenhouse' && ats !== 'lever' && ats !== 'ashby') {
    throw new Error('The ATS is greenhouse, lever or ashby')
  }
  if (!company.trim() || !slug.trim()) throw new Error('A board needs a company and a slug')
  const path = join(dir, 'profile', 'ats-boards.json')
  return withLock(dir, () => {
    const boards = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Board[]) : []
    const key = slug.trim().toLowerCase()
    const existing = boards.find(one => one.ats === ats && one.slug.trim().toLowerCase() === key)
    if (existing) return { added: false, board: existing, boards: boards.length }
    const board: Board = { company: company.trim(), ats, slug: slug.trim() }
    const next = [...boards, board]
    writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`)
    return { added: true, board, boards: next.length }
  })
}

/** Tries a company's slug on each ATS, to find which public board it uses. */
export async function probe(slug: string, company = slug, fetcher?: Fetch) {
  const boards: Board[] = (['greenhouse', 'lever', 'ashby'] as const).map(one => ({
    company,
    ats: one,
    slug,
  }))
  const results = await fetchBoards(boards, fetcher)
  return results.map(result => ({
    ats: result.board.ats,
    slug,
    found: !result.error,
    postings: result.postings.length,
    reachable: result.postings
      .filter(isReachable)
      .map(one => `${one.role} — ${one.location}`)
      .slice(0, 10),
  }))
}
