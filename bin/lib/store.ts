// The one writer of the data folder. Every change takes a lock, reads the files, applies a pure
// function from hooks/lib/model.ts and renames a temporary file over the old one, so the
// scheduled skills and the pane can write at the same time without losing either change.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import {
  emptyApplications,
  emptyFeedback,
  emptyLeads,
  emptyProposals,
  migrateLeads,
  parseStrict,
} from '../../hooks/lib/model.ts'
import type {
  ApplicationsFile,
  FeedbackFile,
  LeadsFile,
  ProposalsFile,
} from '../../hooks/lib/model.ts'

export type Data = {
  leads: LeadsFile
  applications: ApplicationsFile
  feedback: FeedbackFile
  proposals: ProposalsFile
}

export type DataName = keyof Data

export const FILES: Record<DataName, string> = {
  leads: 'leads.json',
  applications: 'applications.json',
  feedback: 'feedback.json',
  proposals: 'proposals.json',
}

const EMPTY: { [N in DataName]: () => Data[N] } = {
  leads: emptyLeads,
  applications: emptyApplications,
  feedback: emptyFeedback,
  proposals: emptyProposals,
}

const LOCK_WAIT_MS = 10_000
const LOCK_STALE_MS = 30_000

export function dataDir(dir: string | undefined = process.env.JOB_TRACKER_DATA): string {
  if (!dir) {
    throw new Error('Set JOB_TRACKER_DATA to the data folder (see SETUP.md), or pass --data <dir>.')
  }
  return dir
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Runs `fn` holding the data folder's lock file. */
export function withLock<T>(dir: string, fn: () => T): T {
  mkdirSync(dir, { recursive: true })
  const lock = join(dir, '.lock')
  const started = Date.now()
  let fd = -1
  while (fd < 0) {
    try {
      fd = openSync(lock, 'wx')
    } catch (error) {
      // EPERM: Windows refuses to open a lock file another process is deleting.
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true })
      } catch {
        // the holder released it between our open and stat
      }
      if (Date.now() - started > LOCK_WAIT_MS) {
        throw new Error(`The data folder is locked (${lock}); try again.`, { cause: error })
      }
      sleep(50)
    }
  }
  try {
    return fn()
  } finally {
    closeSync(fd)
    rmSync(lock, { force: true })
  }
}

/** Writes `text` to `path` by renaming a temporary file over it. */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, text)
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(temp, path)
      return
    } catch (error) {
      // Windows refuses a rename over a file another process holds open for a moment.
      if (attempt >= 20) {
        rmSync(temp, { force: true })
        throw error
      }
      sleep(25)
    }
  }
}

/** Reads a data file as it is on disk. */
function readRaw<N extends DataName>(dir: string, name: N): Data[N] {
  const path = join(dir, FILES[name])
  const text = existsSync(path) ? readFileSync(path, 'utf8') : undefined
  try {
    return parseStrict(text, EMPTY[name])
  } catch (error) {
    throw new Error(`${path} is not valid JSON; fix it before the board can change.`, {
      cause: error,
    })
  }
}

/**
 * Reads a data file; leads come back migrated (`migrateLeads`): out of a column the board no
 * longer has, and without a snooze or follow-up date.
 */
export function readData<N extends DataName>(dir: string, name: N): Data[N] {
  const value = readRaw(dir, name)
  return name === 'leads'
    ? (migrateLeads(value as LeadsFile, new Date().toISOString()) as Data[N])
    : value
}

export function writeData<N extends DataName>(dir: string, name: N, value: Data[N]): void {
  writeAtomic(join(dir, FILES[name]), `${JSON.stringify(value, null, 2)}\n`)
}

export type Change<R> = { write?: Partial<Data>; result: R }

/**
 * Reads, changes and writes the data files under the lock: `fn` gets every file's current
 * value and returns the values to write (any subset) and a result.
 */
export function transact<R>(dir: string, fn: (data: Data) => Change<R>): R {
  return withLock(dir, () => {
    const stored = readRaw(dir, 'leads')
    const data: Data = {
      leads: migrateLeads(stored, new Date().toISOString()),
      applications: readData(dir, 'applications'),
      feedback: readData(dir, 'feedback'),
      proposals: readData(dir, 'proposals'),
    }
    const { write: changes = {}, result } = fn(data)
    // A migration is saved by the first transaction after it, whatever that changes.
    const write = data.leads !== stored ? { leads: data.leads, ...changes } : changes
    for (const name of Object.keys(write) as DataName[]) {
      const value = write[name]
      if (value !== undefined) writeData(dir, name, value)
    }
    return result
  })
}

/** Creates the data folder's files and folders that are missing. */
export function init(dir: string): string {
  for (const sub of ['profile', 'packages', 'scout']) mkdirSync(join(dir, sub), { recursive: true })
  return transact(dir, data => {
    const boards = join(dir, 'profile', 'ats-boards.json')
    if (!existsSync(boards)) writeAtomic(boards, '[]\n')
    const missing = (Object.keys(FILES) as DataName[]).filter(
      name => !existsSync(join(dir, FILES[name])),
    )
    const write: Partial<Data> = {}
    for (const name of missing) Object.assign(write, { [name]: data[name] })
    return { write, result: dir }
  })
}
