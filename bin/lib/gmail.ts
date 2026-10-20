// Which Gmail senders the scout reads, and where its last run stopped, so a weekly newsletter
// is never skipped between runs and the same alert is not read twice.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { withLock, writeAtomic } from './store.ts'

/** `alert`: the email lists job postings. `signal`: news (funding, launches) that hints at hiring. */
export type GmailKind = 'alert' | 'signal'

/** A sender family: `senders` are matched as substrings of the sender's address. */
export type GmailSource = { source: string; kind: GmailKind; senders: readonly string[] }

export const GMAIL_SOURCES: readonly GmailSource[] = [
  { source: 'gmail:linkedin', kind: 'alert', senders: ['linkedin.com'] },
  { source: 'gmail:indeed', kind: 'alert', senders: ['indeed.com'] },
  { source: 'gmail:wellfound', kind: 'alert', senders: ['wellfound.com', 'angel.co'] },
  { source: 'gmail:glassdoor', kind: 'alert', senders: ['glassdoor.com', 'glassdoor.ca'] },
  { source: 'gmail:yc', kind: 'alert', senders: ['workatastartup.com', 'ycombinator.com'] },
  { source: 'gmail:wttj', kind: 'alert', senders: ['welcometothejungle.com', 'otta.com'] },
  { source: 'gmail:bctechjobs', kind: 'alert', senders: ['bcjobs.ca', 'bctechjobs.ca'] },
  { source: 'gmail:viatec', kind: 'alert', senders: ['viatec.ca'] },
  { source: 'signal:betakit', kind: 'signal', senders: ['betakit.com'] },
  { source: 'signal:victechjournal', kind: 'signal', senders: ['victechjournal.com'] },
  { source: 'signal:vantechjournal', kind: 'signal', senders: ['vantechjournal'] },
]

/** Account mail (verify your email, password, sign-in notices) that never lists jobs. */
const NOT_JOBS = ['verify', 'verification', 'password', 'security', 'sign-in', '"sign in"']

/** How far back a first run reads, and the furthest back any run reads. */
const FIRST_RUN_DAYS = 7
const MAX_DAYS = 21
/** Each run re-reads this much before the cursor, in case Gmail indexed an email late. */
const OVERLAP_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const CURSOR_FILE = join('scout', 'gmail-cursor.json')

type Cursor = { after: string; updatedAt: string }

/** The source an email belongs to, by its sender's address; undefined for any other sender. */
export function sourceFor(sender: string): GmailSource | undefined {
  const address = sender.toLowerCase()
  return GMAIL_SOURCES.find(one => one.senders.some(token => address.includes(token)))
}

export function readCursor(dir: string): string | undefined {
  const path = join(dir, CURSOR_FILE)
  if (!existsSync(path)) return undefined
  const { after } = JSON.parse(readFileSync(path, 'utf8')) as Partial<Cursor>
  return typeof after === 'string' && !Number.isNaN(Date.parse(after)) ? after : undefined
}

export type GmailQuery = {
  /** Paste into Gmail search (`search_threads`), paging until no `nextPageToken`. */
  query: string
  /** The time the query reads from. */
  since: string
  /** True when no run has marked mail read yet. */
  firstRun: boolean
  sources: readonly GmailSource[]
}

/** The search for every job email that arrived since the last run marked mail read. */
export function gmailQuery(dir: string, now: Date = new Date()): GmailQuery {
  const cursor = readCursor(dir)
  const floor = now.getTime() - MAX_DAYS * DAY_MS
  const start = cursor
    ? Math.max(Date.parse(cursor) - OVERLAP_MS, floor)
    : now.getTime() - FIRST_RUN_DAYS * DAY_MS
  const senders = GMAIL_SOURCES.flatMap(one => one.senders.map(token => `from:${token}`))
  const query = [
    `after:${Math.floor(start / 1000)}`,
    `(${senders.join(' OR ')})`,
    `-subject:(${NOT_JOBS.join(' OR ')})`,
  ].join(' ')
  return { query, since: new Date(start).toISOString(), firstRun: !cursor, sources: GMAIL_SOURCES }
}

/**
 * Records that every job email up to `newest` (the newest email the run read) has been read.
 * The cursor only moves forward, so a run that read less never makes the next one re-read more.
 */
export function markGmailRead(dir: string, newest: string, now: Date = new Date()) {
  const time = Date.parse(newest)
  if (Number.isNaN(time)) throw new Error(`Not a date: ${newest}`)
  if (time > now.getTime() + DAY_MS) throw new Error(`${newest} is in the future`)
  return withLock(dir, () => {
    const previous = readCursor(dir)
    const after = new Date(Math.max(time, previous ? Date.parse(previous) : 0)).toISOString()
    const moved = after !== previous
    if (moved) {
      const cursor: Cursor = { after, updatedAt: now.toISOString() }
      writeAtomic(join(dir, CURSOR_FILE), `${JSON.stringify(cursor, null, 2)}\n`)
    }
    return { after, moved }
  })
}
