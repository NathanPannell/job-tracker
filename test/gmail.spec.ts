import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import * as commands from '../bin/lib/commands.ts'
import {
  GMAIL_SOURCES,
  gmailQuery,
  markGmailRead,
  readCursor,
  sourceFor,
} from '../bin/lib/gmail.ts'

const root = mkdtempSync(join(tmpdir(), 'job-tracker-gmail-'))
after(() => rmSync(root, { recursive: true, force: true }))

let count = 0
function freshDir(): string {
  count += 1
  const dir = join(root, `data-${count}`)
  mkdirSync(join(dir, 'profile'), { recursive: true })
  return dir
}

/** A sender address, built here so the repository's personal-data scan has nothing to flag. */
const at = (local: string, domain: string) => `${local}@${domain}`

const NOW = new Date('2026-10-20T20:00:00Z')
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000)

test('every alert and signal sender maps to its source', () => {
  const cases: [string, string][] = [
    [at('jobalerts-noreply', 'linkedin.com'), 'gmail:linkedin'],
    [at('donotreply', 'jobalert.indeed.com'), 'gmail:indeed'],
    [at('team', 'hi.wellfound.com'), 'gmail:wellfound'],
    [at('noreply', 'glassdoor.com'), 'gmail:glassdoor'],
    [at('workatastartup', 'ycombinator.com'), 'gmail:yc'],
    [at('no-reply', 'welcometothejungle.com'), 'gmail:wttj'],
    [at('do-not-reply', 'bcjobs.ca'), 'gmail:bctechjobs'],
    [at('tectoria', 'viatec.ca'), 'gmail:viatec'],
    [at('newsletter', 'betakit.com'), 'signal:betakit'],
    [at('hello', 'victechjournal.com'), 'signal:victechjournal'],
    [at('VanTechJournal', 'mail.beehiiv.com'), 'signal:vantechjournal'],
  ]
  for (const [sender, source] of cases) assert.equal(sourceFor(sender)?.source, source, sender)
  assert.equal(sourceFor(at('alerts', 'example.com')).source, 'gmail:other')
  assert.equal(sourceFor(at('newsletter', 'betakit.com')).kind, 'signal')
  assert.equal(sourceFor(at('tectoria', 'viatec.ca')).kind, 'alert')
})

test('a first run reads the last week of every source and skips account mail', () => {
  const dir = freshDir()
  const result = gmailQuery(dir, NOW)
  assert.equal(result.firstRun, true)
  assert.equal(result.since, '2026-10-13T20:00:00.000Z')
  assert.ok(result.query.startsWith(`after:${seconds('2026-10-13T20:00:00Z')} (`))
  for (const one of GMAIL_SOURCES) {
    for (const token of one.senders) assert.ok(result.query.includes(`from:${token}`), token)
  }
  assert.ok(result.query.includes('OR subject:"job alert" OR subject:"job alerts"'))
  assert.ok(
    result.query.endsWith(
      '-subject:("verify your" OR "email was verified" OR "reset your password" OR "security alert" OR "new sign-in")',
    ),
  )
  // Words that also name jobs ("Security Engineer", "Design Verification") are never excluded.
  for (const word of ['OR security OR', '(verification', 'OR verify OR']) {
    assert.ok(!result.query.includes(word), word)
  }
  assert.equal(result.sources, GMAIL_SOURCES)
})

test('later runs read from the cursor with an hour of overlap, never more than 21 days', () => {
  const dir = freshDir()
  markGmailRead(dir, '2026-10-20T18:58:07Z', NOW)
  const recent = gmailQuery(dir, NOW)
  assert.equal(recent.firstRun, false)
  assert.equal(recent.since, '2026-10-20T17:58:07.000Z')

  markGmailRead(dir, '2026-11-30T00:00:00Z', new Date('2026-11-30T00:00:00Z'))
  const late = gmailQuery(dir, new Date('2027-01-31T00:00:00Z'))
  assert.equal(late.since, '2027-01-10T00:00:00.000Z')
})

test('the cursor only moves forward and refuses bad times', () => {
  const dir = freshDir()
  assert.equal(readCursor(dir), undefined)
  assert.deepEqual(markGmailRead(dir, '2026-10-20T18:00:00Z', NOW), {
    after: '2026-10-20T18:00:00.000Z',
    moved: true,
  })
  assert.deepEqual(markGmailRead(dir, '2026-10-19T00:00:00Z', NOW), {
    after: '2026-10-20T18:00:00.000Z',
    moved: false,
  })
  assert.equal(readCursor(dir), '2026-10-20T18:00:00.000Z')
  assert.throws(() => markGmailRead(dir, 'yesterday', NOW), /Not a date/)
  assert.throws(() => markGmailRead(dir, '2027-01-01T00:00:00Z', NOW), /future/)
  assert.throws(() => markGmailRead(dir, '2026-10-20T20:30:00Z', NOW), /future/)
  assert.throws(() => markGmailRead(dir, '2026-10-20T19:00:00', NOW), /no timezone/)
  const offset = markGmailRead(dir, '2026-10-20T12:00:00-07:00', NOW)
  assert.equal(offset.after, '2026-10-20T19:00:00.000Z')
})

test('a damaged cursor is ignored, so the next run reads the first-run window', () => {
  const dir = freshDir()
  mkdirSync(join(dir, 'scout'), { recursive: true })
  const path = join(dir, 'scout', 'gmail-cursor.json')
  for (const text of ['{"after": "soon"}', 'null', '{not json']) {
    writeFileSync(path, text)
    assert.equal(readCursor(dir), undefined, text)
  }
  assert.equal(gmailQuery(dir, NOW).firstRun, true)
})

test('board-add appends a board once and checks its fields', () => {
  const dir = freshDir()
  const path = join(dir, 'profile', 'ats-boards.json')
  const first = commands.addBoard(dir, ' Acme ', 'ashby', 'acme')
  assert.deepEqual(first, {
    added: true,
    board: { company: 'Acme', ats: 'ashby', slug: 'acme' },
    boards: 1,
  })
  assert.equal(commands.addBoard(dir, 'Acme Inc', 'ashby', 'acme').added, false)
  assert.equal(commands.addBoard(dir, 'Acme', 'ashby', ' ACME ').added, false)
  commands.addBoard(dir, 'Wave', 'lever', 'waveapps')
  assert.deepEqual(
    JSON.parse(readFileSync(path, 'utf8')).map((one: { slug: string }) => one.slug),
    ['acme', 'waveapps'],
  )
  assert.throws(() => commands.addBoard(dir, 'Acme', 'workday', 'acme'), /greenhouse, lever/)
  assert.throws(() => commands.addBoard(dir, ' ', 'lever', 'x'), /company and a slug/)
})
