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

/**
 * A question as drawn: `id` is its wording, empty when it has none; `form` the form's wording,
 * when the file gives it apart from the marker's text; `detail` what the marker's text goes on to
 * say after the `?`; `keys` the wordings a saved answer can clear it by.
 */
export type Question = { text: string; id: string; form: string; detail: string; keys: string[] }

/**
 * One entry of the saved answers. `companies` is absent for any application; empty, when the
 * scope names none it can read, the entry covers only the lead it was asked for. `detail` is as
 * on a question.
 */
export type SavedAnswer = { key: string; detail: string; leadId?: string; companies?: string[] }

const MARKER = /(?<![\p{L}\p{N}])NEEDS\s+ANSWERS?(?![\p{L}\p{N}])/gu

/** A heading of the marker alone: a label over what follows, not a question of its own. */
const SECTION = /^#+\s*[*_`]*NEEDS\s+ANSWERS?[*_`:\s]*(?:\([^)]*\)[*_`:\s]*)?$/u

/** What closes the marker: emphasis, a note in brackets, and the separator before the question. */
const AFTER_MARKER = /^[\s*_`)\]]*(?:\([^)]*\)[\s*_`)\]]*)?([:—–-]?)[\s*_`]*/

/**
 * The clause before a marker that denies it ("nothing is", "left as", "there are no"): a negation
 * in it, and it runs straight into the marker. Elsewhere a negation is about the field ("not on
 * record", "yes/no"), and the marker stands.
 */
const NEGATION = /\b(?:no|not|nothing|none|never|without)\b/i
const DENYING_END = /\b(?:no|any|none|nothing|is|are|as|be|remains?)$/i

/** What says the marker is being talked about: "NEEDS ANSWER items", not "... Question 12:". */
const ABOUT_MARKER = /^(?:items?|questions?|entries|fields?|lines?|markers?)\b(?!\s*[:\d])/i

/** An entry that says, and says only, that there is nothing to answer. */
const NOTHING = /^(?:none|nothing|n\/a|no (?:open |more )?questions?)[.!]?$/i

/** A note in brackets at the end of a question, as opposed to brackets that tell two apart. */
const NOTE =
  /\s*\((?:required|optional|if\b|any (?:form|application)\b|not [io]n\b|see\b)[^)]*\)?$/i

/** A list item's bullet or number. */
const LIST_MARK = /^(?:[-*+]|\d+[.)])\s+/

/** That, or a heading's hashes. */
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
 * The question as drawn, without what follows it: up to its `?`, or without its first sentence's
 * end, a closing note and trailing punctuation. A stop after an initial ("U.S.") ends no sentence.
 */
const short = (text: string) =>
  /^.*?\?/.exec(text)?.[0] ??
  text
    .replace(/(?<=[a-z)]{2})\.\s.*$/, '')
    .replace(NOTE, '')
    .replace(/[\s.:;,([—–-]+$/, '')

/** The question as matched: up to its `?`, or whole but for a closing note. */
const wording = (text: string) => key(/^.*?\?/.exec(text)?.[0] ?? text.replace(NOTE, ''))

/**
 * What a text goes on to say after its `?`, which can make two that open alike different questions.
 * Brackets there are a note on the question, as in "(question 9, required)".
 */
const beyond = (text: string) =>
  text.includes('?') ? key(text.slice(text.indexOf('?')).replace(/\([^)]*\)/g, '')) : ''

/** Whether two details of a question fit: one is absent, or they say the same. */
const agree = (a: string, b: string) => !a || !b || a === b

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
 * The questions one block marks, skipping only prose about the marker: a clause denying it ("left
 * as NEEDS ANSWER", "no `NEEDS ANSWER` items"), "NEEDS ANSWER items", or a bare "NEEDS ANSWER: none".
 * Anything that asks stands. Beside the marker's own text a question may have the form's wording,
 * the bold text before it or the row's first cell; a marker with no question of its own takes that,
 * or the words before it, or the heading over it.
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
      const form = n === 0 ? plain((row ? first : bold) ?? '') : ''
      const clause =
        plain(before)
          .split(/[.!?;:,()—–]|\s-\s/)
          .at(-1)
          ?.trim() ?? ''
      const denied = !bold && NEGATION.test(clause) && DENYING_END.test(clause)
      const words = n === 0 ? plain(before.replace(BLOCK_MARK, '')) : ''
      const blank = NOTHING.test(rest)
      const none = !form && !words && blank
      const about = !separator && !block.startsWith('#') && ABOUT_MARKER.test(rest)
      if (!asks && (denied || none || about)) return []
      const said = blank ? '' : rest
      const named = asks ? rest : ([form, said, words, heading].find(short) ?? '')
      return [
        {
          text: short(named) || UNNAMED,
          id: wording(named),
          form: wording(form),
          detail: beyond(rest),
          keys: (asks ? [rest, form] : [named]).map(wording).filter(Boolean),
        },
      ]
    })
  })
}

/** A block under a bare `## NEEDS ANSWER` that carries no marker of its own. */
function listed(block: string): Question[] {
  const words = plain(block.replace(BLOCK_MARK, '').replace(/\|/g, ' '))
  const text = short(words)
  const id = wording(words)
  return /\p{L}/u.test(text) && !NOTHING.test(text)
    ? [{ text, id, form: '', detail: '', keys: [id] }]
    : []
}

/**
 * The questions as the blocks give them. Under a bare `## NEEDS ANSWER` heading, whose entries may
 * not repeat the marker, list items count, and with no marker in the section anything does.
 */
function questions(markdown: string): Question[] {
  const found: Question[] = []
  let heading = ''
  let section = undefined as { depth: number; entries: string[]; marked: boolean } | undefined
  const closeSection = () => {
    const entries = section?.entries ?? []
    const counted = section?.marked ? entries.filter(one => LIST_MARK.test(one)) : entries
    found.push(...counted.flatMap(listed))
    section = undefined
  }
  for (const block of blocks(markdown)) {
    const depth = /^#+/.exec(block)?.[0].length
    if (depth !== undefined && (!section || depth <= section.depth)) closeSection()
    if (SECTION.test(block)) section = { depth: depth ?? 1, entries: [], marked: false }
    else if (hasMarker(block)) {
      const asked = marked(block, heading)
      if (section && asked.length > 0) section.marked = true
      found.push(...asked)
    } else section?.entries.push(block)
    if (depth !== undefined) heading = plain(block.replace(BLOCK_MARK, ''))
  }
  closeSection()
  return found
}

/**
 * The distinct questions an `answers.md` marks. One written twice counts once, but not when the
 * form's wording or what each goes on to say tells them apart, and a wording two questions share
 * clears neither.
 */
export function parseQuestions(markdown: string): Question[] {
  const distinct: Question[] = []
  for (const one of questions(markdown)) {
    const same = (other: Question) =>
      one.id &&
      other.id === one.id &&
      agree(one.form, other.form) &&
      agree(one.detail, other.detail)
    if (!distinct.some(same)) distinct.push(one)
  }
  const keys = distinct.flatMap(one => [...new Set(one.keys)])
  const once = (one: string) => keys.indexOf(one) === keys.lastIndexOf(one)
  return distinct.map(one => ({ ...one, keys: one.keys.filter(once) }))
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
      const question = plain(/^.*/.exec(entry)?.[0] ?? '')
      return [
        {
          key: wording(question),
          detail: beyond(question),
          ...(leadId ? { leadId } : {}),
          ...(/^any application\s*(?:\(|$)/i.test(scope)
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
  const applies = saved.filter(entry => covers(entry, lead))
  const clears = (entry: SavedAnswer, question: Question) =>
    question.keys.includes(entry.key) &&
    (entry.key !== question.id || agree(entry.detail, question.detail))
  return parseQuestions(answers)
    .filter(question => !applies.some(entry => clears(entry, question)))
    .map(question => question.text)
}

/** The note on a Ready card: what is still needed, or that it can go. */
export const readyNote = (open: number) =>
  open === 0 ? 'Ready to submit' : `${open} answer${open === 1 ? '' : 's'} needed`
