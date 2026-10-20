// The job-tracker data CLI: the one writer of the data folder, used by the skills and the pane.
// Prints JSON on stdout; exits 1 with a message on stderr when a command fails.
import { parseArgs } from 'node:util'

import * as commands from './lib/commands.ts'
import type { FeedbackInput, ProposalInput } from './lib/commands.ts'
import type { IncomingLead, LeadPatch } from '../hooks/lib/model.ts'
import { gmailQuery, markGmailRead } from './lib/gmail.ts'
import { dataDir } from './lib/store.ts'

const USAGE = `jobs <command> [args] [--data <dir>]

  init                                   create the data files that are missing
  list [--column c] [--min n] [--limit n]
  summary                                counts for the band
  seen                                   ids, companies, roles and URLs already on the board
  add <json|@file> [--threshold 60]      merge scouted leads (array); prints added/updated/dropped/alerts
  move <id> <column> [--reason r] [--by actor] [--note n]
  pass <id> <reason>
  score <id> too-high|too-low
  snooze <id> <days>
  patch <id> <json|@file> [--by actor]   change fields of a lead
  mention <id>...                        mark leads as mentioned to the person
  feedback <json|@file>                  { leadId, kind, reason? }
  package <id> [--column ready] [--draft-id id] [--redraft]
                                         record packages/<id>/, render the résumé preview and diff
  diff <id>                              the tailored résumé against the master
  submitted <id>                         the person submitted it: move to Applied, follow up in 7 days
  propose <json|@file>                   add a learning proposal
  decide <proposal-id> approve|reject
  edits                                  the person's edits to drafted packages, as diffs
  ats [--all]                            fetch the Greenhouse/Lever/Ashby boards in profile/ats-boards.json
  probe <slug>... [--company name]       which ATS (if any) has a public board under this slug
  board-add <company> <ats> <slug>       add a public board to profile/ats-boards.json
  gmail query                            the Gmail search for job emails since the last run
  gmail done <iso>                       mark job emails up to <iso> (the newest read) as read`

async function main(argv: string[]): Promise<unknown> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      data: { type: 'string' },
      column: { type: 'string' },
      min: { type: 'string' },
      limit: { type: 'string' },
      threshold: { type: 'string' },
      reason: { type: 'string' },
      by: { type: 'string' },
      note: { type: 'string' },
      'draft-id': { type: 'string' },
      redraft: { type: 'boolean' },
      all: { type: 'boolean' },
      company: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command, ...args] = positionals
  if (!command || values.help) return USAGE
  const dir = dataDir(values.data)
  switch (command) {
    case 'init':
      return commands.init(dir)
    case 'list':
      return commands.list(dir, values)
    case 'summary':
      return commands.summary(dir)
    case 'seen':
      return commands.seen(dir)
    case 'add':
      return commands.add(
        dir,
        commands.readJsonArg<IncomingLead[]>(args[0]),
        values.threshold ?? 60,
      )
    case 'move':
      return commands.move(dir, need(args[0], 'id'), need(args[1], 'column'), values)
    case 'pass':
      return commands.move(dir, need(args[0], 'id'), 'passed', { reason: need(args[1], 'reason') })
    case 'score':
      return commands.score(dir, need(args[0], 'id'), need(args[1], 'correction'))
    case 'snooze':
      return commands.snooze(dir, need(args[0], 'id'), need(args[1], 'days'))
    case 'patch':
      return commands.patch(
        dir,
        need(args[0], 'id'),
        commands.readJsonArg<LeadPatch>(args[1]),
        values.by,
      )
    case 'mention':
      return commands.mention(dir, args)
    case 'feedback':
      return commands.feedback(dir, commands.readJsonArg<FeedbackInput>(args[0]))
    case 'package':
      return commands.registerPackage(dir, need(args[0], 'id'), {
        column: values.column,
        draftId: values['draft-id'],
        redraft: values.redraft,
      })
    case 'diff':
      return commands.resumeDiff(dir, need(args[0], 'id'))
    case 'submitted':
      return commands.submitted(dir, need(args[0], 'id'))
    case 'propose':
      return commands.propose(dir, commands.readJsonArg<ProposalInput>(args[0]))
    case 'decide':
      return commands.decide(dir, need(args[0], 'proposal id'), need(args[1], 'decision'))
    case 'edits':
      return commands.edits(dir)
    case 'ats':
      return commands.ats(dir, { all: values.all })
    case 'probe':
      return Promise.all(args.map(slug => commands.probe(slug, values.company ?? slug)))
    case 'board-add':
      return commands.addBoard(
        dir,
        need(args[0], 'company'),
        need(args[1], 'ats'),
        need(args[2], 'slug'),
      )
    case 'gmail':
      if (args[0] === 'query') return gmailQuery(dir)
      if (args[0] === 'done') return markGmailRead(dir, need(args[1], 'newest email time'))
      throw new Error('Use gmail query, or gmail done <iso>')
    default:
      throw new Error(`Unknown command ${command}\n\n${USAGE}`)
  }
}

function need(value: string | undefined, name: string): string {
  if (value === undefined || value === '') throw new Error(`Missing ${name}`)
  return value
}

main(process.argv.slice(2)).then(
  result => {
    process.stdout.write(
      typeof result === 'string' ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`,
    )
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  },
)
