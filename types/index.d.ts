// The job-tracker contract: the JSON data files in the data folder, and the session values
// the pane and band draw from. The hooks module, bin/jobs.mjs and the skills all follow it.

export type Column =
  'new' | 'drafting' | 'ready' | 'applied' | 'interviewing' | 'offer' | 'passed' | 'archived'

/** Who changed a lead; `tracker` is the board itself, e.g. archiving a lead left too long in New, or ghosting. */
export type Actor = 'user' | 'scout' | 'package' | 'submit' | 'sync' | 'learn' | 'model' | 'tracker'

export type HistoryEntry = {
  at: string
  by: Actor
  /** `created`, `moved`, `scored`, `mentioned` or `note` (`snoozed` in older history). */
  action: string
  /** Older entries may name `shortlisted`, a column the board no longer has. */
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
  /**
   * 0-100 against preferences.md and learnings.md: the scout's fit judgement, which never ages.
   * The board ranks and shows it aged by how long ago the lead was added, `foundAt`
   * (`effectiveScore` in hooks/lib/model.ts).
   */
  fitScore: number
  /** One line: why this score. */
  fitReason: string
  /**
   * One sentence on what the company makes: product category, who it is for and the flagship
   * product by name when known. Stage, size or location only as a trailing clause.
   */
  companyBlurb?: string
  /**
   * What the card shows under its facts: at most ~40 characters on what the company makes or
   * what the role is, e.g. `Scheduling software for home care`. One line, no padding.
   */
  tagline?: string
  /** Two to four short points on what is distinctive about this role (team, stack, comp, setup). */
  roleHighlights?: string[]
  column: Column
  passReason?: string
  foundAt: string
  /**
   * When the posting went up, when its source says (ATS boards do). Shown beside the lead's age;
   * it does not age the score, and scout skips a posting dated over 30 days ago.
   */
  postedAt?: string
  /** When the nudge named this lead in a conversation. */
  mentionedAt?: string
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
  /** The résumé PDF as SVG pages, in order, for the pane. */
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

/** `snooze` only in events recorded before snoozing was removed; none are recorded now. */
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
  /**
   * Who recorded it when the person did not: `tracker` for an outcome the board recorded on its
   * own (an application ghosted a month after it was submitted with no reply). Absent otherwise.
   */
  by?: Actor
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
  | { kind: 'lead'; id: string }
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

/** A prompt a pane button sent, until its turn starts; a plugin's prompt waits for idle. */
export type SentPrompt = {
  text: string
  label: string
  at: number
  /** The text that entered, when a hook rewrote it: what its turn starts with. */
  entered?: string
}

/**
 * A package build the pane started as a background subagent. `agentId` is known once the engine
 * names the agent, at the latest when its run starts with `task`.
 */
export type DraftRun = {
  /** A package build (absent, from before prefills) or an application's background prefill. */
  kind?: 'draft' | 'submit'
  /** A prefill whose report went to the conversation, which is asking and submitting now. */
  isHandedOn?: true
  agentId?: string
  leadId: string
  company: string
  task: string
  at: number
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
      /** The lead whose pass reasons are open, on its card or its own page; null when none. */
      passing: string | null
      /** True while a main-loop turn runs: a prompt sent now waits for it to end. */
      turning: boolean
      /** Prompts the pane sent whose turn has not started yet. */
      sent: SentPrompt[]
      /** Archivable leads this session already asked `jobs archive` to take; each is tried once. */
      swept: string[]
      /** Package builds this session spawned as background subagents, until each one ends. */
      drafts: DraftRun[]
    }
  }
}
