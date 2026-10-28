// The pane's views: the board, one lead, a package, and the learning proposals. Each draws
// with the surface's own element table; desktop and terminal act, mobile only reads.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type {
  JobBoard,
  JobPackage,
  PackageTab,
  Proposal,
  ProposalChange,
} from '../types/index.d.ts'
import {
  ago,
  COLUMN_TITLES,
  columnLeads,
  columnTitle,
  defaultStage,
  leadAges,
  previousColumn,
  PASS_REASONS,
  PIPELINE,
  recentlyGhosted,
  scoreTone,
  sourceLabel,
  STAGE_ACTIONS,
  TAGLINE_CHARS,
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
  cancelPass: () => void
  pass: (lead: Lead, reason: string) => void
  score: (lead: Lead, correction: 'too-high' | 'too-low') => void
  draft: (lead: Lead) => void
  review: (lead: Lead, tab?: PackageTab) => void
  submit: (lead: Lead) => void
  openPdf: (path: string) => void
  /** Decides one change of a proposal, or `all` its pending ones. */
  decide: (proposalId: string, changeId: string, decision: 'approve' | 'reject') => void
}

export type ViewContext = {
  el: Table
  surface: RenderSurface
  board: JobBoard
  now: number
  columns: number
  busy: string | null
  /** The lead whose pass reasons are open; null when none. */
  passing: string | null
  /** What the pane's buttons sent to the conversation that has not started yet. */
  queued: string[]
  /** Undefined on a surface that only reads. */
  act: Actions | undefined
  /** Navigation stays available where acting is not. */
  nav: Pick<Actions, 'open' | 'board' | 'proposals' | 'review' | 'tab' | 'more'>
}

/** Cards a stage shows at first, and how many more each "Show more" adds. */
export const PAGE = 10
/** What the résumé pages may take of the pane tree's 100,000 characters (bin/lib/preview.ts). */
const PREVIEW_BUDGET = 90_000

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

function header(ctx: ViewContext, title: string, back: boolean): RenderElement {
  const { Box, Text, Button } = ctx.el
  return (
    <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
      {back && <Button key="back" label="← Board" onPress={() => ctx.nav.board()} />}
      <Text bold>{title}</Text>
      {ctx.busy && <Text dimColor>{ctx.busy}…</Text>}
      {queuedNotes(ctx)}
    </Box>
  )
}

/** Prompts the buttons sent that wait for Claude to finish the current reply. */
function queuedNotes(ctx: ViewContext): RenderElement[] {
  const { Text } = ctx.el
  return ctx.queued.map(label => (
    <Text key={`queued:${label}`} color="claude">{`${label}: queued…`}</Text>
  ))
}

/**
 * The fit score as a coloured chip: green for strong, amber for worth a look, grey for weak.
 * `↓`/`↑` marks the person's own correction of it.
 */
function badge(ctx: ViewContext, lead: Lead, key: string): RenderElement {
  const { Text } = ctx.el
  const score = lead.fitScore
  const mark =
    lead.scoreCorrection === 'too-high' ? '↓' : lead.scoreCorrection === 'too-low' ? '↑' : ''
  return (
    <Text key={key} bold color="inverseText" backgroundColor={scoreTone(score)}>
      {` ${score}${mark} `}
    </Text>
  )
}

/** Runs one of a stage's actions on a lead. */
function run(ctx: ViewContext, lead: Lead, action: StageAction): void {
  const act = ctx.act
  if (!act) return
  // Opening the reasons writes nothing, so a write still running does not hold it up.
  if (action.kind === 'pass') {
    act.askPass(lead)
    return
  }
  // While an earlier press is still being written, a second one would record it twice.
  if (ctx.busy) return
  if (action.kind === 'move') act.move(lead, action.to)
  else if (action.kind === 'outcome') act.outcome(lead, action.to, action.reason)
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

/** Whether the lead's stage offers Pass among its own actions (New does). */
const passInStage = (lead: Lead) => STAGE_ACTIONS[lead.column].some(one => one.kind === 'pass')

/**
 * The reasons a pass is recorded with, drawn under the row whose Pass opened them: one more
 * press records the pass for the weekly review.
 */
function passReasons(ctx: ViewContext, lead: Lead, suffix: string): RenderElement | null {
  const { Box, Text, Button } = ctx.el
  const act = ctx.act
  if (!act || ctx.passing !== lead.id) return null
  return (
    <Box key={`reasons${suffix}`} flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
      <Text key={`why${suffix}`} color="warning">
        Why pass?
      </Text>
      {PASS_REASONS.map(reason => (
        <Button
          key={`reason:${reason}${suffix}`}
          label={reason}
          onPress={() => act.pass(lead, reason)}
        />
      ))}
      <Button
        key={`cancel-pass${suffix}`}
        dimColor
        label="Cancel"
        onPress={() => act.cancelPass()}
      />
    </Box>
  )
}

/** The card's third line: the tagline, or the fit reason until scout has written one. */
const oneLiner = (lead: Lead) => (lead.tagline?.trim() || lead.fitReason || '').replace(/\s+/g, ' ')

function card(ctx: ViewContext, lead: Lead): RenderElement {
  const { Box, Text, Button } = ctx.el
  const { added, posted } = leadAges(lead, ctx.now)
  const facts = [
    `added ${added === 'now' ? 'just now' : added}`,
    posted && `posted ${posted}`,
    sourceLabel(lead.source),
    lead.location,
  ].filter(Boolean)
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
      <Text key={`tagline:${lead.id}`} wrap="truncate-end">
        {clip(oneLiner(lead), TAGLINE_CHARS)}
      </Text>
      {lead.column === 'drafting' && <Text dimColor>Package being drafted…</Text>}
      {ctx.act && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {stageButtons(ctx, lead, `:${lead.id}`)}
        </Box>
      )}
      {passInStage(lead) && passReasons(ctx, lead, `:${lead.id}`)}
    </Box>
  )
}

/**
 * The applications the board marked ghosted this week, each a button to its page, where "Back to
 * Applied" undoes it: the toast is seen only by the session that ghosted them, often a scheduled
 * run.
 */
function ghostedNotice(ctx: ViewContext, file: { version: 1; leads: Lead[] }) {
  const { Box, Text, Button } = ctx.el
  const ghosted = recentlyGhosted(file, ctx.now)
  if (ghosted.length === 0) return null
  return (
    <Box key="ghosted" flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
      <Text color="warning">Marked ghosted, no reply a month after applying:</Text>
      {ghosted.slice(0, PAGE).map(lead => (
        <Button
          key={`ghost-notice:${lead.id}`}
          label={`${clip(lead.company, 30)} · ${clip(lead.role, 40)}`}
          onPress={() => ctx.nav.open(lead.id)}
        />
      ))}
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
  // Each learning is approved or rejected on its own, so the count is the learnings left.
  const pendingChanges = ctx.board.proposals
    .flatMap(one => one.changes)
    .filter(one => one.status === 'pending').length
  const closed: Column[] = ['passed', 'archived']
  const closedCount = ctx.board.leads.filter(lead => closed.includes(lead.column)).length
  const tabs = options.showClosed ? [...PIPELINE, ...closed] : PIPELINE
  const stage = options.stage && tabs.includes(options.stage) ? options.stage : defaultStage(file)
  const leads = columnLeads(file, stage)
  const visible = leads.slice(0, Math.max(options.shown, PAGE))
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Text bold>Jobs</Text>
        <Text dimColor>{`${ctx.board.leads.length} leads`}</Text>
        {ctx.busy && <Text dimColor>{ctx.busy}…</Text>}
        {queuedNotes(ctx)}
        {ctx.act && <Button key="refresh" label="Refresh" onPress={() => ctx.act?.refresh()} />}
        {pendingChanges > 0 && (
          <Button
            key="proposals"
            variant="primary"
            label={`Learning proposals (${pendingChanges})`}
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
      {ghostedNotice(ctx, file)}
      <Box key="tabs" flexDirection="row" gap={1} flexWrap="wrap">
        {tabs.map(column => (
          <Button
            key={`tab:${column}`}
            label={`${COLUMN_TITLES[column]} ${columnLeads(file, column).length}`}
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

/** The company line and the role's highlights as Markdown; empty when scout wrote neither. */
export function leadSummary(lead: Pick<Lead, 'companyBlurb' | 'roleHighlights'>): string {
  const highlights = (lead.roleHighlights ?? []).map(one => one.trim()).filter(Boolean)
  return [
    lead.companyBlurb?.trim() ? `**Company:** ${lead.companyBlurb.trim()}` : '',
    highlights.length > 0 ? `**The role:**\n${highlights.map(one => `- ${one}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function leadView(ctx: ViewContext, id: string): RenderElement {
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
  const ages = leadAges(lead, ctx.now)
  const facts = [
    COLUMN_TITLES[lead.column],
    sourceLabel(lead.source),
    `added ${ago(ages.added)}`,
    ages.posted && `posted ${ago(ages.posted)}`,
    lead.location,
    lead.comp,
  ].filter(Boolean)
  const summary = leadSummary(lead)
  const act = ctx.act
  const passing = ctx.passing === lead.id
  // The reasons open under the row that holds the lead's Pass button.
  const passFromStage = passInStage(lead)
  const passFromOther = lead.column !== 'passed' && !passFromStage
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
      {summary && <Markdown key="summary" text={summary} />}
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
          {passFromStage && passReasons(ctx, lead, '')}
          <Box key="other" flexDirection="row" gap={1} flexWrap="wrap">
            {passFromOther && (
              <Button
                key="pass-any"
                label="Pass…"
                variant={passing ? 'primary' : undefined}
                onPress={() => act.askPass(lead)}
              />
            )}
            {lead.column !== 'archived' && (
              <Button key="archive" label="Archive" onPress={() => act.move(lead, 'archived')} />
            )}
            {lead.column !== 'new' && (lead.column !== 'ready' || app) && (
              <Button
                key="redraft"
                label={app ? 'Redraft package' : 'Draft package'}
                onPress={() => act.draft(lead)}
              />
            )}
          </Box>
          {passFromOther && passReasons(ctx, lead, '')}
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
            {`${entry.at.slice(0, 16).replace('T', ' ')}  ${entry.by}: ${entry.action}${entry.to ? ` → ${columnTitle(entry.to)}` : ''}${entry.note ? ` (${entry.note})` : ''}`}
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
          <Button key="submit" label="Approve and submit" onPress={() => ctx.act?.submit(lead)} />
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
  // A pane's whole tree is capped at 100,000 characters, the SVG sources included: past it the
  // surface draws nothing at all, so the view takes the pages that fit and leaves the rest to
  // the PDF. A package drawn before the preview fitted (`jobs preview <id>` redraws it) may fit
  // no part.
  let room = PREVIEW_BUDGET
  const pages: string[] = []
  for (const source of loaded.svgs) {
    if (source.length > room) break
    room -= source.length
    pages.push(source)
  }
  // Every table names every element, so the surface, not the table, says whether Svg draws.
  if (ctx.surface !== 'terminal' && 'Svg' in ctx.el && pages.length > 0) {
    const { Svg } = ctx.el
    return (
      <Box flexDirection="column">
        {open}
        <Box key="pages" flexDirection="column" gap={0}>
          {pages.map((source, n) => (
            <Svg
              key={`page:${n}`}
              source={source}
              alt={`Résumé, page ${n + 1} of ${loaded.svgs.length}`}
            />
          ))}
        </Box>
        {pages.length < loaded.svgs.length && (
          <Text key="more-pages" dimColor>
            The rest of the résumé is in the PDF.
          </Text>
        )}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {open}
      <Text dimColor>
        {!loaded.pdfPath
          ? 'No résumé PDF in this package yet.'
          : ctx.surface === 'terminal'
            ? 'The résumé preview draws in the desktop app; Open PDF shows it here.'
            : 'The résumé preview is too large to draw here; Open PDF shows it.'}
      </Text>
    </Box>
  )
}

/** Pending proposals drawn in full, newest first; decided ones as one line per change. */
const FULL_PROPOSALS = 2
const DECIDED_PROPOSALS = 4

export function proposalsView(ctx: ViewContext): RenderElement {
  const { Box, Text, Button, Markdown } = ctx.el
  const newest = [...ctx.board.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const pending = newest.filter(one => one.status === 'pending')
  const decided = newest.filter(one => one.status !== 'pending')
  const hidden = Math.max(0, pending.length - FULL_PROPOSALS)
  // A decided change is one line: its outcome and title. Only pending ones carry their text.
  const outcome = (proposal: Proposal, change: ProposalChange) => (
    <Text
      key={`outcome:${proposal.id}:${change.id}`}
      color={change.status === 'approved' ? 'success' : 'subtle'}
    >
      {`${change.status === 'approved' ? '✓ Approved' : '✗ Rejected'}${
        change.decidedAt ? ` ${change.decidedAt.slice(0, 10)}` : ''
      } · ${change.title}${change.status === 'approved' ? ` → ${change.file}` : ''}`}
    </Text>
  )
  const counted = (proposal: Proposal) => {
    const open = proposal.changes.filter(one => one.status === 'pending').length
    const approved = proposal.changes.filter(one => one.status === 'approved').length
    return `${proposal.createdAt.slice(0, 10)} · ${
      open > 0
        ? `${open} of ${proposal.changes.length} to review`
        : `${approved} of ${proposal.changes.length} approved`
    }`
  }
  return (
    <Box flexDirection="column" gap={1}>
      {header(ctx, 'Learning proposals', true)}
      {newest.length === 0 && (
        <Text dimColor>No proposals yet. The learn skill writes one each week.</Text>
      )}
      {pending.slice(0, FULL_PROPOSALS).map(proposal => {
        const open = proposal.changes.filter(one => one.status === 'pending').length
        return (
          <Box
            key={`p:${proposal.id}`}
            flexDirection="column"
            borderStyle="round"
            paddingX={1}
            gap={1}
          >
            <Text key={`head:${proposal.id}`} bold>
              {counted(proposal)}
            </Text>
            <Markdown
              key={`summary:${proposal.id}`}
              text={`${proposal.summary}\n\n${proposal.funnel}`}
            />
            {proposal.fewerReason && (
              <Text key={`fewer:${proposal.id}`} dimColor>
                {`Fewer than three changes: ${proposal.fewerReason}`}
              </Text>
            )}
            {proposal.changes.map(change =>
              change.status !== 'pending' ? (
                outcome(proposal, change)
              ) : (
                <Box key={`change:${proposal.id}:${change.id}`} flexDirection="column">
                  <Markdown
                    key={`text:${proposal.id}:${change.id}`}
                    text={`**${change.title}** → \`${change.file}\`\n\n_${change.rationale}_\n\n${change.text}`}
                  />
                  {ctx.act && (
                    <Box flexDirection="row" gap={1}>
                      <Button
                        key={`approve:${proposal.id}:${change.id}`}
                        variant="primary"
                        label="Approve"
                        onPress={() => ctx.act?.decide(proposal.id, change.id, 'approve')}
                      />
                      <Button
                        key={`reject:${proposal.id}:${change.id}`}
                        label="Reject"
                        onPress={() => ctx.act?.decide(proposal.id, change.id, 'reject')}
                      />
                    </Box>
                  )}
                </Box>
              ),
            )}
            {ctx.act && open > 1 && (
              <Box flexDirection="row" gap={1}>
                <Button
                  key={`approve:${proposal.id}:all`}
                  label="Approve all remaining"
                  onPress={() => ctx.act?.decide(proposal.id, 'all', 'approve')}
                />
                <Button
                  key={`reject:${proposal.id}:all`}
                  label="Reject all remaining"
                  onPress={() => ctx.act?.decide(proposal.id, 'all', 'reject')}
                />
              </Box>
            )}
          </Box>
        )
      })}
      {hidden > 0 && (
        <Text key="hidden" dimColor>
          {hidden === 1
            ? '1 older proposal waits: it shows once one above is decided.'
            : `${hidden} older proposals wait: they show once one above is decided.`}
        </Text>
      )}
      {decided.slice(0, DECIDED_PROPOSALS).map(proposal => (
        <Box key={`p:${proposal.id}`} flexDirection="column" paddingX={1}>
          <Text key={`head:${proposal.id}`} bold dimColor>
            {proposal.changes.length > 0
              ? counted(proposal)
              : `${proposal.createdAt.slice(0, 10)} · no changes proposed`}
          </Text>
          {/* A week with nothing to decide still says what the review found, and why. */}
          {proposal.changes.length === 0 && (
            <Markdown
              key={`summary:${proposal.id}`}
              text={`${proposal.summary}${proposal.fewerReason ? `\n\n_${proposal.fewerReason}_` : ''}`}
            />
          )}
          {proposal.changes.map(change => outcome(proposal, change))}
        </Box>
      ))}
    </Box>
  )
}
