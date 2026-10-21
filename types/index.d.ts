// The job-tracker contract: the JSON data files in the data folder, and the session values
// the pane and band draw from. The hooks module, bin/jobs.mjs and the skills all follow it.

export type Column =
  | 'new'
  | 'shortlisted'
  | 'drafting'
  | 'ready'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'passed'
  | 'archived'

export type Actor = 'user' | 'scout' | 'package' | 'submit' | 'sync' | 'learn' | 'model'

export type HistoryEntry = {
  at: string
  by: Actor
  /** `created`, `moved`, `scored`, `snoozed`, `mentioned` or `note`. */
  action: string
  from?: Column
  to?: Column
  note?: string
}

/** One posting on the board (`leads.json`). */
export type Lead = {
  /** Stable slug of company and role, so a re-found posting dedupes onto its card. */
  id: string
  company: string
  role: string
  url: string
  /** Where scout found it: `greenhouse`, `lever`, `ashby`, `viatec`, `gmail:linkedin`, `hn`, `web`. */
  source: string
  location: string
  /** As posted, e.g. "CAD 90k-135k"; empty when unknown. */
  comp: string
  /** 0-100 against preferences.md and learnings.md. */
  fitScore: number
  /** One line: why this score. */
  fitReason: string
  /** One sentence from the posting or the company's site: what it builds, for whom, stage or size. */
  companyBlurb?: string
  /** Two to four short points on what is distinctive about this role (team, stack, comp, setup). */
  roleHighlights?: string[]
  column: Column
  passReason?: string
  foundAt: string
  /** When the nudge named this lead in a conversation. */
  mentionedAt?: string
  snoozedUntil?: string
  followUpAt?: string
  /** The person's correction of the score, kept beside the original. */
  scoreCorrection?: 'too-high' | 'too-low'
  closesAt?: string
  notes?: string
  history: HistoryEntry[]
}

export type LeadsFile = { version: 1; leads: Lead[] }

/** The files of a package, by role, relative to its folder. */
export type PackageFiles = {
  resumeTex?: string
  resumePdf?: string
  resumeDiff?: string
  coverLetter?: string
  answers?: string
  brief?: string
  warmIntro?: string
  /** The résumé PDF as SVG strips, top to bottom, for the pane. */
  preview?: string[]
}

/** One application package (`applications.json`). */
export type Application = {
  leadId: string
  /** Relative to the data folder: `packages/<lead-id>`. */
  dir: string
  createdAt: string
  updatedAt: string
  files: PackageFiles
  submittedAt?: string
  /** The Gmail draft of the warm-intro ask, when one was drafted. */
  warmIntroDraftId?: string
  status: 'drafting' | 'ready' | 'submitted' | 'withdrawn'
}

export type ApplicationsFile = { version: 1; applications: Application[] }

export type FeedbackKind =
  'pass' | 'score-too-high' | 'score-too-low' | 'move' | 'snooze' | 'outcome' | 'package-edit'

/** One thing the person did that learn reads (`feedback.json`). */
export type FeedbackEvent = {
  id: string
  at: string
  leadId: string
  kind: FeedbackKind
  reason?: string
  from?: Column
  to?: Column
  /** The lead's source and score when it happened, so learn can group by them. */
  source?: string
  fitScore?: number
}

export type FeedbackFile = { version: 1; events: FeedbackEvent[] }

export type ProposalChange = {
  file: 'learnings.md' | 'preferences.md'
  title: string
  rationale: string
  /** Markdown appended to the file under a dated heading when approved. */
  text: string
}

/** A weekly learning proposal (`proposals.json`), applied only when approved. */
export type Proposal = {
  id: string
  createdAt: string
  status: 'pending' | 'approved' | 'rejected'
  summary: string
  /** The funnel summary in Markdown. */
  funnel: string
  changes: ProposalChange[]
  decidedAt?: string
}

export type ProposalsFile = { version: 1; proposals: Proposal[] }

/** What the pane draws from: the data files as last read. */
export type JobBoard = {
  dataDir: string | null
  leads: Lead[]
  applications: Application[]
  proposals: Proposal[]
  loadedAt: number
  error: string | null
}

export type PackageTab = 'resume' | 'diff' | 'cover' | 'answers' | 'brief' | 'intro'

export type JobView =
  | { kind: 'board' }
  | { kind: 'lead'; id: string; passing?: boolean }
  | { kind: 'package'; id: string; tab: PackageTab }
  | { kind: 'proposals' }

/** A package's files read for the viewer. */
export type JobPackage = {
  leadId: string
  pdfPath: string | null
  svgs: string[]
  texts: Partial<Record<PackageTab, string>>
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'job-tracker': {
      board: JobBoard
      view: JobView
      pkg: JobPackage | null
      showClosed: boolean
      /** The board's selected stage tab; null until the person picks one. */
      stage: Column | null
      /** How many cards the selected stage shows (grows by ten with "Show more"). */
      shown: number
      /** Leads the nudge named in this session's first prompt, marked when the turn ends. */
      pending: string[]
      /** The turn that was running when the nudged prompt was typed; its end is not the reply. */
      pendingTurn: string | null
      /** True once this session's first user prompt was seen. */
      nudged: boolean
      busy: string | null
    }
  }
}
