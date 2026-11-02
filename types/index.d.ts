// The job-tracker contract: the JSON data files in the data folder, and the session values
// the pane and band draw from. The hooks module, bin/jobs.mjs and the skills all follow it.

export type Column =
  | 'new'
  | 'drafting'
  | 'ready'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  | 'passed'
  | 'archived'

/** The board's top row: work to do, applications made, and what is settled. */
export type BoardTab = 'active' | 'applications' | 'settled'

/**
 * A button of the board's second row: a column, or Ghosted, which is not stored: a ghosted lead sits
 * in `archived`, and its last move says so (`isGhosted` in hooks/lib/model.ts).
 */
export type Stage = Column | 'ghosted'

/** Who changed a lead; `tracker` is the board itself, e.g. archiving a lead left too long in New, or ghosting. */
export type Actor = 'user' | 'scout' | 'package' | 'submit' | 'sync' | 'learn' | 'model' | 'tracker'

export type HistoryEntry = {
  at: string
  by: Actor
  /** `created`, `moved`, `scored`, `mentioned`, `note` or `unclear` (`snoozed` in older history). */
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
   * The board ranks and shows it as is.
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
   * it does not change the score. Scout skips a posting dated over 14 days ago, and a New lead
   * is archived once its posting is that old (`POSTING_MAX_DAYS` in hooks/lib/model.ts).
   */
  postedAt?: string
  /** When the nudge named this lead in a conversation. */
  mentionedAt?: string
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

export type ChangeStatus = 'pending' | 'approved' | 'rejected'

/**
 * What the person wrote on a pending change: neither a decision nor a learning. The learn skill
 * revises the change with it (`jobs revise`) and reads it on later runs.
 */
export type Clarification = {
  at: string
  text: string
  /** The change's text when they wrote it: what the clarification corrected. */
  was: string
  /** When the revision landed; until then the change cannot be approved. */
  revisedAt?: string
}

/** One learning in a proposal, approved, rejected or clarified on its own. */
export type ProposalChange = {
  /** `c1`, `c2`, ... in proposal order; a change saved before ids existed takes its place's. */
  id: string
  file: 'learnings.md' | 'preferences.md'
  title: string
  rationale: string
  /** Markdown appended to the file under a dated heading when approved. */
  text: string
  /** A change saved before per-change decisions takes its proposal's status. */
  status: ChangeStatus
  decidedAt?: string
  /** Oldest first; at most the last one is still waiting for its revision. */
  clarifications?: Clarification[]
}

/**
 * A weekly learning proposal (`proposals.json`): each change is applied only when approved.
 * `status` follows from the changes: `pending` while any is pending, `decided` once none are.
 * A proposal saved before per-change decisions may still read `approved` or `rejected`.
 */
export type Proposal = {
  id: string
  createdAt: string
  status: 'pending' | 'decided' | 'approved' | 'rejected'
  summary: string
  /** The funnel summary in Markdown. */
  funnel: string
  changes: ProposalChange[]
  /** Why the review proposed fewer than three changes. */
  fewerReason?: string
  /** When the last change was decided. */
  decidedAt?: string
}

export type ProposalsFile = { version: 1; proposals: Proposal[] }

/** What the pane draws from: the data files as last read. */
export type JobBoard = {
  dataDir: string | null
  leads: Lead[]
  applications: Application[]
  proposals: Proposal[]
  /**
   * What each Ready lead's package still asks of the person, by lead id; empty means ready to
   * submit, and a lead with no readable `answers.md` has no entry. Worked out on every refresh,
   * never saved. Absent on a board kept across a hot reload from before this field.
   */
  openQuestions?: Record<string, string[]>
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
 * names the agent, at the latest when its run starts with `task`. A revision's `leadId` is the
 * change it revises (`clarifyKey`) and its `company` that change's title.
 */
export type DraftRun = {
  /** A package build (absent, from before prefills), a background prefill, or a revision. */
  kind?: 'draft' | 'submit' | 'revise'
  /** A prefill whose report went to the conversation, which is asking and submitting now. */
  isHandedOn?: true
  agentId?: string
  leadId: string
  company: string
  task: string
  at: number
}

/**
 * A background prefill as the Chrome guard knows it, kept for the whole session (unlike its
 * DraftRun, which lapses), so a long run never slips out from under the guard.
 */
export type PrefillGuard = {
  agentId: string
  /** When it started (ms): past the run hold, an end never heard is looked for in the agent list. */
  at: number
  /**
   * The tabs it opened with tabs_create_mcp: the only ones it may act in, which no other caller
   * may touch while it runs, and the ones checked when it ends.
   */
  tabs: number[]
  /** The Claude in Chrome server those tabs belong to, as its tool names spell it. */
  browser?: string
  /** Its subagent ended: its tabs are the conversation's now. */
  isDone?: true
}

declare module 'claude-code' {
  interface PluginState {
    'job-tracker': {
      board: JobBoard
      view: JobView
      pkg: JobPackage | null
      /** The board's top-row tab; each opening starts on Active. */
      boardTab: BoardTab
      /** The tab's selected stage; null until the person picks one. */
      stage: Stage | null
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
      /** The change whose clarification field is open (`clarifyKey`); null when none. */
      clarifying: string | null
      /** True while a main-loop turn runs: a prompt sent now waits for it to end. */
      turning: boolean
      /** Prompts the pane sent whose turn has not started yet. */
      sent: SentPrompt[]
      /** Archivable leads this session already asked `jobs archive` to take; each is tried once. */
      swept: string[]
      /** Package builds this session spawned as background subagents, until each one ends. */
      drafts: DraftRun[]
      /** Every background prefill this session started, for the Chrome guard. */
      prefills: PrefillGuard[]
    }
  }
}
