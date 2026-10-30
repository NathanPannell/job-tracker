import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { denyListFromProfile, scanFile } from '../bin/lib/personal-data.ts'

// Fixtures are assembled at run time so this file does not trip the scan it tests.
const PHONE = ['250', '555', '0199'].join(' ')
const EMAIL = ['someone', 'gmail.com'].join('@')
const LATEX = [String.fromCharCode(92), 'documentclass{article}'].join('')

test('flags documents, data folders, phone numbers, emails and LaTeX', () => {
  assert.equal(scanFile('notes/resume.pdf', '').length, 1)
  assert.equal(scanFile('data/leads.json', '{}').length, 1)
  assert.match(scanFile('a.md', `call ${PHONE}`)[0] ?? '', /phone/)
  assert.match(scanFile('a.md', `mail ${EMAIL}`)[0] ?? '', /email/)
  assert.match(scanFile('a.md', LATEX)[0] ?? '', /LaTeX/)
  assert.deepEqual(scanFile('a.md', 'uses: actions/checkout@v7.0.1'), [])
  assert.deepEqual(scanFile('a.md', ['noreply', 'anthropic.com'].join('@')), [])
  assert.deepEqual(scanFile('node_modules/x.d.ts', PHONE), [])
})

test('checks exact profile values when a deny-list is given', () => {
  const profile = [
    '- **Name:** Ada Lovelace',
    `- **Phone:** ${PHONE}`,
    `- **Email:** ${['ada', 'example.com'].join('@')}`,
    '- **Website:** https://example.com',
  ].join('\n')
  const deny = denyListFromProfile(profile)
  assert.ok(deny.includes('Lovelace'))
  assert.ok(deny.includes(PHONE.replace(/\s/g, '')))
  assert.equal(scanFile('a.md', 'Written by lovelace', deny).length, 1)
  assert.deepEqual(scanFile('a.md', 'nothing here', deny), [])
})

test('the deny-list passes the public credit and nothing else with the name', () => {
  // Assembled here, like the fixtures above, so the name is not in this file's own text.
  const first = 'Nathan'
  const surname = ['Pan', 'nell'].join('')
  const name = `${first} ${surname}`
  const slug = `${first}${surname}/job-tracker`
  const deny = [name, surname]
  const manifest = '.claude-plugin/plugin.json'
  assert.deepEqual(scanFile('LICENSE', `Copyright (c) 2026 ${name}`, deny), [])
  assert.deepEqual(scanFile(manifest, `{ "name": "${name}" }`, deny), [])
  assert.deepEqual(scanFile('README.md', `git clone https://github.com/${slug}.git`, deny), [])
  assert.deepEqual(scanFile(manifest, `"repository": "https://github.com/${slug}"`, deny), [])
  // Elsewhere in a credited file, and everywhere in any other file.
  assert.notDeepEqual(scanFile('README.md', `Written by ${name}`, deny), [])
  assert.notDeepEqual(scanFile('LICENSE', `Copyright (c) 2025 ${name}`, deny), [])
  assert.equal(scanFile('README.md', `github.com/${slug}-private`, deny).length, 1)
  assert.equal(scanFile('README.md', `github.com/${slug}-data/leads`, deny).length, 1)
  assert.equal(scanFile('README.md', `github.com/${first}${surname}/dotfiles`, deny).length, 1)
  assert.notDeepEqual(scanFile('test/a.spec.ts', `{ "name": "${name}" }`, deny), [])
  assert.notDeepEqual(scanFile('LICENSE.md', `Copyright (c) 2026 ${name}`, deny), [])
  assert.equal(scanFile('a.md', `Dear ${surname}`, deny).length, 1)
})

test('the repository itself holds no personal data', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const problems = files.flatMap(file => {
    try {
      return scanFile(file, readFileSync(file, 'utf8'))
    } catch {
      return []
    }
  })
  assert.deepEqual(problems, [])
})
