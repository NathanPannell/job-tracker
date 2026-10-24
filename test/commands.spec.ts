import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import * as commands from '../bin/lib/commands.ts'
import { PAGE_BUDGET, pageSvg, parsePdfInfo, renderPreview } from '../bin/lib/preview.ts'
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

test('list and alerts go by the aged score; the fit score stays as scored', () => {
  const dir = fresh()
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
  const added = commands.add(dir, [
    { ...lead('Stale', 95), postedAt: daysAgo(2) },
    { ...lead('Fresh', 90), postedAt: daysAgo(0) },
  ])
  assert.deepEqual(
    added.alerts.map(alert => [alert.company, alert.fitScore, alert.score]),
    [['Fresh', 90, 90]],
  )
  assert.deepEqual(
    commands.list(dir).map(one => [one.company, one.fitScore, one.score]),
    [
      ['Fresh', 90, 90],
      ['Stale', 95, 75],
    ],
  )
  assert.deepEqual(
    commands.list(dir, { min: 85 }).map(one => one.company),
    ['Fresh'],
  )
})

test('archive and add move New leads posted over a week ago to Archived', () => {
  const dir = fresh()
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
  commands.add(dir, [
    { ...lead('Old', 99), postedAt: daysAgo(1) },
    { ...lead('Kept', 99), postedAt: daysAgo(1) },
  ])
  commands.move(dir, 'kept-backend-developer', 'drafting')
  assert.deepEqual(commands.archive(dir), { archived: [] })
  // A week on, as the board would find it.
  transact(dir, data => ({
    write: {
      leads: {
        ...data.leads,
        leads: data.leads.leads.map(one => ({ ...one, postedAt: daysAgo(8) })),
      },
    },
    result: null,
  }))
  assert.deepEqual(commands.archive(dir), { archived: ['old-backend-developer'] })
  const columns = readData(dir, 'leads').leads.map(one => [one.id, one.column])
  assert.deepEqual(columns, [
    ['old-backend-developer', 'archived'],
    ['kept-backend-developer', 'drafting'],
  ])
  // No feedback for the weekly review: the person made no call.
  assert.deepEqual(
    readData(dir, 'feedback').events.map(event => event.to),
    ['drafting'],
  )
  // add sweeps in the same write.
  transact(dir, data => ({
    write: {
      leads: {
        ...data.leads,
        leads: [
          ...data.leads.leads,
          {
            ...(data.leads.leads[0] as (typeof data.leads.leads)[number]),
            id: 'again',
            column: 'new' as const,
          },
        ],
      },
    },
    result: null,
  }))
  assert.deepEqual(commands.add(dir, [lead('Fresh')]).archived, ['again'])
})

test('move, pass, score, snooze, patch and mention write the lead and its feedback', () => {
  const dir = fresh()
  commands.add(dir, [lead('Acme')])
  const id = 'acme-backend-developer'
  assert.equal(commands.move(dir, id, 'drafting')?.column, 'drafting')
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

test('summaries lists open leads missing a blurb, tagline or highlights and fills them', () => {
  const dir = fresh()
  commands.add(dir, [
    {
      ...lead('Acme'),
      companyBlurb: 'Builds APIs.',
      tagline: 'APIs for clinics',
      roleHighlights: ['Remote'],
    },
    lead('Beta'),
    lead('Gone'),
    { ...lead('Delta'), companyBlurb: 'Makes drones.', roleHighlights: ['Rust'] },
  ])
  commands.move(dir, 'gone-backend-developer', 'archived')
  assert.equal(commands.list(dir, { limit: 1 })[0]?.companyBlurb, 'Builds APIs.')
  assert.deepEqual(
    commands.summaries(dir).map(one => [one.id, one.missing]),
    [
      ['beta-backend-developer', ['companyBlurb', 'tagline', 'roleHighlights']],
      ['delta-backend-developer', ['tagline']],
    ],
  )
  const filled = commands.summaries(dir, [
    {
      id: 'beta-backend-developer',
      companyBlurb: 'Makes farm sensors.',
      tagline: 'Farm sensors',
      roleHighlights: ['Rust', 'Equity'],
    },
    // What a lead already has is kept: only missing fields are filled.
    {
      id: 'acme-backend-developer',
      companyBlurb: 'Replaced?',
      tagline: 'Replaced?',
      roleHighlights: [],
    },
    { id: 'delta-backend-developer', tagline: 'A sentence far too long to fit on the card at all' },
    { id: 'missing', companyBlurb: 'x' },
    { id: 'gone-backend-developer', roleHighlights: {} as never },
    null as never,
  ])
  assert.deepEqual(filled, {
    updated: ['beta-backend-developer', 'delta-backend-developer'],
    errors: [
      'missing: No lead missing',
      'gone-backend-developer: roleHighlights must be a list of strings',
      'null: needs an id',
    ],
  })
  assert.equal(commands.list(dir, { limit: 1 })[0]?.companyBlurb, 'Builds APIs.')
  const leads = readData(dir, 'leads').leads
  const beta = leads.find(one => one.id === 'beta-backend-developer')
  assert.equal(beta?.companyBlurb, 'Makes farm sensors.')
  assert.equal(beta?.tagline, 'Farm sensors')
  assert.deepEqual(beta?.roleHighlights, ['Rust', 'Equity'])
  assert.equal(beta?.history.at(-1)?.by, 'scout')
  assert.equal(leads.find(one => one.id === 'acme-backend-developer')?.tagline, 'APIs for clinics')
  // In add, a bad tagline costs only itself: the lead goes on without it.
  const other = fresh()
  const added = commands.add(other, [
    { ...lead('Echo'), tagline: 'Two\nlines' },
    { ...lead('Foxtrot'), tagline: 'Drone mapping' },
  ])
  assert.deepEqual(added.added, ['echo-backend-developer', 'foxtrot-backend-developer'])
  assert.deepEqual(added.warnings, [
    'Echo — Backend Developer: tagline must be one line; added without it',
  ])
  const echo = readData(other, 'leads').leads.find(one => one.company === 'Echo')
  assert.equal(echo?.tagline, undefined)
  assert.throws(
    () =>
      commands.add(other, [{ ...lead('Golf'), tagline: 'x'.repeat(61), companyBlurb: 3 as never }]),
    /Golf — Backend Developer: companyBlurb must be a string/,
  )
  const long = commands.summaries(dir, [{ id: 'gone-backend-developer', tagline: 'x'.repeat(61) }])
  assert.deepEqual((long as { errors: string[] }).errors, [
    'gone-backend-developer: tagline must be about 40 characters, not 61',
  ])
  assert.deepEqual(commands.summaries(dir), [])
  assert.throws(() => commands.summaries(dir, {} as never), /JSON array/)
  assert.throws(
    () => commands.add(dir, [{ ...lead('Bad'), companyBlurb: 3 as never }]),
    /Bad — Backend Developer: companyBlurb must be a string/,
  )
})

test('the jobs CLI lists and fills summaries from a file', () => {
  const dir = fresh()
  commands.add(dir, [lead('Acme')])
  const file = join(dir, 'summaries.json')
  writeFileSync(file, JSON.stringify([{ id: 'acme-backend-developer', companyBlurb: 'APIs.' }]))
  const cli = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, ['bin/jobs.ts', ...args, '--data', dir], { encoding: 'utf8' }),
    ) as unknown
  assert.deepEqual(cli('summaries'), [
    {
      id: 'acme-backend-developer',
      company: 'Acme',
      role: 'Backend Developer',
      url: 'https://jobs.example.com/Acme',
      source: 'greenhouse',
      missing: ['companyBlurb', 'tagline', 'roleHighlights'],
    },
  ])
  assert.deepEqual(cli('summaries', `@${file}`), {
    updated: ['acme-backend-developer'],
    errors: [],
  })
  // The tagline and highlights are still missing, so it stays on the list, blurb and all.
  const left = cli('summaries') as { missing: string[]; companyBlurb?: string }[]
  assert.deepEqual(
    left.map(one => [one.missing, one.companyBlurb]),
    [[['tagline', 'roleHighlights'], 'APIs.']],
  )
})

test('a lead stored in the removed Shortlisted column is read as New and saved so once', () => {
  const dir = fresh()
  commands.add(dir, [lead('Acme'), lead('Beta')])
  const path = join(dir, 'leads.json')
  const stored = JSON.parse(readFileSync(path, 'utf8')) as { leads: { column: string }[] }
  stored.leads[0] = { ...stored.leads[0], column: 'shortlisted' }
  writeFileSync(path, JSON.stringify(stored))
  assert.equal(commands.list(dir).find(one => one.company === 'Acme')?.column, 'new')
  // A read changes nothing on disk; the next write saves the move with its history entry.
  assert.match(readFileSync(path, 'utf8'), /"shortlisted"/)
  commands.score(dir, 'beta-backend-developer', 'too-low')
  const acme = readData(dir, 'leads').leads.find(one => one.company === 'Acme')
  assert.equal(acme?.column, 'new')
  assert.equal(acme?.history.at(-1)?.note, 'shortlisted was removed from the board')
  assert.doesNotMatch(readFileSync(path, 'utf8'), /"column": "shortlisted"/)
  assert.equal(readData(dir, 'leads').leads.find(one => one.company === 'Acme')?.history.length, 2)
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
  commands.move(dir, id, 'drafting', { by: 'package' })
  const app = commands.registerPackage(dir, id, { draftId: 'r-123' })
  assert.equal(app.status, 'ready')
  assert.equal(app.column, 'ready')
  assert.equal(app.notice, undefined)
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

  // An older package's preview is drawn again; nothing else about it changes.
  writeFileSync(join(pkg, 'resume.pdf'), '%PDF-1.4')
  const fake: Run = (file, args) => {
    if (file === 'pdfinfo') return 'Pages: 1\n'
    writeFileSync(`${args.at(-1) as string}.png`, Buffer.alloc(1_000))
    return ''
  }
  const before = readData(dir, 'applications').applications[0]
  const redrawn = commands.rerenderPreview(dir, id, fake)
  assert.deepEqual(redrawn.files.preview, ['preview/page-1.svg'])
  assert.deepEqual(readData(dir, 'applications').applications[0], {
    ...before,
    files: redrawn.files,
  })
  assert.equal(readData(dir, 'leads').leads[0]?.column, 'applied')
  mkdirSync(join(dir, 'packages', 'other'), { recursive: true })
  writeFileSync(join(dir, 'packages', 'other', 'resume.pdf'), '%PDF-1.4')
  assert.throws(() => commands.rerenderPreview(dir, 'other', fake), /No package registered/)
})

/** A lead in Drafting with a package on disk, as the package skill leaves it before step 9. */
const drafted = () => {
  const dir = fresh()
  commands.add(dir, [lead('Acme')])
  const id = 'acme-backend-developer'
  commands.move(dir, id, 'drafting', { by: 'package' })
  const pkg = join(dir, 'packages', id)
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(dir, 'profile', 'master-resume.tex'), 'line one\nline two\n')
  writeFileSync(join(pkg, 'resume.tex'), 'line one\nline 2\n')
  writeFileSync(join(pkg, 'cover-letter.md'), 'Dear Acme')
  return { dir, id, pkg }
}

test('package moves a card still in Drafting to Ready to review', () => {
  const { dir, id } = drafted()
  const result = commands.registerPackage(dir, id)
  assert.equal(result.column, 'ready')
  assert.equal(result.notice, undefined)
  const card = readData(dir, 'leads').leads[0]
  assert.equal(card?.column, 'ready')
  assert.deepEqual(card?.history.at(-1), {
    at: card?.history.at(-1)?.at,
    by: 'package',
    action: 'moved',
    from: 'drafting',
    to: 'ready',
  })
})

for (const [column, options] of [
  ['archived', {}],
  ['passed', { reason: 'score too high' }],
  ['new', {}],
] as const) {
  test(`package registers the files but leaves a card moved to ${column} mid-build`, () => {
    const { dir, id, pkg } = drafted()
    commands.move(dir, id, column, options)
    const feedback = readData(dir, 'feedback').events.length
    const result = commands.registerPackage(dir, id, { draftId: 'r-1' })
    assert.equal(result.column, column)
    assert.match(result.notice ?? '', new RegExp(`stays in ${column}`, 'i'))
    assert.equal(result.status, 'drafting')
    assert.equal(result.warmIntroDraftId, 'r-1')
    assert.deepEqual(Object.keys(result.files).sort(), ['coverLetter', 'resumeDiff', 'resumeTex'])
    assert.ok(existsSync(join(pkg, 'resume.diff')))
    assert.ok(existsSync(join(pkg, '.draft', 'cover-letter.md')))
    assert.equal(readData(dir, 'applications').applications[0]?.leadId, id)
    const card = readData(dir, 'leads').leads[0]
    assert.equal(card?.column, column)
    assert.equal(card?.history.at(-1)?.by, 'user')
    assert.equal(readData(dir, 'feedback').events.length, feedback)
  })
}

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
  assert.throws(() => commands.move(dir, 'acme-backend-developer', 'drafting'), /not valid JSON/)
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

test('the preview is one 1-bit PNG per page, small enough for the pane to draw', () => {
  assert.deepEqual(parsePdfInfo('Pages:          2\nPage size:      612 x 792 pts (letter)\n'), {
    pages: 2,
    width: 612,
    height: 792,
  })
  assert.deepEqual(parsePdfInfo(''), { pages: 1, width: 612, height: 792 })
  assert.match(
    pageSvg('QUJD', 10, 5),
    /^<svg[^>]+width="10" height="5".*data:image\/png;base64,QUJD/,
  )

  const dir = join(root, 'preview')
  mkdirSync(dir, { recursive: true })
  const pdf = join(dir, 'resume.pdf')
  writeFileSync(pdf, '%PDF-1.4')
  const calls: string[][] = []
  const fake: Run = (file, args) => {
    calls.push([file, ...args])
    if (file === 'pdfinfo') return 'Pages: 2\nPage size: 612 x 792 pts\n'
    // the first page is too large at the first resolution and fits at the next
    const isFirstTry = calls.filter(call => call[0] === 'pdftocairo').length === 1
    writeFileSync(`${args.at(-1) as string}.png`, Buffer.alloc(isFirstTry ? 80_000 : 30_000))
    return ''
  }
  const names = renderPreview(pdf, join(dir, 'out'), fake)
  assert.deepEqual(names, ['page-1.svg', 'page-2.svg'])
  const first = readFileSync(join(dir, 'out', 'page-1.svg'), 'utf8')
  assert.ok(first.length <= PAGE_BUDGET)
  assert.match(first, /width="850" height="1100"/)
  assert.ok(calls.every(call => call[0] !== 'pdftocairo' || call.includes('-mono')))
  assert.ok(!existsSync(join(dir, 'out', 'page-1.png')))
  assert.throws(() => renderPreview(join(dir, 'missing.pdf'), join(dir, 'x'), fake), /No PDF/)
  const huge: Run = (file, args) => {
    if (file === 'pdfinfo') return 'Pages: 1\n'
    writeFileSync(`${args.at(-1) as string}.png`, Buffer.alloc(200_000))
    return ''
  }
  assert.throws(() => renderPreview(pdf, join(dir, 'y'), huge), /too large/)
})
