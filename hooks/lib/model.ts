// The data contract shared by the hooks module, the jobs CLI and the skills, and the pure
// logic over it: board moves, feedback events, counts and the once-a-session nudge. Nothing
// here touches a file; the callers read and write.

import type {
  Actor,
  ApplicationsFile,
  Column,
  FeedbackEvent,
  FeedbackFile,
  Lead,
  LeadsFile,
  ProposalsFile,
} from '../../types/index.d.ts'

export type {
  Actor,
  Application,
  ApplicationsFile,
  Column,
  FeedbackEvent,
  FeedbackFile,
  FeedbackKind,
  HistoryEntry,
  Lead,
  LeadsFile,
  PackageFiles,
  Proposal,
  ProposalChange,
  ProposalsFile,
} from '../../types/index.d.ts'

export const COLUMNS = [
  'new',
  'shortlisted',
  'drafting',
  'ready',
  'applied',
  'interviewing',
  'offer',
  'passed',
  'archived',
] as const satisfies readonly Column[]

/** The columns of the board's main row, in order; Passed and Archived sit apart. */
export const PIPELINE: readonly Column[] = [
  'new',
  'shortlisted',
  'drafting',
  'ready',
  'applied',
  'interviewing',
  'offer',
]

export const COLUMN_TITLES: Record<Column, string> = {
  new: 'New',
  shortlisted: 'Shortlisted',
  drafting: 'Drafting',
  ready: 'Ready to review',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  passed: 'Passed',
  archived: 'Archived',
}

export const PASS_REASONS = [
  'Too senior',
  'Wrong stack',
  'Location',
  'Pay too low',
  'Not a product company',
  'Not interested',
  'Already applied',
  'Posting closed',
] as const

export const emptyLeads = (): LeadsFile => ({ version: 1, leads: [] })
export const emptyApplications = (): ApplicationsFile => ({ version: 1, applications: [] })
export const emptyFeedback = (): FeedbackFile => ({ version: 1, events: [] })
export const emptyProposals = (): ProposalsFile => ({ version: 1, proposals: [] })

export const isColumn = (value: unknown): value is Column =>
  typeof value === 'string' && (COLUMNS as readonly string[]).includes(value)

/** A stable id from company and role, so a re-found posting dedupes onto its card. */
export function leadId(company: string, role: string): string {
  const slug = `${company}-${role}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'lead'
}

const normalizeUrl = (url: string) =>
  url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()

/** The column left or right of `column` along the pipeline; undefined at either end. */
export function neighbour(column: Column, direction: -1 | 1): Column | undefined {
  const at = PIPELINE.indexOf(column)
  if (at < 0) return direction === -1 ? 'new' : undefined
  return PIPELINE[at + direction]
}

export type MoveResult = { leads: LeadsFile; event?: FeedbackEvent; error?: string }

/** Moves a lead to `to`, records it in its history and returns the feedback event for it. */
export function moveLead(
  file: LeadsFile,
  id: string,
  to: Column,
  at: string,
  by: Actor,
  extra: { passReason?: string; note?: string } = {},
): MoveResult {
  const lead = file.leads.find(one => one.id === id)
  if (!lead) return { leads: file, error: `No lead ${id}` }
  if (to === 'passed' && !extra.passReason) {
    return { leads: file, error: 'Passing a lead needs a reason' }
  }
  const from = lead.column
  const moved: Lead = {
    ...lead,
    column: to,
    passReason: to === 'passed' ? extra.passReason : lead.passReason,
    snoozedUntil: to === lead.column ? lead.snoozedUntil : undefined,
    history: [
      ...lead.history,
      { at, by, action: 'moved', from, to, ...(extra.note ? { note: extra.note } : {}) },
    ],
  }
  const event: FeedbackEvent = {
    id: eventId(at, id, to === 'passed' ? 'pass' : `move-${from}-${to}`),
    at,
    leadId: id,
    kind: to === 'passed' ? 'pass' : 'move',
    from,
    to,
    source: lead.source,
    fitScore: lead.fitScore,
    ...(to === 'passed' ? { reason: extra.passReason } : {}),
  }
  return { leads: replaceLead(file, moved), event }
}

export function correctScore(
  file: LeadsFile,
  id: string,
  correction: 'too-high' | 'too-low',
  at: string,
): MoveResult {
  const lead = file.leads.find(one => one.id === id)
  if (!lead) return { leads: file, error: `No lead ${id}` }
  const corrected: Lead = {
    ...lead,
    scoreCorrection: correction,
    history: [...lead.history, { at, by: 'user', action: 'scored', note: correction }],
  }
  const kind = correction === 'too-high' ? 'score-too-high' : 'score-too-low'
  const event: FeedbackEvent = {
    id: eventId(at, id, kind),
    at,
    leadId: id,
    kind,
    source: lead.source,
    fitScore: lead.fitScore,
  }
  return { leads: replaceLead(file, corrected), event }
}

export function snoozeLead(file: LeadsFile, id: string, until: string, at: string): MoveResult {
  const lead = file.leads.find(one => one.id === id)
  if (!lead) return { leads: file, error: `No lead ${id}` }
  const snoozed: Lead = {
    ...lead,
    snoozedUntil: until,
    history: [...lead.history, { at, by: 'user', action: 'snoozed', note: until }],
  }
  const event: FeedbackEvent = {
    id: eventId(at, id, 'snooze'),
    at,
    leadId: id,
    kind: 'snooze',
    reason: until,
    source: lead.source,
    fitScore: lead.fitScore,
  }
  return { leads: replaceLead(file, snoozed), event }
}

export type LeadPatch = Partial<
  Pick<
    Lead,
    | 'column'
    | 'fitScore'
    | 'fitReason'
    | 'notes'
    | 'followUpAt'
    | 'snoozedUntil'
    | 'comp'
    | 'location'
    | 'url'
    | 'closesAt'
    | 'passReason'
  >
>

/** Applies a patch from the model or a skill, recording what changed. */
export function patchLead(
  file: LeadsFile,
  id: string,
  patch: LeadPatch,
  at: string,
  by: Actor,
): MoveResult {
  const lead = file.leads.find(one => one.id === id)
  if (!lead) return { leads: file, error: `No lead ${id}` }
  if (patch.column !== undefined && !isColumn(patch.column)) {
    return { leads: file, error: `Unknown column ${String(patch.column)}` }
  }
  if (patch.fitScore !== undefined && !(patch.fitScore >= 0 && patch.fitScore <= 100)) {
    return { leads: file, error: 'fitScore must be 0-100' }
  }
  const { column, ...rest } = patch
  let next: MoveResult = { leads: file }
  if (column !== undefined && column !== lead.column) {
    next = moveLead(file, id, column, at, by, {
      passReason: patch.passReason ?? (column === 'passed' ? 'Passed by the assistant' : undefined),
    })
    if (next.error) return next
  }
  const current = next.leads.leads.find(one => one.id === id) as Lead
  const changed = Object.keys(rest).filter(
    key => rest[key as keyof typeof rest] !== undefined,
  ) as (keyof typeof rest)[]
  if (changed.length === 0) return next
  const updated: Lead = {
    ...current,
    ...Object.fromEntries(changed.map(key => [key, rest[key]])),
    history: [
      ...current.history,
      {
        at,
        by,
        action: patch.fitScore !== undefined ? 'scored' : 'note',
        note: changed.join(', '),
      },
    ],
  }
  return { leads: replaceLead(next.leads, updated), event: next.event }
}

export type IncomingLead = Omit<
  Lead,
  'id' | 'column' | 'foundAt' | 'history' | 'mentionedAt' | 'passReason'
> & { id?: string }

export type AddResult = { leads: LeadsFile; added: string[]; updated: string[]; dropped: string[] }

/**
 * Merges scouted leads: dedupes by id, then by posting URL; keeps the board's column and
 * history for a lead already there; drops anything scored under `threshold`.
 */
export function addLeads(
  file: LeadsFile,
  incoming: readonly IncomingLead[],
  at: string,
  threshold: number,
): AddResult {
  const leads = [...file.leads]
  const added: string[] = []
  const updated: string[] = []
  const dropped: string[] = []
  for (const one of incoming) {
    const id = one.id ?? leadId(one.company, one.role)
    if (!(one.fitScore >= threshold)) {
      dropped.push(id)
      continue
    }
    const url = normalizeUrl(one.url)
    const at_ = leads.findIndex(
      lead => lead.id === id || (url !== '' && normalizeUrl(lead.url) === url),
    )
    if (at_ >= 0) {
      const existing = leads[at_] as Lead
      leads[at_] = {
        ...existing,
        url: one.url || existing.url,
        location: one.location || existing.location,
        comp: one.comp || existing.comp,
        closesAt: one.closesAt ?? existing.closesAt,
      }
      updated.push(existing.id)
      continue
    }
    const { id: _ignored, ...fields } = one
    void _ignored
    leads.push({
      ...fields,
      id: uniqueId(leads, id),
      column: 'new',
      foundAt: at,
      history: [{ at, by: 'scout', action: 'created', to: 'new', note: one.source }],
    })
    added.push(leads[leads.length - 1]?.id as string)
  }
  return { leads: { ...file, leads }, added, updated, dropped }
}

const uniqueId = (leads: readonly Lead[], id: string) => {
  let candidate = id
  for (let n = 2; leads.some(lead => lead.id === candidate); n += 1) candidate = `${id}-${n}`
  return candidate
}

const replaceLead = (file: LeadsFile, lead: Lead): LeadsFile => ({
  ...file,
  leads: file.leads.map(one => (one.id === lead.id ? lead : one)),
})

export const eventId = (at: string, leadId: string, kind: string) =>
  `${at.replace(/[^0-9]/g, '').slice(0, 17)}-${kind}-${leadId}`.slice(0, 120)

export function appendEvent(file: FeedbackFile, event: FeedbackEvent): FeedbackFile {
  if (file.events.some(one => one.id === event.id)) return file
  return { ...file, events: [...file.events, event] }
}

export const isSnoozed = (lead: Lead, now: number) =>
  lead.snoozedUntil !== undefined && Date.parse(lead.snoozedUntil) > now

export type Counts = { newLeads: number; readyToReview: number; followUpsDue: number }

export function counts(file: LeadsFile, now: number): Counts {
  let newLeads = 0
  let readyToReview = 0
  let followUpsDue = 0
  for (const lead of file.leads) {
    if (lead.column === 'new' && !isSnoozed(lead, now)) newLeads += 1
    if (lead.column === 'ready') readyToReview += 1
    const isWaiting = lead.column === 'applied' || lead.column === 'interviewing'
    if (isWaiting && lead.followUpAt !== undefined && Date.parse(lead.followUpAt) <= now) {
      followUpsDue += 1
    }
  }
  return { newLeads, readyToReview, followUpsDue }
}

/** The band's line, or undefined when there is nothing to say. */
export function bandText(c: Counts): string | undefined {
  if (c.newLeads + c.readyToReview + c.followUpsDue === 0) return undefined
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return [
    plural(c.newLeads, 'new lead', 'new leads'),
    `${c.readyToReview} ready to review`,
    plural(c.followUpsDue, 'follow-up due', 'follow-ups due'),
  ].join(' · ')
}

/** Leads in a column, best first; snoozed ones last. */
export function columnLeads(file: LeadsFile, column: Column, now: number): Lead[] {
  return file.leads
    .filter(lead => lead.column === column)
    .sort(
      (a, b) =>
        Number(isSnoozed(a, now)) - Number(isSnoozed(b, now)) ||
        b.fitScore - a.fitScore ||
        a.company.localeCompare(b.company),
    )
}

export const NUDGE_QUIET_MS = 3 * 60 * 60 * 1000
export const NUDGE_TOP = 3

/**
 * The leads to mention once in an unrelated conversation: new, unsnoozed, never mentioned,
 * best first; none when any lead was mentioned in the last three hours.
 */
export function leadsToMention(file: LeadsFile, now: number): Lead[] {
  const lastMention = Math.max(
    0,
    ...file.leads.map(lead => (lead.mentionedAt ? Date.parse(lead.mentionedAt) : 0)),
  )
  if (now - lastMention < NUDGE_QUIET_MS) return []
  return file.leads
    .filter(lead => lead.column === 'new' && !lead.mentionedAt && !isSnoozed(lead, now))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, NUDGE_TOP)
}

export function nudgeContext(leads: readonly Lead[]): string {
  const named = leads
    .map(lead => `${lead.company} — ${lead.role} (fit ${lead.fitScore})`)
    .join('; ')
  return [
    'Note from the job-tracker plugin, not from the user:',
    "Answer the user's actual request first and completely, exactly as you would without this note.",
    'Then end your reply with exactly one short line (under 30 words) that names these new job',
    `leads and says they are on the board at /jobs: ${named}.`,
    'Do not mention job leads anywhere else in the reply, and do not act on them unless asked.',
  ].join(' ')
}

export function markMentioned(file: LeadsFile, ids: readonly string[], at: string): LeadsFile {
  const wanted = new Set(ids)
  return {
    ...file,
    leads: file.leads.map(lead =>
      wanted.has(lead.id) && !lead.mentionedAt
        ? {
            ...lead,
            mentionedAt: at,
            history: [...lead.history, { at, by: 'model', action: 'mentioned' }],
          }
        : lead,
    ),
  }
}

/** A short age: `3h`, `2d`, `5w`. */
export function age(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso))
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return 'now'
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 21 ? `${days}d` : `${Math.floor(days / 7)}w`
}

/** Parses a JSON data file, falling back to `empty` when it is missing or unreadable. */
export function parseOr<T>(text: string | undefined, empty: () => T): T {
  if (text === undefined || text.trim() === '') return empty()
  try {
    return JSON.parse(text) as T
  } catch {
    return empty()
  }
}
