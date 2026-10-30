import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { openQuestions, parseQuestions, parseSaved, readyNote } from '../hooks/lib/answers.ts'

const lead = { id: 'acme-api', company: 'Acme' }
const texts = (markdown: string) => parseQuestions(markdown).map(one => one.text)

/** One saved answer, in the submit skill's format. */
const entry = (question: string, scope: string, asked = 'Other — Dev (`other-dev`)') =>
  `## ${question}\n\n- Answer: yes\n- Date: 2026-10-24\n- Asked by: ${asked}\n- Scope: ${scope}\n`

describe('the formats answers.md is written in', () => {
  test('a file with no marker asks nothing', () => {
    assert.deepEqual(texts('# Answers\n\n1. **Why Acme?** Their API.\n'), [])
    assert.deepEqual(texts(''), [])
  })

  test('prose that mentions the marker is not a question', () => {
    const mentions = [
      'No question on this form is left as NEEDS ANSWER.',
      'Everything has an answer, so nothing is NEEDS ANSWER.',
      'Nothing is left as NEEDS ANSWER: the record covers it all.',
      'No `NEEDS ANSWER` items.',
      '- `NEEDS ANSWER`: address and pay.',
      'NEEDS ANSWER items are listed at the end.',
    ]
    for (const line of mentions) assert.deepEqual(texts(`# Answers\n\n${line}\n`), [], line)
  })

  test('a question written inline and again as a summary bullet counts once', () => {
    const file = `
8. **Where are you based?** Canada.
9. **Are you fluent in French and English, for a professional setting?** NEEDS ANSWER: Are you
   fluent in French as well as English?

## Still open

- NEEDS ANSWER: Are you fluent in French as well as English? (question 9, required)
`
    assert.deepEqual(texts(file), ['Are you fluent in French as well as English?'])
  })

  test('the bold form, its question wrapped onto a second line', () => {
    const file = `
10. **Earlier question?** Yes.
11. **NEEDS ANSWER:** Are you interested in learning a
    functional language? (The posting asks for "Elixir
    preferred".)
12. **Later question?** No.
`
    assert.deepEqual(texts(file), ['Are you interested in learning a functional language?'])
  })

  test('markdown table cells, each row its own question', () => {
    const file = `
| # | Question | Answer |
| --- | --- | --- |
| 10 | Your name (required) | Sam |
| 11 | Have you worked at a small company? (required) | NEEDS ANSWER: Have you worked at a small company? The record gives no headcount. |
| 12 | A climate choice? (required) | NEEDS ANSWER: What choice have you made for the climate? No draft was written. |
| 13 | Referred by | none |
`
    assert.deepEqual(texts(file), [
      'Have you worked at a small company?',
      'What choice have you made for the climate?',
    ])
  })

  test('a heading of the marker is not a question, its bullet is', () => {
    const file = `
## NEEDS ANSWER

- NEEDS ANSWER: How should this application go in? By the board, or the contact form instead?

## Drafted
`
    assert.deepEqual(texts(file), ['How should this application go in?'])
  })

  test('one plain line, its note left off', () => {
    const file =
      'Notes.\n\nNEEDS ANSWER: This is a contract role. What rate should be given? (No rate is on record.)\n'
    assert.deepEqual(texts(file), ['This is a contract role. What rate should be given?'])
  })

  test('the stable form, under Open questions', () => {
    const file = `
## Open questions

- NEEDS ANSWER: What is your salary expectation?
- NEEDS ANSWER: Date available (not on record)
`
    assert.deepEqual(texts(file), ['What is your salary expectation?', 'Date available'])
  })

  test('an optional question counts, since submit asks it', () => {
    assert.deepEqual(texts('| Consent | NEEDS ANSWER (optional): Tick the box or leave it? |'), [
      'Tick the box or leave it?',
    ])
  })

  test('a marker with no question takes the form wording before it', () => {
    assert.deepEqual(texts('- **Equity expectation (0.5%):** NEEDS ANSWER.\n'), [
      'Equity expectation',
    ])
    assert.deepEqual(texts('| 5 | Desired pay (required) | yes | NEEDS ANSWER |'), ['Desired pay'])
    assert.deepEqual(texts('| Pay | NEEDS ANSWER: see the salary question below |'), ['Pay'])
    assert.deepEqual(texts('| Voluntary: veteran status | NEEDS ANSWER: which option |'), [
      'Voluntary: veteran status',
    ])
  })

  test('a note is kept only when nothing better names the question', () => {
    assert.deepEqual(texts('NEEDS ANSWER: postal code (not in the record). More.\n'), [
      'postal code',
    ])
    assert.deepEqual(texts('NEEDS ANSWER: street address. Not in the record.\n'), [
      'street address',
    ])
  })

  test('form wording repeated by a later note still counts once', () => {
    const file = '| Address | NEEDS ANSWER: street address |\n\n- NEEDS ANSWER: Address\n'
    assert.deepEqual(texts(file), ['Address'])
  })

  test('a block with two markers asks two questions', () => {
    assert.deepEqual(texts('**Form** NEEDS ANSWER: First one? NEEDS ANSWER: Second one?\n'), [
      'First one?',
      'Second one?',
    ])
  })

  test('a question ends with its block', () => {
    assert.deepEqual(texts('## NEEDS ANSWER\nA paragraph follows the heading.\n'), [])
    assert.deepEqual(texts('- NEEDS ANSWER: First?\n- Second item\nNEEDS ANSWER: Third?\n'), [
      'First?',
      'Third?',
    ])
  })

  test('Windows line endings read the same', () => {
    const file = '1. **NEEDS ANSWER:** Are you\r\n   open to travel?\r\n\r\nDone.\r\n'
    assert.deepEqual(texts(file), ['Are you open to travel?'])
  })
})

describe('questions the saved answers already answer', () => {
  const ask = 'NEEDS ANSWER: What is your salary expectation?\n'

  test('one answered for any application stops counting', () => {
    const saved = parseSaved(entry('What is your salary expectation?', 'any application'))
    assert.deepEqual(openQuestions(ask, saved, lead), [])
  })

  test('wording is compared without case, punctuation, accents or a trailing note', () => {
    const saved = parseSaved(
      entry('WHAT is your salary-expectation? (any form of it)', 'any application'),
    )
    assert.deepEqual(openQuestions(ask, saved, lead), [])
    assert.deepEqual(
      openQuestions('NEEDS ANSWER: Résumé format?\n', parseSaved(entry('resume format', '')), lead),
      [],
    )
  })

  test('the form wording matches too, as submit may save either', () => {
    const file = '| Desired pay (required) | NEEDS ANSWER: What base salary should you give? |'
    assert.deepEqual(
      openQuestions(file, parseSaved(entry('Desired pay', 'any application')), lead),
      [],
    )
    const bold = '**Desired pay** NEEDS ANSWER: What base salary should you give?\n'
    assert.deepEqual(
      openQuestions(bold, parseSaved(entry('Desired pay', 'any application')), lead),
      [],
    )
  })

  test('another question still counts', () => {
    const saved = parseSaved(entry('When could you start?', 'any application'))
    assert.deepEqual(openQuestions(ask, saved, lead), ['What is your salary expectation?'])
  })

  test('a company-only answer covers that company and no other', () => {
    const saved = parseSaved(entry('What is your salary expectation?', 'Acme only'))
    assert.deepEqual(openQuestions(ask, saved, lead), [])
    assert.deepEqual(openQuestions(ask, saved, { id: 'beta-api', company: 'Beta' }), [
      'What is your salary expectation?',
    ])
  })

  test('a company matches on its whole words, either way round', () => {
    const saved = parseSaved(entry('What is your salary expectation?', 'Acme only'))
    const widened = (company: string) => openQuestions(ask, saved, { id: 'x', company })
    assert.deepEqual(widened('Acme.US'), [])
    assert.deepEqual(widened('Acme (a Globex company)'), [])
    assert.equal(widened('Acmesoft').length, 1)
    const longer = parseSaved(entry('What is your salary expectation?', 'Acme Robotics only'))
    assert.deepEqual(openQuestions(ask, longer, lead), [])
  })

  test('a scope naming several companies covers each', () => {
    const saved = parseSaved(entry('What is your salary expectation?', 'Beta / Acme only'))
    assert.deepEqual(openQuestions(ask, saved, lead), [])
  })

  test('a company-only answer covers the lead it was asked for, however the name reads', () => {
    const saved = parseSaved(
      entry('What is your salary expectation?', 'Acme Inc only', 'Acme — API (`acme-api`)'),
    )
    assert.deepEqual(openQuestions(ask, saved, { id: 'acme-api', company: 'A.C.M.E.' }), [])
  })

  test('an any-application scope with a note is still any application', () => {
    const saved = parseSaved(
      entry('What is your salary expectation?', 'any application (ticked by the person only)'),
    )
    assert.equal(saved[0]?.companies, undefined)
    assert.deepEqual(openQuestions(ask, saved, lead), [])
  })

  test('a heading with no answer under it answers nothing', () => {
    const saved = parseSaved('## What is your salary expectation?\n\n- Date: 2026-10-24\n')
    assert.deepEqual(saved, [])
    assert.deepEqual(openQuestions(ask, saved, lead), ['What is your salary expectation?'])
  })

  test('a multi-line answer counts, and the file header is not an entry', () => {
    const saved = parseSaved(
      '# Application answers\n\nThe intro.\n\n## Why us?\n\n- Answer:\n\n  > Line one.\n  >\n  > Two.\n\n- Date: 2026-10-24\n- Scope: any application\n',
    )
    assert.equal(saved.length, 1)
    assert.deepEqual(openQuestions('NEEDS ANSWER: Why us?\n', saved, lead), [])
  })

  test('no saved answers leaves every question open', () => {
    assert.deepEqual(parseSaved(''), [])
    assert.deepEqual(openQuestions(ask, [], lead), ['What is your salary expectation?'])
  })

  test('Windows line endings read the same', () => {
    const saved = parseSaved(
      entry('What is your salary expectation?', 'Acme only').replace(/\n/g, '\r\n'),
    )
    assert.deepEqual(saved[0]?.companies, ['acme'])
    assert.deepEqual(openQuestions(ask, saved, lead), [])
  })
})

test('the note says how many answers are needed, or that the lead can go', () => {
  assert.equal(readyNote(0), 'Ready to submit')
  assert.equal(readyNote(1), '1 answer needed')
  assert.equal(readyNote(2), '2 answers needed')
})
