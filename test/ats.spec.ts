import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { boardUrl, fetchBoards, isReachable, parseBoard, plain } from '../bin/lib/ats.ts'
import type { Board, Fetch, Posting } from '../bin/lib/ats.ts'
import * as commands from '../bin/lib/commands.ts'

const root = mkdtempSync(join(tmpdir(), 'job-tracker-ats-'))
after(() => rmSync(root, { recursive: true, force: true }))

const GREENHOUSE = {
  jobs: [
    {
      title: 'Backend Engineer',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
      location: { name: 'Remote (Canada)' },
      content:
        '&lt;p&gt;Build APIs &amp;amp; services&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;',
      first_published: '2026-09-02T00:00:00Z',
      updated_at: '2026-10-18T00:00:00Z',
    },
  ],
}
const LEVER = [
  {
    text: 'Platform Developer',
    hostedUrl: 'https://jobs.lever.co/wave/2',
    categories: { location: 'Toronto, Ontario', allLocations: ['Toronto, Ontario', 'Canada'] },
    descriptionPlain: 'Own the platform.',
    workplaceType: 'remote',
    createdAt: Date.parse('2026-10-10T00:00:00Z'),
    salaryRange: { min: 90000, max: 120000, currency: 'CAD' },
  },
  { text: 'No location' },
]
const ASHBY = {
  jobs: [
    {
      title: 'AI Engineer',
      jobUrl: 'https://jobs.ashbyhq.com/x/3',
      location: 'San Francisco',
      secondaryLocations: [{ location: 'New York' }],
      isRemote: true,
      descriptionPlain: 'Agents.',
      publishedAt: '2026-10-01T00:00:00Z',
      compensation: { compensationTierSummary: '$150K – $200K' },
    },
    {
      title: 'Support',
      jobUrl: 'https://jobs.ashbyhq.com/x/4',
      location: 'Victoria, BC',
      workplaceType: 'Hybrid',
    },
  ],
}

const board = (ats: Board['ats'], slug = 'acme'): Board => ({ company: 'Acme', ats, slug })

test('each ATS has its public endpoint', () => {
  assert.match(boardUrl(board('greenhouse')), /boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/)
  assert.match(boardUrl(board('lever')), /api\.lever\.co\/v0\/postings\/acme/)
  assert.match(boardUrl(board('ashby')), /api\.ashbyhq\.com\/posting-api\/job-board\/acme/)
})

test('responses normalize to one posting shape', () => {
  const [gh] = parseBoard(board('greenhouse'), GREENHOUSE)
  // When it was first posted, not last edited; the edit time only when that is all there is.
  assert.equal(gh?.postedAt, '2026-09-02T00:00:00Z')
  const [edited, undated] = parseBoard(board('greenhouse'), {
    jobs: [
      { title: 'Edited only', first_published: '', updated_at: '2026-10-18T00:00:00Z' },
      { title: 'Undated' },
    ],
  })
  assert.equal(edited?.postedAt, '2026-10-18T00:00:00Z')
  assert.equal(undated?.postedAt, undefined)
  assert.equal(gh?.role, 'Backend Engineer')
  assert.equal(gh?.location, 'Remote (Canada)')
  assert.match(gh?.description ?? '', /Build APIs & services/)
  const [lever, bare] = parseBoard(board('lever'), LEVER)
  assert.equal(lever?.location, 'Toronto, Ontario / Canada · remote')
  assert.equal(lever?.comp, 'CAD 90000–120000')
  assert.equal(bare?.location, '')
  const [ashby, local] = parseBoard(board('ashby'), ASHBY)
  assert.equal(ashby?.location, 'San Francisco / New York · Remote')
  assert.equal(ashby?.comp, '$150K – $200K')
  assert.equal(local?.location, 'Victoria, BC · Hybrid')
  assert.deepEqual(parseBoard(board('greenhouse'), null), [])
  assert.deepEqual(parseBoard(board('lever'), {}), [])
  assert.deepEqual(parseBoard(board('ashby'), {}), [])
  assert.equal(plain('<b>a</b><br>b&nbsp;&quot;c&quot; &#39;d&#39;'), 'a\nb "c" \'d\'')
})

test('reachable means Canada, or remote without another country named', () => {
  const at = (location: string): Posting => ({
    company: 'x',
    role: 'y',
    url: '',
    location,
    source: 'ashby',
    description: '',
  })
  assert.ok(isReachable(at('Victoria, BC')))
  assert.ok(isReachable(at('Remote (Canada)')))
  assert.ok(isReachable(at('CAN - Remote')))
  assert.ok(isReachable(at('Remote')))
  assert.ok(isReachable(at('')))
  assert.ok(!isReachable(at('Remote - U.S.')))
  assert.ok(!isReachable(at('San Francisco / New York · Remote')))
  assert.ok(!isReachable(at('Sydney · Remote')))
  assert.ok(!isReachable(at('Berlin')))
})

const fakeFetch =
  (bodies: Record<string, unknown>): Fetch =>
  async url => {
    const hit = Object.entries(bodies).find(([key]) => url.includes(key))
    if (!hit) return { ok: false, status: 404, json: async () => ({}) }
    if (hit[1] instanceof Error) throw hit[1]
    return { ok: true, status: 200, json: async () => hit[1] }
  }

test('fetchBoards reports a failing board without failing the rest', async () => {
  const results = await fetchBoards(
    [board('greenhouse'), board('lever', 'missing'), board('ashby', 'boom')],
    fakeFetch({ 'boards/acme': GREENHOUSE, 'job-board/boom': new Error('network down') }),
  )
  assert.equal(results[0]?.postings.length, 1)
  assert.equal(results[1]?.error, 'HTTP 404')
  assert.equal(results[2]?.error, 'network down')
})

test('jobs ats writes the reachable postings not already on the board; probe finds boards', async () => {
  const dir = join(root, 'data')
  commands.init(dir)
  await assert.rejects(commands.ats(dir, { fetcher: fakeFetch({}) }), /ats-boards\.json/)
  mkdirSync(join(dir, 'profile'), { recursive: true })
  writeFileSync(
    join(dir, 'profile', 'ats-boards.json'),
    JSON.stringify([board('greenhouse'), board('ashby', 'x'), board('lever', 'gone')]),
  )
  commands.add(dir, [
    {
      company: 'Acme',
      role: 'Backend Engineer',
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      source: 'greenhouse',
      location: '',
      comp: '',
      fitScore: 80,
      fitReason: 'on the board already',
    },
  ])
  const summary = await commands.ats(dir, {
    fetcher: fakeFetch({ 'boards/acme': GREENHOUSE, 'job-board/x': ASHBY }),
  })
  assert.equal(summary.boards, 3)
  assert.equal(summary.postings, 3)
  assert.equal(summary.fresh, 1)
  assert.equal(summary.errors[0]?.slug, 'gone')
  const written = JSON.parse(readFileSync(summary.file, 'utf8')) as Posting[]
  assert.deepEqual(
    written.map(one => one.role),
    ['Support'],
  )
  const all = await commands.ats(dir, {
    all: true,
    fetcher: fakeFetch({ 'boards/acme': GREENHOUSE, 'job-board/x': ASHBY }),
  })
  assert.equal(all.fresh, 2)

  const probed = await commands.probe('x', 'X', fakeFetch({ 'job-board/x': ASHBY }))
  assert.deepEqual(
    probed.map(one => [one.ats, one.found, one.postings]),
    [
      ['greenhouse', false, 0],
      ['lever', false, 0],
      ['ashby', true, 2],
    ],
  )
  assert.deepEqual(probed[2]?.reachable, ['Support — Victoria, BC · Hybrid'])
})
