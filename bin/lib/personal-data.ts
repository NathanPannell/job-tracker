// Detects personal data in files that would be committed. The repository holds code only:
// profiles, résumés, leads and packages live in the data folder outside it.

const FORBIDDEN_EXTENSIONS = ['.pdf', '.tex', '.docx', '.doc', '.rtf']
const FORBIDDEN_SEGMENTS = ['data/', 'packages/', 'profile/', 'knowledge-base/']
const SKIPPED = ['package-lock.json', 'node_modules/']
const ALLOWED_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'anthropic.com',
  'users.noreply.github.com',
]
/** The author's public credit: the only places the profile's name may appear. */
const PUBLIC_CREDIT = [
  'Copyright (c) 2026 Nathan Pannell',
  '"name": "Nathan Pannell"',
  'NathanPannell/job-tracker',
]

const PHONE = /(?<![\d.])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d.])/g
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g
// Spelled in pieces so this file does not match itself.
const LATEX = new RegExp(String.fromCharCode(92, 92) + 'document' + 'class')

/** Problems found in one file about to be committed; empty when it is clean. */
export function scanFile(path: string, text: string, denyList: readonly string[] = []): string[] {
  const problems: string[] = []
  if (SKIPPED.some(skip => path.startsWith(skip) || path.includes(`/${skip}`))) return problems
  const lower = path.toLowerCase()
  if (FORBIDDEN_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    problems.push(`${path}: document files never belong in the repository`)
  }
  if (FORBIDDEN_SEGMENTS.some(seg => lower.startsWith(seg) || lower.includes(`/${seg}`))) {
    problems.push(`${path}: lives under a data folder name`)
  }
  for (const match of text.matchAll(PHONE)) {
    problems.push(`${path}: looks like a phone number (${match[0]})`)
  }
  for (const match of text.matchAll(EMAIL)) {
    const domain = (match[1] ?? '').toLowerCase()
    const isAllowed = ALLOWED_EMAIL_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))
    if (!isAllowed) problems.push(`${path}: contains an email address (${match[0]})`)
  }
  if (LATEX.test(text)) problems.push(`${path}: contains a LaTeX document`)
  const haystack = PUBLIC_CREDIT.reduce(
    (rest, credit) => rest.replaceAll(credit, ''),
    text,
  ).toLowerCase()
  for (const term of denyList) {
    if (term.length >= 4 && haystack.includes(term.toLowerCase())) {
      problems.push(`${path}: contains a profile value from the data folder`)
    }
  }
  return problems
}

/**
 * The identity values (name, surname, phone, email) of a profile.md written as
 * `- **Name:** value` lines, so a local run can check for them exactly.
 */
export function denyListFromProfile(profile: string): string[] {
  const terms: string[] = []
  for (const line of profile.split(/\r?\n/)) {
    const match = /^- \*\*(Name|Phone|Email):\*\*\s*(.+)$/.exec(line.trim())
    if (!match) continue
    const value = (match[2] ?? '').trim()
    terms.push(value)
    if (match[1] === 'Phone') terms.push(value.replace(/\D/g, ''))
    if (match[1] === 'Name') {
      const surname = value.split(/\s+/).at(-1)
      if (surname) terms.push(surname)
    }
  }
  return terms.filter(term => term.length >= 4)
}
