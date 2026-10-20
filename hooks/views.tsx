// The pane's views: the board, one lead, a package, and the learning proposals. Each draws
// with the surface's own element table; desktop and terminal act, mobile only reads.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { JobBoard, JobPackage, PackageTab } from '../types/index.d.ts'
import {
  age,
  COLUMN_TITLES,
  columnLeads,
  defaultStage,
  isSnoozed,
  previousColumn,
  PASS_REASONS,
  PIPELINE,
  scoreTone,
  sourceLabel,
  STAGE_ACTIONS,
} from './lib/model.ts'
import type { Column, Lead, StageAction } from './lib/model.ts'

export type Table = Elements[RenderSurface]

/** What a view may do; absent on a read-only surface (mobile). */
export type Actions = {
  open: (id: string) => void
  board: () => void
  proposals: () => void
  refresh: () => void
  toggleClosed: () => void
  tab: (column: Column) => void
  more: () => void
  move: (lead: Lead, to: Column) => void
  outcome: (lead: Lead, to: Column, reason: string) => void
  askPass: (lead: Lead) => void
  pass: (lead: Lead, reason: string) => void
  score: (lead: Lead, correction: 'too-high' | 'too-low') => void
  snooze: (lead: Lead, days: number) => void
  draft: (lead: Lead) => void
  review: (lead: Lead, tab?: PackageTab) => void
  submit: (lead: Lead) => void
  openPdf: (path: string) => void
  decide: (proposalId: string, decision: 'approve' | 'reject') => void
}

export type ViewContext = {
  el: Table
  surface: RenderSurface
  board: JobBoard
  now: number
  columns: number
  busy: string | null
  /** Undefined on a surface that only reads. */
  act: Actions | undefined
  /** Navigation stays available where acting is not. */
  nav: Pick<Actions, 'open' | 'board' | 'proposals' | 'review' | 'tab' | 'more'>
}

/** Cards a stage shows at first, and how many more each "Show more" adds. */
export const PAGE = 10
const SNOOZE_OPTIONS = [
  { value: '3', label: 'Snooze 3 days' },
  { value: '7', label: 'Snooze a week' },
  { value: '14', label: 'Snooze two weeks' },
]

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

function header(ctx: ViewContext, title: string, back: boolean): RenderElement {
  const { Box, Text, Button } = ctx.el
  return (
    <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
      {back && <Button key="back" label="← Board" onPress={() => ctx.nav.board()} />}
      <Text bold>{title}</Text>
      {ctx.busy && <Text dimColor>{ctx.busy}…</Text>}
    </Box>
  )
}

/** The fit score as a coloured chip: green for strong, amber for worth a look, grey for weak. */
function badge(ctx: ViewContext, lead: Lead, key: string): RenderElement {
  const { Text } = ctx.el
  const mark =
    lead.scoreCorrection === 'too-high' ? '↓' : lead.scoreCorrection === 'too-low' ? '↑' : ''
  return (
    <Text key={key} bold color="inverseText" backgroundColor={scoreTone(lead.fitScore)}>
      {` ${lead.fitScore}${mark} `}
    </Text>
  )
}

/** Runs one of a stage's actions on a lead. */
function run(ctx: ViewContext, lead: Lead, action: StageAction): void {
  const act = ctx.act
  // While an earlier press is still being written, a second one would record it twice.
  if (!act || ctx.busy) return
  if (action.kind === 'move') act.move(lead, action.to)
  else if (action.kind === 'outcome') act.outcome(lead, action.to, action.reason)
  else if (action.kind === 'pass') act.askPass(lead)
  else if (action.kind === 'draft') act.draft(lead)
  else if (action.kind === 'review') act.review(lead)
  else act.submit(lead)
}

/** A stage's actions as labelled buttons, its next step highlighted. */
function stageButtons(ctx: ViewContext, lead: Lead, suffix: string): RenderElement[] {
  const { Button } = ctx.el
  const hasPackage = ctx.board.applications.some(one => one.leadId === lead.id)
  const actions: StageAction[] = STAGE_ACTIONS[lead.column]
    .filter(action => (action.kind === 'review' || action.kind === 'submit' ? hasPackage : true))
    .map(action =>
      action.kind === 'draft' && hasPackage ? { ...action, label: 'Redraft package' } : action,
    )
  // Ready without a package (moved there by hand): drafting it is the way on.
  if (actions.length === 0 && lead.column === 'ready') {
    actions.push({ key: 'draft', label: 'Draft package', kind: 'draft', primary: true })
  }
  // A closed lead can go straight back to where it was, undoing a mis-click.
  const from = previousColumn(lead)
  if ((lead.column === 'passed' || lead.column === 'archived') && from && from !== 'new') {
    actions.unshift({
      key: 'restore',
      label: `Back to ${COLUMN_TITLES[from]}`,
      kind: 'move',
      to: from,
    })
  }
  return actions.map(action => (
    <Button
      key={`${action.key}${suffix}`}
      label={action.label}
      variant={action.primary ? 'primary' : undefined}
      onPress={() => run(ctx, lead, action)}
    />
  ))
}

function card(ctx: ViewContext, lead: Lead): RenderElement {
  const { Box, Text, Button } = ctx.el
  const snoozed = isSnoozed(lead, ctx.now)
  const facts = [age(lead.foundAt, ctx.now), sourceLabel(lead.source), lead.location]
    .concat(snoozed ? ['snoozed'] : [])
    .filter(Boolean)
  return (
    <Box key={`card:${lead.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
      <Box flexDirection="row" gap={1} alignItems="flex-start">
        {badge(ctx, lead, `score:${lead.id}`)}
        <Button key={`open:${lead.id}`} plain onPress={() => ctx.nav.open(lead.id)}>
          <Text bold>{clip(lead.company, 40)}</Text>
          {` · ${clip(lead.role, 80)}`}
        </Button>
      </Box>
      <Text dimColor wrap="truncate-end">
        {facts.join(' · ')}
      </Text>
      <Text wrap="truncate-end">{lead.fitReason}</Text>
      {lead.column === 'drafting' && <Text dimColor>Package being drafted…</Text>}
      {ctx.act && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {stageButtons(ctx, lead, `:${lead.id}`)}
        </Box>
      )}
    </Box>
  )
}

export function boardView(
  ctx: ViewContext,
  options: { showClosed: boolean; stage: Column | null; shown: number },
): RenderElement {
  const { Box, Text, Button, Markdown } = ctx.el
  if (!ctx.board.dataDir) {
    return (
      <Box flexDirection="column" gap={1}>
        {header(ctx, 'Jobs', false)}
        <Markdown text="Set `JOB_TRACKER_DATA` to the data folder in `~/.claude/settings.json` (see SETUP.md), then start a new session." />
      </Box>
    )
  }
  const file = { version: 1 as const, leads: ctx.board.leads }
  const pendingProposals = ctx.board.proposals.filter(one => one.status === 'pending').length
  const closed: Column[] = ['passed', 'archived']
  const closedCount = ctx.board.leads.filter(lead => closed.includes(lead.column)).length
  const tabs = options.showClosed ? [...PIPELINE, ...closed] : PIPELINE
  const stage = options.stage && tabs.includes(options.stage) ? options.stage : defaultStage(file)
  const leads = columnLeads(file, stage, ctx.now)
  const visible = leads.slice(0, Math.max(options.shown, PAGE))
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Text bold>Jobs</Text>
        <Text dimColor>{`${ctx.board.leads.length} leads`}</Text>
        {ctx.busy && <Text dimColor>{ctx.busy}…</Text>}
        {ctx.act && <Button key="refresh" label="Refresh" onPress={() => ctx.act?.refresh()} />}
        {pendingProposals > 0 && (
          <Button
            key="proposals"
            variant="primary"
            label={`Learning proposals (${pendingProposals})`}
            onPress={() => ctx.nav.proposals()}
          />
        )}
        {ctx.act && (
          <Button
            key="closed"
            label={
              options.showClosed ? 'Hide passed & archived' : `Passed & archived (${closedCount})`
            }
            onPress={() => ctx.act?.toggleClosed()}
          />
        )}
      </Box>
      {ctx.board.error && <Text color="warning">{ctx.board.error}</Text>}
      <Box key="tabs" flexDirection="row" gap={1} flexWrap="wrap">
        {tabs.map(column => (
          <Button
            key={`tab:${column}`}
            label={`${COLUMN_TITLES[column]} ${columnLeads(file, column, ctx.now).length}`}
            variant={column === stage ? 'primary' : undefined}
            onPress={() => ctx.nav.tab(column)}
          />
        ))}
      </Box>
      <Box key={`stage:${stage}`} flexDirection="column" gap={0}>
        {leads.length === 0 && <Text dimColor>{`Nothing in ${COLUMN_TITLES[stage]} yet.`}</Text>}
        {visible.map(lead => card(ctx, lead))}
        {leads.length > visible.length && (
          <Button
            key="more"
            label={`Show ${Math.min(PAGE, leads.length - visible.length)} more (${leads.length - visible.length} left)`}
            onPress={() => ctx.nav.more()}
          />
        )}
      </Box>
    </Box>
  )
}

export function leadView(ctx: ViewContext, id: string, passing: boolean): RenderElement {
  const { Box, Text, Button, Link, Markdown } = ctx.el
  const Select = 'Select' in ctx.el ? ctx.el.Select : undefined
  const lead = ctx.board.leads.find(one => one.id === id)
  if (!lead) {
    return (
      <Box flexDirection="column" gap={1}>
        {header(ctx, 'Lead not found', true)}
      </Box>
    )
  }
  const app = ctx.board.applications.find(one => one.leadId === id)
  const facts = [
    COLUMN_TITLES[lead.column],
    sourceLabel(lead.source),
    `found ${age(lead.foundAt, ctx.now)} ago`,
    lead.location,
    lead.comp,
  ].filter(Boolean)
  const act = ctx.act
  return (
    <Box flexDirection="column" gap={1}>
      {header(ctx, `${lead.company} — ${lead.role}`, true)}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {badge(ctx, lead, 'score')}
        <Text dimColor wrap="wrap">
          {facts.join(' · ')}
        </Text>
      </Box>
      {lead.url.startsWith('https:') ? (
        <Link href={lead.url} label="Open posting ↗" />
      ) : (
        <Text dimColor>{lead.url || 'No posting URL'}</Text>
      )}
      <Markdown
        text={`**Why this score:** ${lead.fitReason}${
          lead.notes
            ? `

**Notes:** ${lead.notes}`
            : ''
        }${
          lead.passReason
            ? `

**Passed:** ${lead.passReason}`
            : ''
        }`}
      />
      {act && (
        <Box flexDirection="column" gap={1}>
          <Box key="next" flexDirection="row" gap={1} flexWrap="wrap">
            {stageButtons(ctx, lead, '')}
            {app && lead.column !== 'ready' && (
              <Button key="review-any" label="Review package" onPress={() => act.review(lead)} />
            )}
          </Box>
          <Box key="other" flexDirection="row" gap={1} flexWrap="wrap">
            {lead.column !== 'passed' && lead.column !== 'new' && (
              <Button
                key="pass-any"
                label={passing ? 'Pass: pick a reason' : 'Pass…'}
                onPress={() => act.askPass(lead)}
              />
            )}
            {lead.column !== 'archived' && (
              <Button key="archive" label="Archive" onPress={() => act.move(lead, 'archived')} />
            )}
            {lead.column !== 'shortlisted' && (lead.column !== 'ready' || app) && (
              <Button
                key="redraft"
                label={app ? 'Redraft package' : 'Draft package'}
                onPress={() => act.draft(lead)}
              />
            )}
          </Box>
          {passing && (
            <Box key="reasons" flexDirection="row" gap={1} flexWrap="wrap">
              {PASS_REASONS.map(reason => (
                <Button
                  key={`reason:${reason}`}
                  label={reason}
                  onPress={() => act.pass(lead, reason)}
                />
              ))}
            </Box>
          )}
          <Box key="feedback" flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
            <Text dimColor>Feedback</Text>
            <Button
              key="too-high"
              dimColor
              label="Score too high"
              onPress={() => act.score(lead, 'too-high')}
            />
            <Button
              key="too-low"
              dimColor
              label="Score too low"
              onPress={() => act.score(lead, 'too-low')}
            />
            {Select && (
              <Select
                key="snooze"
                label="Snooze"
                options={SNOOZE_OPTIONS}
                onSelect={value => act.snooze(lead, Number(value))}
              />
            )}
          </Box>
        </Box>
      )}
      {!act && app && (
        <Button key="review" label="Review package" onPress={() => ctx.nav.review(lead)} />
      )}
      <Text bold>History</Text>
      {lead.history
        .slice(-6)
        .reverse()
        .map((entry, n) => (
          <Text key={`h:${n}`} dimColor wrap="truncate-end">
            {`${entry.at.slice(0, 16).replace('T', ' ')}  ${entry.by}: ${entry.action}${entry.to ? ` → ${COLUMN_TITLES[entry.to]}` : ''}${entry.note ? ` (${entry.note})` : ''}`}
          </Text>
        ))}
    </Box>
  )
}

const TABS: [PackageTab, string][] = [
  ['resume', 'Résumé'],
  ['diff', 'Résumé vs master'],
  ['cover', 'Cover letter'],
  ['answers', 'Answers'],
  ['brief', 'Company brief'],
  ['intro', 'Warm intro'],
]

export function packageView(
  ctx: ViewContext,
  id: string,
  tab: PackageTab,
  loaded: JobPackage | null,
): RenderElement {
  const { Box, Text, Button, Markdown, Code } = ctx.el
  const lead = ctx.board.leads.find(one => one.id === id)
  const title = lead ? `Package: ${lead.company} — ${lead.role}` : 'Package'
  const isLoaded = loaded !== null && loaded.leadId === id
  const tabs = TABS.filter(([key]) => key === 'resume' || (isLoaded && loaded.texts[key]))
  let body: RenderElement
  if (!isLoaded) {
    body = <Text dimColor>Loading the package…</Text>
  } else if (loaded.error) {
    body = <Text color="warning">{loaded.error}</Text>
  } else if (tab === 'resume') {
    body = resumeBody(ctx, loaded)
  } else if (tab === 'diff') {
    const diff = loaded.texts.diff ?? ''
    body = diff.includes('@@') ? (
      <Code key="diff" source={diff} format="diff" language="latex" />
    ) : (
      <Text dimColor>The tailored résumé matches the master.</Text>
    )
  } else {
    body = <Markdown key={`md:${tab}`} text={loaded.texts[tab] ?? '_Not drafted._'} />
  }
  return (
    <Box flexDirection="column" gap={1}>
      {header(ctx, title, true)}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {tabs.map(([key, label]) => (
          <Button
            key={`tab:${key}`}
            label={label}
            variant={key === tab ? 'primary' : undefined}
            onPress={() => lead && ctx.nav.review(lead, key)}
          />
        ))}
        {ctx.act && lead && lead.column === 'ready' && (
          <Button key="submit" label="Approve & submit" onPress={() => ctx.act?.submit(lead)} />
        )}
      </Box>
      {body}
    </Box>
  )
}

function resumeBody(ctx: ViewContext, loaded: JobPackage): RenderElement {
  const { Box, Text, Button, Markdown } = ctx.el
  const fileUrl = loaded.pdfPath
    ? `file:///${loaded.pdfPath.replace(/\\/g, '/').replace(/^\/+/, '')}`
    : ''
  const open = loaded.pdfPath && ctx.act && (
    <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
      <Button
        key="open-pdf"
        label="Open PDF"
        onPress={() => loaded.pdfPath && ctx.act?.openPdf(loaded.pdfPath)}
      />
      <Markdown
        key="pdf-link"
        text={`[${loaded.pdfPath.split('/').pop() ?? 'resume.pdf'}](${fileUrl})`}
      />
    </Box>
  )
  // Every table names every element, so the surface, not the table, says whether Svg draws.
  if (ctx.surface !== 'terminal' && 'Svg' in ctx.el && loaded.svgs.length > 0) {
    const { Svg } = ctx.el
    return (
      <Box flexDirection="column">
        {open}
        <Box key="pages" flexDirection="column" gap={0}>
          {loaded.svgs.map((source, n) => (
            <Svg
              key={`strip:${n}`}
              source={source}
              alt={`Résumé, part ${n + 1} of ${loaded.svgs.length}`}
            />
          ))}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {open}
      <Text dimColor>
        {loaded.pdfPath
          ? 'The résumé preview draws in the desktop app; Open PDF shows it here.'
          : 'No résumé PDF in this package yet.'}
      </Text>
    </Box>
  )
}

export function proposalsView(ctx: ViewContext): RenderElement {
  const { Box, Text, Button, Markdown } = ctx.el
  const proposals = [...ctx.board.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <Box flexDirection="column" gap={1}>
      {header(ctx, 'Learning proposals', true)}
      {proposals.length === 0 && (
        <Text dimColor>No proposals yet. The learn skill writes one each week.</Text>
      )}
      {proposals.slice(0, 6).map(proposal => (
        <Box
          key={`p:${proposal.id}`}
          flexDirection="column"
          borderStyle="round"
          paddingX={1}
          gap={1}
        >
          <Text bold>{`${proposal.createdAt.slice(0, 10)} · ${proposal.status}`}</Text>
          <Markdown
            key={`summary:${proposal.id}`}
            text={`${proposal.summary}\n\n${proposal.funnel}`}
          />
          {proposal.changes.map((change, n) => (
            <Markdown
              key={`change:${proposal.id}:${n}`}
              text={`**${change.title}** → \`${change.file}\`\n\n_${change.rationale}_\n\n${change.text}`}
            />
          ))}
          {ctx.act && proposal.status === 'pending' && (
            <Box flexDirection="row" gap={1}>
              <Button
                key={`approve:${proposal.id}`}
                variant="primary"
                label="Approve"
                onPress={() => ctx.act?.decide(proposal.id, 'approve')}
              />
              <Button
                key={`reject:${proposal.id}`}
                label="Reject"
                onPress={() => ctx.act?.decide(proposal.id, 'reject')}
              />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}
