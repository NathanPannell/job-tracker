// A data folder in memory beneath the mod: `$.fs.read` answers from it, and `$.process.run`
// of `bin/jobs.ts` applies the same model functions the real CLI applies, so a press in the
// pane or a tool call lands in these files the way it lands on disk.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  appendEvent,
  archiveStale,
  correctScore,
  emptyFeedback,
  eventId,
  ghostSilent,
  markMentioned,
  moveLead,
  patchLead,
} from '../hooks/lib/model.ts'
import type {
  Application,
  ApplicationsFile,
  Column,
  FeedbackFile,
  FeedbackKind,
  Lead,
  LeadsFile,
  MoveResult,
  Proposal,
} from '../hooks/lib/model.ts'

export const DATA = '/data'
export const NOW = Date.parse('2026-10-20T12:00:00.000Z')

export function lead(id: string, fields: Partial<Lead> = {}): Lead {
  return {
    id,
    company: id.split('-')[0] ?? id,
    role: 'Backend Developer',
    url: `https://jobs.example.com/${id}`,
    source: 'ashby',
    location: 'Victoria, BC',
    comp: '',
    fitScore: 80,
    fitReason: 'Backend APIs in Victoria',
    column: 'new',
    // An hour before NOW: too fresh to have aged, so badges show the fit score.
    foundAt: '2026-10-20T11:00:00.000Z',
    history: [],
    ...fields,
  }
}

export type World = {
  clock: ReturnType<typeof mock.clock>
  files: Map<string, string>
  runs: string[][]
  /** Lines the mod logged with `$.ui.log`, in order. */
  logs: string[]
  spawns: { prompt: string; description?: string; subagentType?: string }[]
  /** Makes every later spawn refused with `reason`; undefined lets them start again. */
  refuseSpawns: (reason: string | undefined) => void
  /** Makes every later jobs CLI write fail with `reason`; undefined lets them through again. */
  failWrites: (reason: string | undefined) => void
  leads: () => Lead[]
  feedback: () => FeedbackFile['events']
}

/** Installs the in-memory data folder, environment, clock and session beneath the mod. */
export function world(
  on: On,
  seed: { leads?: Lead[]; applications?: Application[]; proposals?: Proposal[] } = {},
  extraFiles: Record<string, string> = {},
): World {
  const files = new Map<string, string>()
  const put = (name: string, value: unknown) => files.set(`${DATA}/${name}`, JSON.stringify(value))
  put('leads.json', { version: 1, leads: seed.leads ?? [] })
  put('applications.json', { version: 1, applications: seed.applications ?? [] })
  put('proposals.json', { version: 1, proposals: seed.proposals ?? [] })
  put('feedback.json', emptyFeedback())
  for (const [path, text] of Object.entries(extraFiles)) files.set(path, text)
  const runs: string[][] = []

  mock.env(on, { JOB_TRACKER_DATA: DATA, OS: 'Windows_NT' })
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__job-tracker__${e.name}` } }))
  const logs: string[] = []
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/'))
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })

  const leadsFile = (): LeadsFile => JSON.parse(files.get(`${DATA}/leads.json`) ?? '{}')
  const feedbackFile = (): FeedbackFile => JSON.parse(files.get(`${DATA}/feedback.json`) ?? '{}')
  const at = new Date(NOW).toISOString()
  const commit = (result: MoveResult) => {
    if (result.error) return { exitCode: 1, stdout: '', stderr: result.error }
    put('leads.json', result.leads)
    if (result.event) put('feedback.json', appendEvent(feedbackFile(), result.event))
    return { exitCode: 0, stdout: '{}', stderr: '' }
  }

  // A subagent starts. Core would answer with its id; the kit hands the plugin none, so a test
  // raises the run's `turn.start` (with its prompt) and `turn.complete` under an id of its own.
  const spawns: { prompt: string; description?: string; subagentType?: string }[] = []
  let refusal: string | undefined
  let writeFailure: string | undefined
  on('agent.spawn', (_, e) => {
    if (refusal !== undefined) return { deny: refusal }
    spawns.push({ prompt: e.prompt, description: e.description, subagentType: e.subagentType })
    return { model: 'test-model' }
  })

  on('process.run', (_, e) => ({
    value: { ...run([...e.argv]), isStdoutTruncated: false, isStderrTruncated: false },
  }))

  function run(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
    runs.push(argv)
    if (!(argv[1] ?? '').endsWith('bin/jobs.ts')) return { exitCode: 0, stdout: '', stderr: '' }
    const [command, ...rest] = argv.slice(2, argv.indexOf('--data'))
    const args = rest.filter(
      (_, n) => !(rest[n - 1] ?? '').startsWith('--') && !(rest[n] ?? '').startsWith('--'),
    )
    const [id = '', second = ''] = args
    const file = leadsFile()
    if (writeFailure !== undefined && command !== 'list') {
      return { exitCode: 1, stdout: '', stderr: writeFailure }
    }
    switch (command) {
      case 'move': {
        const reason = rest[rest.indexOf('--reason') + 1]
        const passReason = rest.includes('--reason') ? reason : undefined
        return commit(moveLead(file, id, second as Column, at, 'user', { passReason }))
      }
      case 'pass':
        return commit(moveLead(file, id, 'passed', at, 'user', { passReason: second }))
      case 'score':
        return commit(correctScore(file, id, second as 'too-high' | 'too-low', at))
      case 'patch':
        return commit(patchLead(file, id, JSON.parse(second), at, 'model'))
      case 'mention':
        put('leads.json', markMentioned(file, args, at))
        return { exitCode: 0, stdout: '{}', stderr: '' }
      case 'archive': {
        const stale = archiveStale(file, at)
        const applications: ApplicationsFile = JSON.parse(
          files.get(`${DATA}/applications.json`) ?? '{}',
        )
        const silent = ghostSilent(stale.leads, applications, feedbackFile(), at)
        put('leads.json', silent.leads)
        put('feedback.json', silent.feedback)
        const { archived } = stale
        const { ghosted } = silent
        return { exitCode: 0, stdout: JSON.stringify({ archived, ghosted }), stderr: '' }
      }
      case 'list':
        return { exitCode: 0, stdout: JSON.stringify(file.leads), stderr: '' }
      case 'feedback': {
        const input = JSON.parse(id) as { leadId: string; kind: FeedbackKind; reason?: string }
        const event = { id: eventId(at, input.leadId, input.kind), at, ...input }
        put('feedback.json', appendEvent(feedbackFile(), event))
        return { exitCode: 0, stdout: JSON.stringify(event), stderr: '' }
      }
      default:
        return { exitCode: 1, stdout: '', stderr: `unknown command ${command}` }
    }
  }

  return {
    clock,
    files,
    runs,
    logs,
    spawns,
    refuseSpawns: reason => {
      refusal = reason
    },
    failWrites: reason => {
      writeFailure = reason
    },
    leads: () => leadsFile().leads,
    feedback: () => feedbackFile().events,
  }
}

export const PANE_PROPS = {
  title: 'Jobs',
  isFocused: true,
  bodyColumns: 120,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}
