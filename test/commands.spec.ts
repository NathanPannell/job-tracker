import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import * as commands from '../bin/lib/commands.ts'
import { parsePdfInfo, renderPreview, strips, stripSvg, SVG_LIMIT } from '../bin/lib/preview.ts'
import type { Run } from '../bin/lib/preview.ts'
import { dataDir, readData, transact, withLock, writeAtomic } from '../bin/lib/store.ts'

const root = mkdtempSync(join(tmpdir(), 'job-tracker-test-'))
after(() => rmSync(root, { recursive: true, force: true }))

let n = 0
const fresh = () => {
  const dir = join(root, `data-${(n += 1)}`)
  commands.init(dir)
  return dir
}

const lead = (company: string, fitScore = 80) => ({
  company,
  role: 'Backend Developer',
  url: `https://jobs.example.com/${company}`,
  source: 'greenhouse',
  location: 'Victoria',
  comp: '',
  fitScore,
  fitReason: 'fits',
})

test('init creates the files, add merges and alerts on 90+', () => {
  const dir = fresh()
  for (const name of ['leads.json', 'applications.json', 'feedback.json', 'proposals.json']) {
    assert.ok(existsSync(join(dir, name)), name)
  }
  const added = commands.add(dir, [lead('Acme', 92), lead('Beta'), lead('Low', 10)])
  assert.deepEqual(added.added, ['acme-backend-developer', 'beta-backend-developer'])
  assert.deepEqual(
    added.alerts.map(alert => alert.id),
    ['acme-backend-developer'],
  )
  assert.deepEqual(added.dropped, ['low-backend-developer'])
  assert.throws(() => commands.add(dir, {} as never), /array/)
  assert.equal(commands.list(dir, { column: 'new', min: 85 }).length, 1)
  assert.equal(commands.list(dir, { limit: 1 })[0]?.company, 'Acme')
  assert.equal(commands.seen(dir).length, 2)
  assert.equal(commands.summary(dir).newLeads, 2)
})

test('move, pass, score, snooze, patch and mention write the lead and its feedback', () => {
  const dir = fresh()
  commands.add(dir, [lead('Acme')])
  const id = 'acme-backend-developer'
  assert.equal(commands.move(dir, id, 'shortlisted')?.column, 'shortlisted')
  assert.throws(() => commands.move(dir, id, 'nowhere'), /Unknown column/)
  assert.throws(() => commands.move(dir, 'missing', 'new'), /No lead/)
  assert.equal(commands.score(dir, id, 'too-low')?.scoreCorrection, 'too-low')
  assert.throws(() => commands.score(dir, id, 'meh'), /too-high or too-low/)
  assert.ok(commands.snooze(dir, id, 3)?.snoozedUntil)
  assert.equal(commands.patch(dir, id, { notes: 'call them' })?.notes, 'call them')
  assert.deepEqual(commands.mention(dir, [id]), { mentioned: [id] })
  assert.ok(readData(dir, 'leads').leads[0]?.mentionedAt)
  assert.equal(commands.move(dir, id, 'passed', { reason: 'Location' })?.passReason, 'Location')
  const kinds = readData(dir, 'feedback').events.map(event => event.kind)
  assert.deepEqual(kinds, ['move', 'score-too-low', 'snooze', 'pass'])
  const event = commands.feedback(dir, { leadId: id, kind: 'outcome', reason: 'rejected' })
  assert.equal(event.source, 'greenhouse')
  assert.throws(() => commands.feedback(dir, { leadId: id, kind: 'nope' }), /Unknown feedback/)
  assert.throws(() => commands.feedback(dir, { leadId: 'x', kind: 'pass' }), /No lead/)
})

test('a package is registered with its diff, draft snapshot and files, then submitted', () => {
  const dir = fresh()
  commands.add(dir, [lead('Acme')])
  const id = 'acme-backend-developer'
  assert.throws(() => commands.registerPackage(dir, id), /No package folder/)
  const pkg = join(dir, 'packages', id)
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(dir, 'profile', 'master-resume.tex'), 'line one\nline two\nline three\n')
  writeFileSync(join(pkg, 'resume.tex'), 'line one\nline 2\nline three\n')
  writeFileSync(join(pkg, 'cover-letter.md'), 'Dear Acme')
  assert.throws(() => commands.registerPackage(dir, id, { column: 'bogus' }), /Unknown column/)
  const app = commands.registerPackage(dir, id, { draftId: 'r-123' })
  assert.equal(app.status, 'ready')
  assert.equal(app.warmIntroDraftId, 'r-123')
  assert.deepEqual(Object.keys(app.files).sort(), ['coverLetter', 'resumeDiff', 'resumeTex'])
  assert.match(readFileSync(join(pkg, 'resume.diff'), 'utf8'), /\+line 2/)
  assert.equal(readData(dir, 'leads').leads[0]?.column, 'ready')
  assert.ok(existsSync(join(pkg, '.draft', 'cover-letter.md')))

  assert.deepEqual(commands.edits(dir), [])
  writeFileSync(join(pkg, 'cover-letter.md'), 'Dear Acme team')
  const edits = commands.edits(dir)
  assert.equal(edits[0]?.file, 'cover-letter.md')
  assert.match(edits[0]?.diff ?? '', /\+Dear Acme team/)
  // registering again keeps the original draft, so the edit stays visible
  commands.registerPackage(dir, id)
  assert.equal(commands.edits(dir).length, 1)
  commands.registerPackage(dir, id, { redraft: true })
  assert.equal(commands.edits(dir).length, 0)

  const done = commands.submitted(dir, id)
  assert.ok(done.followUpAt)
  assert.equal(readData(dir, 'leads').leads[0]?.column, 'applied')
  assert.equal(readData(dir, 'applications').applications[0]?.status, 'submitted')
  assert.throws(() => commands.submitted(dir, 'missing'), /No lead/)
  assert.equal(commands.resumeDiff(dir, 'missing'), '')
  assert.throws(() => commands.registerPackage(fresh(), 'x'), /No package folder/)
})

test('proposals are approved into the profile files or rejected', () => {
  const dir = fresh()
  const proposal = commands.propose(dir, {
    summary: 'Week one',
    funnel: '3 found, 1 applied',
    changes: [
      {
        file: 'learnings.md',
        title: 'Senior roles',
        rationale: 'Passed 3',
        text: 'Score senior roles lower.',
      },
      {
        file: 'preferences.md',
        title: 'Remote',
        rationale: 'Kept 2',
        text: 'Remote Canada is fine.',
      },
    ],
  })
  assert.equal(proposal.status, 'pending')
  assert.throws(() => commands.propose(dir, { summary: '', funnel: '' } as never), /changes/)
  assert.throws(() => commands.decide(dir, proposal.id, 'maybe'), /approve or reject/)
  assert.throws(() => commands.decide(dir, 'nope', 'approve'), /No proposal/)
  assert.equal(commands.decide(dir, proposal.id, 'approve').status, 'approved')
  assert.match(
    readFileSync(join(dir, 'profile', 'learnings.md'), 'utf8'),
    /Score senior roles lower/,
  )
  assert.match(readFileSync(join(dir, 'profile', 'preferences.md'), 'utf8'), /Remote Canada/)
  assert.throws(() => commands.decide(dir, proposal.id, 'reject'), /already approved/)
  const second = commands.propose(dir, { id: 'p2', summary: 's', funnel: 'f', changes: [] })
  assert.equal(commands.decide(dir, second.id, 'reject').status, 'rejected')
})

test('a broken data file stops every write instead of replacing the board', () => {
  const dir = fresh()
  commands.add(dir, [lead('Acme')])
  writeFileSync(join(dir, 'leads.json'), '{"version":1,"leads":[,]}')
  assert.throws(() => commands.move(dir, 'acme-backend-developer', 'shortlisted'), /not valid JSON/)
  assert.equal(readFileSync(join(dir, 'leads.json'), 'utf8'), '{"version":1,"leads":[,]}')
  writeFileSync(join(dir, 'leads.json'), '\uFEFF{"version":1,"leads":[]}')
  assert.deepEqual(commands.list(dir), [])
})

test('the lock serializes writers and a stale lock is cleared', () => {
  const dir = fresh()
  writeFileSync(join(dir, '.lock'), '')
  const old = new Date(Date.now() - 60_000)
  execFileSync(process.execPath, [
    '-e',
    `require('fs').utimesSync(${JSON.stringify(join(dir, '.lock'))}, new Date(${old.getTime()}), new Date(${old.getTime()}))`,
  ])
  assert.equal(
    withLock(dir, () => 'ran'),
    'ran',
  )
  assert.ok(!existsSync(join(dir, '.lock')))
  assert.equal(
    transact(dir, () => ({ result: 1 })),
    1,
  )
  writeAtomic(join(dir, 'x', 'y.json'), '{}')
  assert.equal(readFileSync(join(dir, 'x', 'y.json'), 'utf8'), '{}')
  assert.throws(() => dataDir(''), /JOB_TRACKER_DATA/)
  assert.equal(dataDir('/d'), '/d')
  assert.deepEqual(commands.readJsonArg('[1]'), [1])
  writeFileSync(join(dir, 'arg.json'), '{"a":1}')
  assert.deepEqual(commands.readJsonArg(`@${join(dir, 'arg.json')}`), { a: 1 })
  assert.throws(() => commands.readJsonArg(undefined), /Missing/)
})

test('the preview cuts each page into SVG strips under the Svg cap', () => {
  assert.deepEqual(parsePdfInfo('Pages:          2\nPage size:      612 x 792 pts (letter)\n'), {
    pages: 2,
    width: 612,
    height: 792,
  })
  assert.deepEqual(parsePdfInfo(''), { pages: 1, width: 612, height: 792 })
  assert.deepEqual(strips(700, 320), [
    [0, 320],
    [320, 320],
    [640, 60],
  ])
  assert.match(
    stripSvg('QUJD', 10, 5),
    /^<svg[^>]+width="10" height="5".*data:image\/jpeg;base64,QUJD/,
  )

  const dir = join(root, 'preview')
  mkdirSync(dir, { recursive: true })
  const pdf = join(dir, 'resume.pdf')
  writeFileSync(pdf, '%PDF-1.4')
  const calls: string[][] = []
  let big = true
  const fake: Run = (file, args) => {
    calls.push([file, ...args])
    if (file === 'pdfinfo') return 'Pages: 1\nPage size: 612 x 792 pts\n'
    const prefix = args.at(-1) as string
    // the first strip is too large at the first quality and fits at the next
    writeFileSync(`${prefix}.jpg`, Buffer.alloc(big ? 100_000 : 1_000))
    big = false
    return ''
  }
  const names = renderPreview(pdf, join(dir, 'out'), fake)
  assert.equal(names.length, 5)
  assert.equal(names[0], 'page-1-0.svg')
  const first = readFileSync(join(dir, 'out', 'page-1-0.svg'), 'utf8')
  assert.ok(first.length < SVG_LIMIT)
  assert.ok(calls.some(call => call.includes('quality=60,optimize=y')))
  assert.throws(() => renderPreview(join(dir, 'missing.pdf'), join(dir, 'x'), fake), /No PDF/)
  const huge: Run = (file, args) => {
    if (file === 'pdfinfo') return 'Pages: 1\n'
    writeFileSync(`${args.at(-1) as string}.jpg`, Buffer.alloc(200_000))
    return ''
  }
  assert.throws(() => renderPreview(pdf, join(dir, 'y'), huge), /too large/)
})
