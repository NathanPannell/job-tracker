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
  addLeads,
  appendEvent,
  correctScore,
  counts,
  eventId,
  isColumn,
  markMentioned,
  moveLead,
  patchLead,
  snoozeLead,
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
import type { Change, Data } from './store.ts'
import { init, readData, transact } from './store.ts'

export { init }

const now = () => new Date().toISOString()

/** Writes a move, pass, score or snooze result: the lead and its feedback event together. */
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
    .sort((a, b) => b.fitScore - a.fitScore)
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
  /** Added leads scored 90 or more: the ones worth a push notification. */
  alerts: Pick<Lead, 'id' | 'company' | 'role' | 'fitScore'>[]
}

export function add(dir: string, incoming: IncomingLead[], threshold: string | number = 60) {
  if (!Array.isArray(incoming)) throw new Error('add takes a JSON array of leads')
  const at = now()
  return transact<AddSummary>(dir, data => {
    const result = addLeads(data.leads, incoming, at, Number(threshold))
    const alerts = result.leads.leads
      .filter(lead => result.added.includes(lead.id) && lead.fitScore >= 90)
      .map(({ id, company, role, fitScore }) => ({ id, company, role, fitScore }))
    return {
      write: { leads: result.leads },
      result: { added: result.added, updated: result.updated, dropped: result.dropped, alerts },
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

export function snooze(dir: string, id: string, days: string | number) {
  const until = new Date(Date.now() + Number(days) * 86_400_000).toISOString()
  return transact(dir, data => commit(data, snoozeLead(data.leads, id, until, now()), id))
}

export function patch(dir: string, id: string, fields: LeadPatch, by = 'model') {
  return transact(dir, data =>
    commit(data, patchLead(data.leads, id, fields, now(), by as Actor), id),
  )
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
  'snooze',
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

/**
 * Records a lead's package from the files in `packages/<id>/`, renders the résumé preview and
 * diff, snapshots the draft, and moves the card to Ready to review (or `column`).
 */
export function registerPackage(dir: string, id: string, options: PackageOptions = {}) {
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
  return transact<Application>(dir, data => {
    const lead = data.leads.leads.find(one => one.id === id)
    if (!lead) throw new Error(`No lead ${id}`)
    const existing = data.applications.applications.find(one => one.leadId === id)
    const draftId = options.draftId ?? existing?.warmIntroDraftId
    const application: Application = {
      leadId: id,
      dir: `packages/${id}`,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      files,
      status: column === 'ready' ? 'ready' : (existing?.status ?? 'drafting'),
      ...(existing?.submittedAt ? { submittedAt: existing.submittedAt } : {}),
      ...(draftId ? { warmIntroDraftId: draftId } : {}),
    }
    const moved: MoveResult =
      lead.column === column
        ? { leads: data.leads }
        : moveLead(data.leads, id, column, at, 'package')
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
 * Reads every board in `profile/ats-boards.json`, keeps the postings workable from Victoria
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
