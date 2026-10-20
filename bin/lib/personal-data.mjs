// Detects personal data in files that would be committed. The repository holds code only:
// profiles, résumés, leads and packages live in the data folder outside it.

const FORBIDDEN_EXTENSIONS = ['.pdf', '.tex', '.docx', '.doc', '.rtf']
const FORBIDDEN_SEGMENTS = ['data/', 'packages/', 'profile/', 'knowledge-base/']
const SKIPPED = ['vendor/', 'package-lock.json', 'node_modules/']
const ALLOWED_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'anthropic.com',
  'users.noreply.github.com',
]

const PHONE = /(?<![\d.])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d.])/g
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g
const LATEX = new RegExp(String.fromCharCode(92, 92) + 'document' + 'class')

/**
 * @param {string} path repository-relative path with forward slashes
 * @param {string} text the file's contents
 * @param {string[]} [denyList] exact strings that must never appear (read from the data folder)
 * @returns {string[]} problems found, empty when clean
 */
export function scanFile(path, text, denyList = []) {
  const problems = []
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
  const haystack = text.toLowerCase()
  for (const term of denyList) {
    if (term.length >= 4 && haystack.includes(term.toLowerCase())) {
      problems.push(`${path}: contains a profile value from the data folder`)
    }
  }
  return problems
}

/**
 * Pulls the identity values (name, phone, email) out of a profile.md written as
 * `- **Name:** value` lines, so a local run can check for them exactly.
 * @param {string} profile
 * @returns {string[]}
 */
export function denyListFromProfile(profile) {
  const terms = []
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
