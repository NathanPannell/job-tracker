// The pane's views: the board, one lead, a package, and the learning proposals. Each draws
// with the surface's own element table; desktop and terminal act, mobile only reads.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { JobBoard, JobPackage, PackageTab } from '../types/index.d.ts'
import {
  age,
  COLUMN_TITLES,
  columnLeads,
  isSnoozed,
  neighbour,
  PASS_REASONS,
  PIPELINE,
} from './lib/model.ts'
import type { Column, Lead } from './lib/model.ts'

export type Table = Elements[RenderSurface]

/** What a view may do; absent on a read-only surface (mobile). */
export type Actions = {
  open: (id: string) => void
  board: () => void
  proposals: () => void
  refresh: () => void
  toggleClosed: () => void
  toggleExpanded: (column: Column) => void
  move: (lead: Lead, to: Column) => void
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
  nav: Pick<Actions, 'open' | 'board' | 'proposals' | 'review'>
}

const CARD_LIMIT = 8
const COLUMN_WIDTH = 34

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

function card(ctx: ViewContext, lead: Lead): RenderElement {
  const { Box, Text, Button } = ctx.el
  const left = neighbour(lead.column, -1)
  const right = neighbour(lead.column, 1)
  const snoozed = isSnoozed(lead, ctx.now)
  return (
    <Box key={`card:${lead.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
      <Button key={`open:${lead.id}`} plain onPress={() => ctx.nav.open(lead.id)}>
        <Text bold>{clip(lead.company, 40)}</Text>
      </Button>
      <Text wrap="wrap">{clip(lead.role, 70)}</Text>
      <Text dimColor wrap="truncate-end">
        {`fit ${lead.fitScore}${lead.scoreCorrection ? ` (${lead.scoreCorrection})` : ''} · ${age(lead.foundAt, ctx.now)} · ${lead.source}${snoozed ? ' · snoozed' : ''}`}
      </Text>
      <Text dimColor wrap="wrap">
        {clip(lead.fitReason, 140)}
      </Text>
      {ctx.act && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {left && (
            <Button key={`left:${lead.id}`} label="◀" onPress={() => ctx.act?.move(lead, left)} />
          )}
          {right && (
            <Button key={`right:${lead.id}`} label="▶" onPress={() => ctx.act?.move(lead, right)} />
          )}
          <Button
            key={`details:${lead.id}`}
            label="Details"
            onPress={() => ctx.nav.open(lead.id)}
          />
        </Box>
      )}
    </Box>
  )
}

function column(ctx: ViewContext, name: Column, expandedColumns: readonly string[], width: number) {
  const { Box, Text, Button } = ctx.el
  const leads = columnLeads({ version: 1, leads: ctx.board.leads }, name, ctx.now)
  const isOpen = expandedColumns.includes(name)
  const shown = isOpen ? leads : leads.slice(0, CARD_LIMIT)
  return (
    <Box key={`col:${name}`} flexDirection="column" width={width} gap={0}>
      <Text bold>{`${COLUMN_TITLES[name]} (${leads.length})`}</Text>
      {leads.length === 0 && <Text dimColor>—</Text>}
      {shown.map(lead => card(ctx, lead))}
      {leads.length > CARD_LIMIT && (
        <Button
          key={`more:${name}`}
          label={isOpen ? 'Show fewer' : `Show all ${leads.length}`}
          onPress={() => ctx.act?.toggleExpanded(name) ?? ctx.nav.board()}
        />
      )}
    </Box>
  )
}

export function boardView(
  ctx: ViewContext,
  options: { showClosed: boolean; expanded: readonly string[] },
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
  const pendingProposals = ctx.board.proposals.filter(one => one.status === 'pending').length
  const perRow = Math.max(1, Math.floor(ctx.columns / COLUMN_WIDTH))
  const width = Math.max(24, Math.floor(ctx.columns / Math.min(perRow, PIPELINE.length)) - 1)
  const closed: Column[] = ['passed', 'archived']
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
            label={options.showClosed ? 'Hide passed' : 'Show passed & archived'}
            onPress={() => ctx.act?.toggleClosed()}
          />
        )}
      </Box>
      {ctx.board.error && <Text color="warning">{ctx.board.error}</Text>}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
        {PIPELINE.map(name => column(ctx, name, options.expanded, width))}
      </Box>
      {options.showClosed && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {closed.map(name => column(ctx, name, options.expanded, width))}
        </Box>
      )}
      {!options.showClosed && (
        <Text dimColor>
          {closed
            .map(
              name =>
                `${COLUMN_TITLES[name]}: ${ctx.board.leads.filter(l => l.column === name).length}`,
            )
            .join(' · ')}
        </Text>
      )}
    </Box>
  )
}

export function leadView(ctx: ViewContext, id: string, passing: boolean): RenderElement {
  const { Box, Text, Button, Link, Markdown } = ctx.el
  const lead = ctx.board.leads.find(one => one.id === id)
  if (!lead) {
    return (
      <Box flexDirection="column" gap={1}>
        {header(ctx, 'Lead not found', true)}
      </Box>
    )
  }
  const app = ctx.board.applications.find(one => one.leadId === id)
  const left = neighbour(lead.column, -1)
  const right = neighbour(lead.column, 1)
  const facts = [
    `fit ${lead.fitScore}${lead.scoreCorrection ? ` (marked ${lead.scoreCorrection})` : ''}`,
    COLUMN_TITLES[lead.column],
    lead.source,
    `found ${age(lead.foundAt, ctx.now)} ago`,
    lead.location,
    lead.comp,
  ].filter(Boolean)
  const act = ctx.act
  return (
    <Box flexDirection="column" gap={1}>
      {header(ctx, `${lead.company} — ${lead.role}`, true)}
      <Text dimColor wrap="wrap">
        {facts.join(' · ')}
      </Text>
      {lead.url.startsWith('https:') ? (
        <Link href={lead.url} label="Open posting ↗" />
      ) : (
        <Text dimColor>{lead.url || 'No posting URL'}</Text>
      )}
      <Markdown
        text={`**Why this score:** ${lead.fitReason}${lead.notes ? `\n\n**Notes:** ${lead.notes}` : ''}${lead.passReason ? `\n\n**Passed:** ${lead.passReason}` : ''}`}
      />
      {act && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {left && (
              <Button
                key="left"
                label={`◀ ${COLUMN_TITLES[left]}`}
                onPress={() => act.move(lead, left)}
              />
            )}
            {right && (
              <Button
                key="right"
                label={`${COLUMN_TITLES[right]} ▶`}
                onPress={() => act.move(lead, right)}
              />
            )}
            {lead.column !== 'archived' && (
              <Button key="archive" label="Archive" onPress={() => act.move(lead, 'archived')} />
            )}
            {lead.column !== 'passed' && (
              <Button
                key="pass"
                label={passing ? 'Pass: pick a reason' : 'Pass…'}
                onPress={() => act.askPass(lead)}
              />
            )}
          </Box>
          {passing && (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {PASS_REASONS.map(reason => (
                <Button
                  key={`reason:${reason}`}
                  label={reason}
                  onPress={() => act.pass(lead, reason)}
                />
              ))}
            </Box>
          )}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button
              key="too-high"
              label="Score too high"
              onPress={() => act.score(lead, 'too-high')}
            />
            <Button
              key="too-low"
              label="Score too low"
              onPress={() => act.score(lead, 'too-low')}
            />
            <Button key="snooze-3" label="Snooze 3 days" onPress={() => act.snooze(lead, 3)} />
            <Button key="snooze-7" label="Snooze a week" onPress={() => act.snooze(lead, 7)} />
          </Box>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button
              key="draft"
              label={app ? 'Redraft package' : 'Draft package'}
              variant={app ? undefined : 'primary'}
              onPress={() => act.draft(lead)}
            />
            {app && (
              <Button
                key="review"
                label="Review package"
                variant="primary"
                onPress={() => act.review(lead)}
              />
            )}
            {app && lead.column === 'ready' && (
              <Button key="submit" label="Approve & submit" onPress={() => act.submit(lead)} />
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
