import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  addLeads,
  age,
  appendEvent,
  bandText,
  columnLeads,
  correctScore,
  counts,
  emptyFeedback,
  emptyLeads,
  isColumn,
  isSameRole,
  leadId,
  leadsToMention,
  markMentioned,
  moveLead,
  neighbour,
  normalizeUrl,
  nudgeContext,
  parseOr,
  parseStrict,
  missingSummaries,
  patchLead,
  snoozeLead,
} from '../hooks/lib/model.ts'
import type { IncomingLead, Lead, LeadsFile } from '../hooks/lib/model.ts'

const AT = '2026-10-20T12:00:00.000Z'
const NOW = Date.parse(AT)
const HOUR = 3_600_000

const incoming = (company: string, fields: Partial<IncomingLead> = {}): IncomingLead => ({
  company,
  role: 'Backend Developer',
  url: `https://jobs.example.com/${company}`,
  source: 'ashby',
  location: 'Victoria',
  comp: '',
  fitScore: 80,
  fitReason: 'fits',
  ...fields,
})

const board = (...leads: Lead[]): LeadsFile => ({ version: 1, leads })

const seeded = (n: Partial<IncomingLead>[] = [{}]) =>
  addLeads(
    emptyLeads(),
    n.map((fields, i) => incoming(`Co${i}`, fields)),
    AT,
    0,
  ).leads

test('leadId is a stable slug', () => {
  assert.equal(leadId('Ocean AID', 'Backend Engineer (Cloud)'), 'ocean-aid-backend-engineer-cloud')
  assert.equal(leadId('', ''), 'lead')
})

test('addLeads dedupes by id and by URL, keeps the column, drops below the threshold', () => {
  const first = addLeads(
    emptyLeads(),
    [incoming('Acme'), incoming('Low', { fitScore: 40 })],
    AT,
    60,
  )
  assert.deepEqual(first.added, ['acme-backend-developer'])
  assert.deepEqual(first.dropped, ['low-backend-developer'])
  const moved = moveLead(first.leads, 'acme-backend-developer', 'shortlisted', AT, 'user').leads
  const again = addLeads(
    moved,
    [
      incoming('Acme', { comp: 'CAD 90k' }),
      incoming('Other', {
        url: 'https://jobs.example.com/Acme?ref=x',
        role: 'Backend Developer (Remote)',
      }),
    ],
    AT,
    60,
  )
  assert.deepEqual(again.added, [])
  assert.deepEqual(again.updated, ['acme-backend-developer', 'acme-backend-developer'])
  assert.equal(again.leads.leads.length, 1)
  assert.equal(again.leads.leads[0]?.column, 'shortlisted')
  assert.equal(again.leads.leads[0]?.comp, 'CAD 90k')
})

test('addLeads gives a second posting with the same slug its own id', () => {
  const one = addLeads(emptyLeads(), [incoming('Acme', { id: 'x' })], AT, 0).leads
  const two = addLeads(
    one,
    [incoming('Acme', { id: 'x', url: 'https://other.example.com/2' })],
    AT,
    0,
  )
  assert.equal(two.updated.length, 1)
  const fresh = addLeads(
    board({ ...(one.leads[0] as Lead), url: '' }),
    [incoming('Acme', { url: '' })],
    AT,
    0,
  )
  assert.deepEqual(fresh.added, ['acme-backend-developer'])
})

test('moveLead records history and a feedback event; passing needs a reason', () => {
  const file = seeded()
  const id = file.leads[0]?.id as string
  assert.match(moveLead(file, id, 'passed', AT, 'user').error ?? '', /reason/)
  assert.match(moveLead(file, 'nope', 'new', AT, 'user').error ?? '', /No lead/)
  const passed = moveLead(file, id, 'passed', AT, 'user', { passReason: 'Too senior', note: 'n' })
  assert.equal(passed.leads.leads[0]?.column, 'passed')
  assert.equal(passed.event?.kind, 'pass')
  assert.equal(passed.event?.reason, 'Too senior')
  assert.equal(passed.leads.leads[0]?.history.at(-1)?.note, 'n')
  const moved = moveLead(file, id, 'drafting', AT, 'package')
  assert.equal(moved.event?.kind, 'move')
  assert.equal(moved.event?.from, 'new')
})

test('neighbour walks the pipeline and brings closed cards back to New', () => {
  assert.equal(neighbour('new', -1), undefined)
  assert.equal(neighbour('new', 1), 'shortlisted')
  assert.equal(neighbour('offer', 1), undefined)
  assert.equal(neighbour('passed', -1), 'new')
  assert.equal(neighbour('passed', 1), undefined)
})

test('score corrections and snoozes are events', () => {
  const file = seeded()
  const id = file.leads[0]?.id as string
  const high = correctScore(file, id, 'too-high', AT)
  assert.equal(high.event?.kind, 'score-too-high')
  assert.equal(correctScore(file, id, 'too-low', AT).event?.kind, 'score-too-low')
  assert.ok(correctScore(file, 'x', 'too-low', AT).error)
  const snoozed = snoozeLead(file, id, '2026-11-01T00:00:00.000Z', AT)
  assert.equal(snoozed.event?.kind, 'snooze')
  assert.ok(snoozeLead(file, 'x', AT, AT).error)
  assert.equal(counts(snoozed.leads, NOW).newLeads, 0)
})

test('patchLead validates, moves and records the fields it changed', () => {
  const file = seeded()
  const id = file.leads[0]?.id as string
  assert.ok(patchLead(file, 'x', {}, AT, 'model').error)
  assert.ok(patchLead(file, id, { column: 'bogus' as never }, AT, 'model').error)
  assert.ok(patchLead(file, id, { fitScore: 140 }, AT, 'model').error)
  assert.match(patchLead(file, id, { column: 'passed' }, AT, 'model').error ?? '', /reason/)
  assert.match(
    patchLead(file, id, { mentionedAt: AT, company: 'X' } as never, AT, 'model').error ?? '',
    /Cannot change mentionedAt, company/,
  )
  const patched = patchLead(
    file,
    id,
    { column: 'passed', passReason: 'Location', fitScore: 50, notes: 'n' },
    AT,
    'model',
  )
  const lead = patched.leads.leads[0] as Lead
  assert.equal(lead.column, 'passed')
  assert.equal(lead.passReason, 'Location')
  assert.equal(lead.fitScore, 50)
  assert.equal(lead.history.at(-1)?.action, 'scored')
  assert.equal(patchLead(file, id, {}, AT, 'model').leads, file)
  const noted = patchLead(file, id, { notes: 'x' }, AT, 'model').leads.leads[0] as Lead
  assert.equal(noted.history.at(-1)?.action, 'note')
})

test('patchLead and addLeads keep a company blurb and role highlights', () => {
  const file = seeded([{ companyBlurb: 'Builds APIs.' }])
  const id = file.leads[0]?.id as string
  assert.equal(file.leads[0]?.companyBlurb, 'Builds APIs.')
  const patched = patchLead(file, id, { roleHighlights: ['Rust', 'Remote'] }, AT, 'scout')
  assert.deepEqual(patched.leads.leads[0]?.roleHighlights, ['Rust', 'Remote'])
  assert.equal(patched.leads.leads[0]?.history.at(-1)?.note, 'roleHighlights')
  assert.match(
    patchLead(file, id, { roleHighlights: [1] as never }, AT, 'scout').error ?? '',
    /list of strings/,
  )
  assert.match(
    patchLead(file, id, { companyBlurb: ['x'] as never }, AT, 'scout').error ?? '',
    /must be a string/,
  )
  // A re-found posting fills what is missing and never replaces what is there.
  const again = addLeads(
    patched.leads,
    [incoming('Co0', { companyBlurb: 'Other words.', roleHighlights: ['New'] })],
    AT,
    0,
  ).leads.leads[0]
  assert.equal(again?.companyBlurb, 'Builds APIs.')
  assert.deepEqual(again?.roleHighlights, ['Rust', 'Remote'])
  const filled = addLeads(
    seeded(),
    [incoming('Co0', { companyBlurb: 'Fresh.', roleHighlights: ['One'] })],
    AT,
    0,
  ).leads.leads[0]
  assert.equal(filled?.companyBlurb, 'Fresh.')
  assert.deepEqual(filled?.roleHighlights, ['One'])
})

test('missingSummaries lists open leads without a blurb or highlights', () => {
  const file = seeded([
    { companyBlurb: 'a', roleHighlights: ['b'] },
    { companyBlurb: 'a' },
    { roleHighlights: [] },
    {},
  ])
  const ids = file.leads.map(one => one.id)
  const closed = moveLead(file, ids[3] as string, 'archived', AT, 'user').leads
  assert.deepEqual(
    missingSummaries(closed).map(one => one.id),
    [ids[1], ids[2]],
  )
  assert.deepEqual(Object.keys(missingSummaries(closed)[0] ?? {}), [
    'id',
    'company',
    'role',
    'url',
    'source',
  ])
})

test('a move to the column a lead is already in records nothing', () => {
  const file = seeded()
  const same = moveLead(file, file.leads[0]?.id as string, 'new', AT, 'sync')
  assert.equal(same.leads, file)
  assert.equal(same.event, undefined)
})

test('URLs match without tracking parameters but keep the ones that name the posting', () => {
  assert.equal(
    normalizeUrl('https://news.ycombinator.com/item?id=1'),
    'https://news.ycombinator.com/item?id=1',
  )
  assert.notEqual(
    normalizeUrl('https://news.ycombinator.com/item?id=1'),
    normalizeUrl('https://news.ycombinator.com/item?id=2'),
  )
  assert.equal(
    normalizeUrl('https://Jobs.example.com/a/?utm_source=x&gh_src=y#apply'),
    'https://jobs.example.com/a',
  )
  assert.equal(normalizeUrl(' not a url/ '), 'not a url')
  const hn = addLeads(
    emptyLeads(),
    [
      incoming('A', { url: 'https://news.ycombinator.com/item?id=1' }),
      incoming('B', { url: 'https://news.ycombinator.com/item?id=2' }),
    ],
    AT,
    0,
  )
  assert.equal(hn.added.length, 2)
})

test('one careers URL listing two roles gives two leads; a retitled posting stays one', () => {
  const page = 'https://example.com/careers'
  const two = addLeads(
    emptyLeads(),
    [
      incoming('Cardog', { role: 'Data Platform Engineer', url: page }),
      incoming('Cardog', { role: 'VIN Decode Engineer', url: page }),
    ],
    AT,
    0,
  )
  assert.equal(two.added.length, 2)
  const retitled = addLeads(
    two.leads,
    [incoming('Cardog', { role: 'Senior Data Platform Engineer', url: page })],
    AT,
    0,
  )
  assert.equal(retitled.added.length, 0)
  assert.ok(isSameRole('Backend Engineer', 'Backend Engineer (Remote)'))
  assert.ok(!isSameRole('Applied AI Engineer', 'Data Engineer / Backend Engineer'))
})

test('parseStrict throws on a broken file and reads one with a byte-order mark', () => {
  assert.throws(() => parseStrict('{"leads": [,]}', emptyLeads))
  assert.deepEqual(parseStrict('\uFEFF{"version":1,"leads":[]}', emptyLeads), emptyLeads())
  assert.deepEqual(parseStrict(undefined, emptyLeads), emptyLeads())
})

test('appendEvent skips a duplicate id', () => {
  const event = { id: 'e1', at: AT, leadId: 'a', kind: 'move' as const }
  const once = appendEvent(emptyFeedback(), event)
  assert.equal(appendEvent(once, event), once)
  assert.equal(once.events.length, 1)
})

test('counts and the band line', () => {
  const file = seeded([{}, {}, {}])
  const [a, b, c] = file.leads.map(lead => lead.id) as [string, string, string]
  let next = moveLead(file, b, 'ready', AT, 'package').leads
  next = patchLead(
    moveLead(next, c, 'applied', AT, 'submit').leads,
    c,
    { followUpAt: AT },
    AT,
    'submit',
  ).leads
  const c1 = counts(next, NOW)
  assert.deepEqual(c1, { newLeads: 1, readyToReview: 1, followUpsDue: 1 })
  assert.equal(bandText(c1), '1 new lead · 1 ready to review · 1 follow-up due')
  assert.equal(
    bandText({ newLeads: 2, readyToReview: 0, followUpsDue: 2 }),
    '2 new leads · 0 ready to review · 2 follow-ups due',
  )
  assert.equal(bandText({ newLeads: 0, readyToReview: 0, followUpsDue: 0 }), undefined)
  assert.equal(columnLeads(next, 'new', NOW)[0]?.id, a)
})

test('columnLeads sorts best first with snoozed last', () => {
  const file = seeded([{ fitScore: 70 }, { fitScore: 90 }, { fitScore: 95 }])
  const snoozed = snoozeLead(
    file,
    file.leads[2]?.id as string,
    '2027-01-01T00:00:00.000Z',
    AT,
  ).leads
  assert.deepEqual(
    columnLeads(snoozed, 'new', NOW).map(lead => lead.fitScore),
    [90, 70, 95],
  )
})

test('leadsToMention picks the top three unmentioned new leads, quiet for three hours after a mention', () => {
  const file = seeded([{ fitScore: 70 }, { fitScore: 90 }, { fitScore: 95 }, { fitScore: 60 }])
  const picked = leadsToMention(file, NOW)
  assert.deepEqual(
    picked.map(lead => lead.fitScore),
    [95, 90, 70],
  )
  const marked = markMentioned(
    file,
    picked.map(lead => lead.id),
    AT,
  )
  assert.equal(marked.leads.filter(lead => lead.mentionedAt).length, 3)
  assert.deepEqual(leadsToMention(marked, NOW + 2 * HOUR), [])
  assert.deepEqual(
    leadsToMention(marked, NOW + 4 * HOUR).map(lead => lead.fitScore),
    [60],
  )
  const twice = markMentioned(
    marked,
    picked.map(lead => lead.id),
    '2027-01-01T00:00:00.000Z',
  )
  assert.equal(twice.leads[0]?.mentionedAt, AT)
  const note = nudgeContext(picked)
  assert.match(note, /Answer the user's actual request first/)
  assert.match(note, /\/jobs/)
  assert.match(note, /Co2/)
})

test('age, isColumn and parseOr', () => {
  assert.equal(age(AT, NOW), 'now')
  assert.equal(age(AT, NOW + 5 * HOUR), '5h')
  assert.equal(age(AT, NOW + 72 * HOUR), '3d')
  assert.equal(age(AT, NOW + 30 * 24 * HOUR), '4w')
  assert.ok(isColumn('ready'))
  assert.ok(!isColumn('done'))
  assert.deepEqual(parseOr(undefined, emptyLeads), emptyLeads())
  assert.deepEqual(parseOr('  ', emptyLeads), emptyLeads())
  assert.deepEqual(parseOr('{not json', emptyLeads), emptyLeads())
  assert.deepEqual(parseOr('{"version":1,"leads":[]}', emptyLeads), emptyLeads())
})
