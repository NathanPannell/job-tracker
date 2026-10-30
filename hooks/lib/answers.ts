// What a package's `answers.md` still asks of the person. The package skill marks each question
// the record cannot answer with `NEEDS ANSWER:`; older packages wrote the marker inline, bold, in
// table cells and under a heading, and are never redrafted. The submit skill leaves `answers.md`
// as drafted and saves replies to the shared record, so a question answered there stops counting.
// A wrong "Ready to submit" costs more than a wrong count, so a marker counts unless it is plainly
// prose about the marker, and a saved answer clears a question only on a clear match.
// Nothing here touches a file; the callers read.

import type { Lead } from '../../types/index.d.ts'

/** The person's saved answers, relative to the data folder (skills/submit/SKILL.md). */
export const SAVED_ANSWERS = 'profile/knowledge-base/application-answers.md'

/** A question as drawn, and the normalised forms it is matched by; the first is its identity. */
export type Question = { text: string; keys: string[] }

/**
 * One entry of the saved answers. `companies` is absent for any application; empty, when the
 * scope names none it can read, the entry covers only the lead it was asked for.
 */
export type SavedAnswer = { key: string; leadId?: string; companies?: string[] }

const MARKER = /(?<![\p{L}\p{N}])NEEDS\s+ANSWERS?(?![\p{L}\p{N}])/gu

/** A heading of the marker alone: a label over what follows, not a question of its own. */
const SECTION = /^#+\s*[*_`]*NEEDS\s+ANSWERS?[*_`:\s]*(?:\([^)]*\)[*_`:\s]*)?$/u

/** What closes the marker: emphasis, a note in brackets, and the separator before the question. */
const AFTER_MARKER = /^[\s*_`)\]]*(?:\([^)]*\)[\s*_`)\]]*)?([:—–-]?)[\s*_`]*/

/** Words that make a sentence about the marker a statement that nothing is open. */
const NEGATION = /\b(?:no|not|nothing|none|never|without)\b/i

/** What says the marker is being talked about: "NEEDS ANSWER items". */
const ABOUT_MARKER = /^(?:items?|questions?|entries|fields?|lines?|markers?)\b/i

/** An entry that says there is nothing to answer. */
const NOTHING = /^(?:none|nothing|n\/a|no (?:open |more )?questions?)\b/i

/** A note in brackets at the end of a question, as opposed to brackets that tell two apart. */
const NOTE = /\s*\((?:required|optional|if\b|any\b|not\b|no\b|see\b)[^)]*\)?$/i

/** A heading's hashes, or a list item's bullet or number. */
const BLOCK_MARK = /^(?:#+|[-*+]|\d+[.)])\s+/

/** What the card names a marker by when the file gives it no words at all. */
export const UNNAMED = 'A question with no wording, see the Answers tab'

/** A line that starts a new block rather than continuing the one above. */
const BLOCK_START = /^(?:#|\||[-*+] |\d+[.)] )/

const hasMarker = (text: string) => text.search(MARKER) >= 0

/** Lower case, no accents, words and digits only: how two wordings of a question are compared. */
const key = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Markdown's emphasis and code marks out, and all space collapsed. */
const plain = (text: string) => text.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim()

/**
 * The question without what follows it: up to its `?`, or without its first sentence's end, a
 * closing note and trailing punctuation. A stop after an initial ("U.S.") ends no sentence.
 */
const short = (text: string) =>
  /^.*?\?/.exec(text)?.[0] ??
  text
    .replace(/(?<=[a-z)]{2})\.\s.*$/, '')
    .replace(NOTE, '')
    .replace(/[\s.:;,([—–-]+$/, '')

/**
 * The file's list items, paragraphs, headings and table rows, each as one string, so that a
 * question wrapped onto a second line reads whole.
 */
function blocks(markdown: string): string[] {
  const found: string[] = []
  let open = false
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) open = false
    else if (open && !BLOCK_START.test(line)) found.push(`${found.pop()}\n${line}`)
    else {
      found.push(line)
      // A heading or a table row is whole on its line.
      open = !/^[#|]/.test(line)
    }
  }
  return found
}

/**
 * The questions one block marks, skipping prose about the marker: a sentence saying nothing is
 * open ("left as NEEDS ANSWER", "no `NEEDS ANSWER` items"). Beside the marker's own text a question
 * may have the form's wording, the bold text before it or the row's first cell; a marker with no
 * question of its own takes that, or the words before it, or the heading over it.
 */
function marked(block: string, heading: string): Question[] {
  const row = block.startsWith('|')
  const cells = row ? block.split(/(?<!\\)\|/).map(cell => cell.trim()) : [block]
  const first = cells.find(cell => /\p{L}/u.test(cell) && !hasMarker(cell))
  return cells.flatMap(cell => {
    const parts = cell.split(MARKER)
    return parts.slice(1).flatMap((after, n) => {
      const before = parts[n] ?? ''
      const [closing = '', separator] = AFTER_MARKER.exec(after) ?? []
      const rest = plain(after.slice(closing.length))
      const asks = rest.includes('?')
      const bold = /\*\*([^*]+)\*\*[\s:—–-]*$/.exec(before)?.[1]
      const sentence = before.split(/[.!?;:](?:\s|$)/).at(-1) ?? ''
      const denied = !asks && !bold && NEGATION.test(sentence)
      if (denied || NOTHING.test(rest) || (!separator && ABOUT_MARKER.test(rest))) return []
      const form = n === 0 ? short(plain((row ? first : bold) ?? '')) : ''
      const said = short(rest)
      const words = n === 0 ? short(plain(before.replace(BLOCK_MARK, ''))) : ''
      const text = asks ? said : form || said || words || heading || UNNAMED
      const keys = asks ? [said, form] : text === UNNAMED ? [] : [text]
      return [{ text, keys: keys.map(key).filter(Boolean) }]
    })
  })
}

/** A block under a bare `## NEEDS ANSWER` that carries no marker of its own. */
function listed(block: string): Question[] {
  const text = short(plain(block.replace(BLOCK_MARK, '').replace(/\|/g, ' ')))
  return /\p{L}/u.test(text) && !NOTHING.test(text) ? [{ text, keys: [key(text)] }] : []
}

/**
 * The distinct questions an `answers.md` marks: one written twice counts once. Under a bare
 * `## NEEDS ANSWER` heading, whose entries may not repeat the marker, each block counts unless one
 * there does carry it.
 */
export function parseQuestions(markdown: string): Question[] {
  const found: Question[] = []
  let heading = ''
  let section = undefined as string[] | undefined
  const closeSection = () => {
    found.push(...(section ?? []).flatMap(listed))
    section = undefined
  }
  for (const block of blocks(markdown)) {
    const title = block.startsWith('#')
    if (title) closeSection()
    if (SECTION.test(block)) section = []
    else if (hasMarker(block)) {
      const questions = marked(block, heading)
      if (questions.length > 0) section = undefined
      found.push(...questions)
    } else if (!title) section?.push(block)
    if (title) heading = plain(block.replace(BLOCK_MARK, ''))
  }
  closeSection()
  const seen = new Set<string>()
  return found.filter(({ keys: [identity] }) => {
    if (identity === undefined) return true
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/** The entries of the saved answers that hold an answer, on the `Answer:` line or quoted below. */
export function parseSaved(markdown: string): SavedAnswer[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .flatMap(entry => {
      if (!/^- Answer:[ \t]*(?:\S|\r?\n\s*>\s*\S)/m.test(entry)) return []
      const scope = /^- Scope:\s*(.*)$/m.exec(entry)?.[1] ?? ''
      const only = /^(.+?)[\s-]+only\b/i.exec(scope)?.[1] ?? ''
      const leadId = /^- Asked by:.*\(`([^`]+)`\)/m.exec(entry)?.[1]
      return [
        {
          key: key(short(plain(/^.*/.exec(entry)?.[0] ?? ''))),
          ...(leadId ? { leadId } : {}),
          ...(/^any application\b/i.test(scope)
            ? {}
            : { companies: only.split('/').map(key).filter(Boolean) }),
        },
      ]
    })
}

/**
 * Whether an entry's scope covers this lead: any application, the lead it was asked for, or that
 * exact company, with or without what the lead's name adds in brackets.
 */
function covers(entry: SavedAnswer, lead: Pick<Lead, 'id' | 'company'>): boolean {
  if (!entry.companies || entry.leadId === lead.id) return true
  const names = [key(lead.company), key(lead.company.replace(/\(.*$/, ''))]
  return entry.companies.some(name => names.includes(name))
}

/** What a package still needs from the person: its questions with no saved answer that applies. */
export function openQuestions(
  answers: string,
  saved: readonly SavedAnswer[],
  lead: Pick<Lead, 'id' | 'company'>,
): string[] {
  const applies = saved.filter(entry => covers(entry, lead)).map(entry => entry.key)
  return parseQuestions(answers)
    .filter(question => !question.keys.some(one => applies.includes(one)))
    .map(question => question.text)
}

/** The note on a Ready card: what is still needed, or that it can go. */
export const readyNote = (open: number) =>
  open === 0 ? 'Ready to submit' : `${open} answer${open === 1 ? '' : 's'} needed`
