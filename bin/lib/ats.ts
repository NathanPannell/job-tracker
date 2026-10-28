// Reads the public job-board APIs of Greenhouse, Lever and Ashby for the boards listed in the
// data folder's `profile/ats-boards.json`, and returns their postings in one shape for scout
// to score. Public endpoints only: no login, no scraping.

export type Ats = 'greenhouse' | 'lever' | 'ashby'

export type Board = { company: string; ats: Ats; slug: string }

export type Posting = {
  company: string
  role: string
  url: string
  location: string
  source: Ats
  /** Plain text, cut to keep scout's context small. */
  description: string
  postedAt?: string
  comp?: string
}

const DESCRIPTION_CHARS = 1_500

export function boardUrl(board: Board): string {
  const slug = encodeURIComponent(board.slug)
  switch (board.ats) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
    case 'lever':
      return `https://api.lever.co/v0/postings/${slug}?mode=json`
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`
  }
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&amp;': '&',
}

const decode = (text: string) => text.replace(/&(lt|gt|quot|#39|nbsp|amp);/g, m => ENTITIES[m] ?? m)

/** HTML, or entity-escaped HTML as Greenhouse sends it, to plain text. */
export function plain(html: string): string {
  return decode(
    decode(html)
      .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .trim()
}

type GreenhouseJob = {
  title?: string
  absolute_url?: string
  location?: { name?: string }
  content?: string
  first_published?: string
  updated_at?: string
}
type LeverJob = {
  text?: string
  hostedUrl?: string
  categories?: { location?: string; allLocations?: string[] }
  descriptionPlain?: string
  workplaceType?: string
  createdAt?: number
  salaryRange?: { min?: number; max?: number; currency?: string }
}
type AshbyJob = {
  title?: string
  jobUrl?: string
  location?: string
  secondaryLocations?: { location?: string }[]
  isRemote?: boolean
  workplaceType?: string
  descriptionPlain?: string
  publishedAt?: string
  compensation?: { compensationTierSummary?: string }
}

/** Normalizes one board's API response. */
export function parseBoard(board: Board, body: unknown): Posting[] {
  const base = { company: board.company, source: board.ats }
  const cut = (text: string) => plain(text).slice(0, DESCRIPTION_CHARS)
  if (board.ats === 'greenhouse') {
    const jobs = ((body as { jobs?: GreenhouseJob[] })?.jobs ?? []) as GreenhouseJob[]
    return jobs.map(job => ({
      ...base,
      role: job.title ?? '',
      url: job.absolute_url ?? '',
      location: job.location?.name ?? '',
      description: cut(job.content ?? ''),
      // `updated_at` moves on every edit, so an old posting can look new; prefer first posted.
      ...(job.first_published || job.updated_at
        ? { postedAt: job.first_published || job.updated_at }
        : {}),
    }))
  }
  if (board.ats === 'lever') {
    const jobs = (Array.isArray(body) ? body : []) as LeverJob[]
    return jobs.map(job => {
      const places = job.categories?.allLocations ?? [job.categories?.location ?? '']
      const range = job.salaryRange
      return {
        ...base,
        role: job.text ?? '',
        url: job.hostedUrl ?? '',
        location: [places.filter(Boolean).join(' / '), job.workplaceType]
          .filter(Boolean)
          .join(' · '),
        description: cut(job.descriptionPlain ?? ''),
        ...(job.createdAt ? { postedAt: new Date(job.createdAt).toISOString() } : {}),
        ...(range?.min
          ? { comp: `${range.currency ?? ''} ${range.min}–${range.max ?? ''}`.trim() }
          : {}),
      }
    })
  }
  const jobs = ((body as { jobs?: AshbyJob[] })?.jobs ?? []) as AshbyJob[]
  return jobs.map(job => ({
    ...base,
    role: job.title ?? '',
    url: job.jobUrl ?? '',
    location: [
      [job.location, ...(job.secondaryLocations ?? []).map(one => one.location)]
        .filter(Boolean)
        .join(' / '),
      job.isRemote ? 'Remote' : job.workplaceType,
    ]
      .filter(Boolean)
      .join(' · '),
    description: cut(job.descriptionPlain ?? ''),
    ...(job.publishedAt ? { postedAt: job.publishedAt } : {}),
    ...(job.compensation?.compensationTierSummary
      ? { comp: job.compensation.compensationTierSummary }
      : {}),
  }))
}

const CANADA =
  /victoria|vancouver|british columbia|\bbc\b|canada|canadian|\bcan\b|toronto|montreal|ottawa|calgary|edmonton|waterloo/i
const REMOTE = /remote|anywhere|distributed|work from home/i
const ELSEWHERE =
  /united states|\busa?\b|\bu\.s\.|europe|emea|apac|latam|\buk\b|united kingdom|london|germany|berlin|france|paris|india|singapore|australia|brazil|mexico|japan|israel|ireland|netherlands|spain|poland|portugal|new york|san francisco|seattle|menlo park|austin|boston|chicago|denver|sydney|,\s*(ca|ny|wa|tx|ma|co|il)\b/i

/**
 * Whether a posting could be worked from Victoria: in BC or elsewhere in Canada, or remote
 * without naming only another country. An empty location is kept for scout to judge.
 */
export function isReachable(posting: Posting): boolean {
  const where = posting.location
  if (!where.trim()) return true
  if (CANADA.test(where)) return true
  return REMOTE.test(where) && !ELSEWHERE.test(where)
}

export type Fetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export type BoardResult = { board: Board; postings: Posting[]; error?: string }

/** Fetches every board in parallel; a board that fails is reported, not fatal. */
export async function fetchBoards(
  boards: readonly Board[],
  fetcher: Fetch = fetch,
): Promise<BoardResult[]> {
  return Promise.all(
    boards.map(async board => {
      try {
        const response = await fetcher(boardUrl(board))
        if (!response.ok) return { board, postings: [], error: `HTTP ${response.status}` }
        return { board, postings: parseBoard(board, await response.json()) }
      } catch (error) {
        return {
          board,
          postings: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )
}
