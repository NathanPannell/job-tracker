// What a package's `answers.md` still asks of the person. The package skill marks each question
// the record cannot answer with `NEEDS ANSWER:`; older packages wrote the marker inline, bold, in
// table cells and under a heading, and are never redrafted. The submit skill leaves `answers.md`
// as drafted and saves replies to the shared record, so a question answered there stops counting.
// Nothing here touches a file; the callers read.

import type { Lead } from '../../types/index.d.ts'

/** The person's saved answers, relative to the data folder (skills/submit/SKILL.md). */
export const SAVED_ANSWERS = 'profile/knowledge-base/application-answers.md'

/** A question as drawn, and the normalised forms it can be matched by. */
export type Question = { text: string; keys: string[] }

/** One entry of the saved answers. `companies` is absent when its scope is not company-only. */
export type SavedAnswer = { key: string; leadId?: string; companies?: string[] }

/**
 * The marker where it marks a question, not where prose mentions it: never in backticks or after
 * a word ("left as NEEDS ANSWER"). A colon, or a bold one around it, introduces the question.
 */
const MARKER = /(?<![\w`] ?)NEEDS ANSWER(?: \(optional\))?\**(:?)\**/g

/** A line that starts a new block rather than continuing the one above. */
const BLOCK_START = /^(?:#|\||[-*+] |\d+[.)] )/

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

/** The question alone, without the note after it: up to its `?`, or its first sentence. */
const short = (text: string) =>
  /^.*?\?/.exec(text)?.[0] ?? text.replace(/(?: \(|\.\s|[.:]$).*$/, '').trim()

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
 * The questions one block marks. Beside the marker's own text a question may have the form's
 * wording: the bold text before the marker, or the row's first cell in a table. A bare marker
 * asks that one, and one with neither (a `## NEEDS ANSWER` heading) asks nothing.
 */
function marked(block: string): Question[] {
  const row = block.startsWith('|')
  const cells = row ? block.split(/(?<!\\)\|/).map(cell => cell.trim()) : [block]
  const first = cells.find(cell => /\p{L}/u.test(cell) && !cell.includes('NEEDS ANSWER'))
  return cells.flatMap(cell => {
    const marks = [...cell.matchAll(MARKER)]
    return marks.flatMap((mark, n) => {
      const start = mark.index + mark[0].length
      const rest = plain(cell.slice(start, marks[n + 1]?.index))
      // Without a colon only an empty remainder marks a question ("NEEDS ANSWER items follow").
      if (!mark[1] && !/^[\s.]*$/.test(rest)) return []
      const bold = /\*\*([^*]+)\*\*\s*$/.exec(cell.slice(0, mark.index))?.[1]
      const form = short(plain((n === 0 && (row ? first : bold)) || ''))
      const said = short(rest)
      const text = rest.includes('?') ? said : form || said
      return text ? [{ text, keys: [said, form].map(key).filter(Boolean) }] : []
    })
  })
}

/** The distinct questions an `answers.md` marks: one written twice counts once. */
export function parseQuestions(markdown: string): Question[] {
  const seen = new Set<string>()
  return blocks(markdown)
    .flatMap(marked)
    .filter(question => {
      if (question.keys.some(one => seen.has(one))) return false
      question.keys.forEach(one => seen.add(one))
      return true
    })
}

/** The entries of the saved answers that hold an answer. */
export function parseSaved(markdown: string): SavedAnswer[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .flatMap(entry => {
      if (!/^- Answer:/m.test(entry)) return []
      const scope = /^- Scope:\s*(.*)$/m.exec(entry)?.[1] ?? ''
      const only = /^(?!any\b)(.+?)\s+only\b/i.exec(scope)?.[1]
      const leadId = /^- Asked by:.*\(`([^`]+)`\)/m.exec(entry)?.[1]
      return [
        {
          key: key(short(plain(/^.*/.exec(entry)?.[0] ?? ''))),
          ...(leadId ? { leadId } : {}),
          ...(only ? { companies: only.split('/').map(key).filter(Boolean) } : {}),
        },
      ]
    })
}

/** Whether an entry's scope covers this lead: asked for it, or any application, or its company. */
function covers(entry: SavedAnswer, lead: Pick<Lead, 'id' | 'company'>): boolean {
  if (!entry.companies || entry.leadId === lead.id) return true
  const company = ` ${key(lead.company)} `
  return entry.companies.some(
    name => company.includes(` ${name} `) || ` ${name} `.includes(company),
  )
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
