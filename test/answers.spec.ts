import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  openQuestions,
  parseQuestions,
  parseSaved,
  readyNote,
  UNNAMED,
} from '../hooks/lib/answers.ts'

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

  test('prose saying nothing is open is not a question', () => {
    const mentions = [
      'No question on this form is left as NEEDS ANSWER.',
      'Everything has an answer, so nothing is NEEDS ANSWER.',
      'Every question has an answer on record; nothing is NEEDS ANSWER.',
      'Nothing is left as NEEDS ANSWER: the record covers it all.',
      'No `NEEDS ANSWER` items.',
      '- **No `NEEDS ANSWER` items.** Every required question is covered.',
      'No salary or disclosure question here, so nothing is `NEEDS ANSWER`.',
      'NEEDS ANSWER items are listed at the end.',
      'The form was short, so there are no\n`NEEDS ANSWER` items.',
      'NEEDS ANSWER: none',
    ]
    for (const line of mentions) assert.deepEqual(texts(`# Answers\n\n${line}\n`), [], line)
  })

  test('a question written inline and again as a summary bullet counts once', () => {
    const file = `
8. **Where are you based?** Canada.
9. **Are you fluent in French and English, for a professional setting?** NEEDS ANSWER: Are you
   fluent in French as well as English?
   The record has the English but nothing about French.

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

- A drafted answer.
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
- NEEDS ANSWER: Date available
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
      'Equity expectation (0.5%)',
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

describe('a marker in a shape the parser does not know still counts', () => {
  const counted: [string, string][] = [
    ['- Salary expectation: NEEDS ANSWER\n', 'Salary expectation'],
    ['- **Salary expectation**: NEEDS ANSWER\n', 'Salary expectation'],
    ['What is your salary expectation? NEEDS ANSWER\n', 'What is your salary expectation?'],
    ['Q: What is your salary?\nA: NEEDS ANSWER\n', 'Q: What is your salary?'],
    ['### What is your salary?\n\nNEEDS ANSWER\n', 'What is your salary?'],
    ['### Salary: NEEDS ANSWER\n', 'Salary'],
    ['| Salary | NEEDS ANSWER (not on record) |\n', 'Salary'],
    ['- **Salary:** NEEDS ANSWER (not on record)\n', 'Salary'],
    ['NEEDS ANSWER — What is your salary?\n', 'What is your salary?'],
    ['| Salary | NEEDS ANSWER — not on record |\n', 'Salary'],
    ['Salary (NEEDS ANSWER)\n', 'Salary'],
    ['[NEEDS ANSWER] What is your salary?\n', 'What is your salary?'],
    ['NEEDS ANSWER (required): What is your salary?\n', 'What is your salary?'],
    ['NEEDS ANSWER (Optional): What is your salary?\n', 'What is your salary?'],
    ['NEEDS ANSWERS: What is your salary?\n', 'What is your salary?'],
    ['_NEEDS ANSWER:_ What is your salary?\n', 'What is your salary?'],
    ['__NEEDS ANSWER:__ What is your salary?\n', 'What is your salary?'],
    ['Salary expectation NEEDS ANSWER: what number?\n', 'what number?'],
    ['Q3 NEEDS ANSWER: what number?\n', 'what number?'],
    ['- `NEEDS ANSWER:` What is your salary?\n', 'What is your salary?'],
    ['NEEDS\n    ANSWER: What is your salary?\n', 'What is your salary?'],
    ['**Do you have no visa?** NEEDS ANSWER\n', 'Do you have no visa?'],
    ['Do you not need a visa? NEEDS ANSWER\n', 'Do you not need a visa?'],
    ['- `NEEDS ANSWER`: address and pay.\n', 'address and pay'],
    // A note that starts like "nothing" is still a note on an open question.
    ['| Salary | NEEDS ANSWER: nothing on record |\n', 'Salary'],
    ['| Salary | NEEDS ANSWER: none recorded |\n', 'Salary'],
    ['- **Salary:** NEEDS ANSWER: none on file\n', 'Salary'],
    ['- **Salary:** NEEDS ANSWER: n/a\n', 'Salary'],
    [
      'NEEDS ANSWER: None of the listed options fit. Which should be chosen?\n',
      'None of the listed options fit. Which should be chosen?',
    ],
    ['- NEEDS ANSWER: No questions for the hiring team?\n', 'No questions for the hiring team?'],
    // A negation about the field denies nothing.
    ['| Salary | Not on record — NEEDS ANSWER |\n', 'Salary'],
    ['Not on record, NEEDS ANSWER: salary expectation\n', 'salary expectation'],
    ['No figure on record — NEEDS ANSWER: desired base\n', 'desired base'],
    [
      'The posting does not give a range\nNEEDS ANSWER: desired base salary\n',
      'desired base salary',
    ],
    ['- Sponsorship required (yes/no) NEEDS ANSWER\n', 'Sponsorship required (yes/no)'],
    ['- Postal code (not in the record) NEEDS ANSWER\n', 'Postal code'],
    ['Salary expectation: not on record (NEEDS ANSWER)\n', 'Salary expectation: not on record'],
    ['- **Salary** not on record, NEEDS ANSWER\n', 'Salary not on record'],
    // "Question" after the marker introduces one rather than talking about the marker.
    ['**NEEDS ANSWER** Question: What is your salary?\n', 'Question: What is your salary?'],
    ['[NEEDS ANSWER] Question 12: your salary\n', 'Question 12: your salary'],
    ['NEEDS ANSWER items:\n\n- Salary\n', 'items'],
    ['## NEEDS ANSWER items\n\n- Salary\n', 'items'],
  ]
  for (const [file, text] of counted) {
    test(JSON.stringify(file), () => assert.deepEqual(texts(file), [text]))
  }

  test('a marker with no words anywhere near it is still counted', () => {
    assert.deepEqual(texts('- NEEDS ANSWER\n'), [UNNAMED])
    assert.deepEqual(texts('- NEEDS ANSWER\n\n- NEEDS ANSWER\n'), [UNNAMED, UNNAMED])
    assert.deepEqual(parseQuestions('- NEEDS ANSWER\n')[0]?.keys, [])
  })

  test('entries under a bare heading count though they carry no marker', () => {
    assert.deepEqual(texts('## NEEDS ANSWER\n\n- Salary expectation\n- Start date\n'), [
      'Salary expectation',
      'Start date',
    ])
    assert.deepEqual(texts('## NEEDS ANSWER\nA paragraph follows the heading.\n'), [
      'A paragraph follows the heading',
    ])
    assert.deepEqual(texts('## **NEEDS ANSWER:** (2)\n\n| Salary |\n| --- |\n\n## Next\n'), [
      'Salary',
    ])
  })

  test('a bare heading that says nothing is open asks nothing', () => {
    assert.deepEqual(texts('## NEEDS ANSWER\n\nNone.\n'), [])
    assert.deepEqual(texts('## NEEDS ANSWER\n\nNo open questions.\n'), [])
    assert.deepEqual(texts('## NEEDS ANSWER\n\nNothing is left as NEEDS ANSWER.\n'), [])
    assert.deepEqual(texts('## NEEDS ANSWER\n'), [])
  })

  test('a note under a bullet that carries the marker is not a second question', () => {
    const file = '## NEEDS ANSWER\n\n- NEEDS ANSWER: First?\n\nSome context on it.\n'
    assert.deepEqual(texts(file), ['First?'])
  })

  test('a plain bullet beside a marked one still counts', () => {
    const file = '## NEEDS ANSWER\n\n- Salary expectation\n- NEEDS ANSWER: Start date\n'
    assert.deepEqual(texts(file), ['Start date', 'Salary expectation'])
    const saved = parseSaved(entry('Start date', 'any application'))
    assert.deepEqual(openQuestions(file, saved, lead), ['Salary expectation'])
  })

  test('a deeper heading stays in the section, a sibling closes it', () => {
    assert.deepEqual(texts('## NEEDS ANSWER\n\n### What is your salary?\n'), [
      'What is your salary?',
    ])
    assert.deepEqual(texts('## NEEDS ANSWER\n\n## Drafted\n\n- A drafted answer.\n'), [])
  })
})

describe('different questions stay different', () => {
  test('rows sharing a note count apart', () => {
    const file = [
      '| Voluntary: veteran status | NEEDS ANSWER: which option |',
      '| Voluntary: disability status | NEEDS ANSWER: which option |',
      '| Voluntary: gender | NEEDS ANSWER: which option |',
    ].join('\n')
    assert.equal(texts(file).length, 3)
    const saved = parseSaved(entry('Voluntary: veteran status', 'any application'))
    assert.deepEqual(openQuestions(file, saved, lead), [
      'Voluntary: disability status',
      'Voluntary: gender',
    ])
    // The note is no name for the question.
    const note = parseSaved(entry('which option', 'any application'))
    assert.equal(openQuestions(file, note, lead).length, 3)
  })

  test('bold bullets sharing a note count apart', () => {
    const file =
      '- **Salary:** NEEDS ANSWER: not on record\n- **Start date:** NEEDS ANSWER: not on record\n'
    const saved = parseSaved(entry('Salary', 'any application'))
    assert.deepEqual(openQuestions(file, saved, lead), ['Start date'])
  })

  test('rows sharing a first cell count apart', () => {
    const file = [
      '| Legal | NEEDS ANSWER: Do you need a visa? |',
      '| Legal | NEEDS ANSWER: Do you have a clearance? |',
    ].join('\n')
    const saved = parseSaved(entry('Do you need a visa?', 'any application'))
    assert.deepEqual(openQuestions(file, saved, lead), ['Do you have a clearance?'])
  })

  test('form wording keeps apart rows whose notes ask the same thing', () => {
    const file = [
      '| Voluntary: veteran status | NEEDS ANSWER: which option? |',
      '| Voluntary: disability status | NEEDS ANSWER: which option? |',
      '| Voluntary: gender | NEEDS ANSWER: which option? |',
    ].join('\n')
    assert.equal(texts(file).length, 3)
    const saved = parseSaved(entry('Voluntary: veteran status', 'any application'))
    assert.equal(openQuestions(file, saved, lead).length, 2)
    const bold =
      '- **Salary:** NEEDS ANSWER: what should I put?\n- **Start date:** NEEDS ANSWER: what should I put?\n'
    assert.equal(texts(bold).length, 2)
    assert.equal(
      openQuestions(bold, parseSaved(entry('Salary', 'any application')), lead).length,
      1,
    )
  })

  test('a wording two questions share clears neither', () => {
    const file = [
      '| Voluntary: veteran status | NEEDS ANSWER: which option? |',
      '| Voluntary: gender | NEEDS ANSWER: which option? |',
    ].join('\n')
    const saved = parseSaved(entry('which option?', 'any application'))
    assert.equal(openQuestions(file, saved, lead).length, 2)
  })

  test('questions that open alike and go on differently count apart', () => {
    const file =
      '- NEEDS ANSWER: Which option? Veteran status\n- NEEDS ANSWER: Which option? Gender\n'
    assert.equal(texts(file).length, 2)
    const saved = parseSaved(entry('Which option?', 'any application'))
    assert.equal(openQuestions(file, saved, lead).length, 2)
  })

  test('a saved answer is not cut short before it is compared', () => {
    const cleared = (question: string, answered: string) =>
      openQuestions(
        `NEEDS ANSWER: ${question}\n`,
        parseSaved(entry(answered, 'any application')),
        lead,
      ).length === 0
    assert.equal(cleared('Approx. years of Go', 'Approx. salary expected'), false)
    assert.equal(cleared('Min. hours per week', 'Min. salary'), false)
    assert.equal(cleared('Python vs. Go experience', 'Python vs. Rust experience'), false)
    assert.equal(cleared('Salary (not including bonus)', 'Salary (not including equity)'), false)
    assert.equal(cleared('Visa (any country in the EU)', 'Visa (any US state)'), false)
    assert.equal(cleared('Approx. years of Go', 'Approx. years of Go'), true)
  })

  test('an initial does not end the question', () => {
    const file = 'NEEDS ANSWER: U.S. security clearance\n\nNEEDS ANSWER: U.S. work authorization\n'
    assert.deepEqual(texts(file), ['U.S. security clearance', 'U.S. work authorization'])
    const saved = parseSaved(entry('U.S. work authorization', 'any application'))
    assert.deepEqual(openQuestions(file, saved, lead), ['U.S. security clearance'])
  })

  test('brackets that tell two questions apart are kept', () => {
    const file = 'NEEDS ANSWER: Salary (bonus target)\n\nNEEDS ANSWER: Salary (base)\n'
    assert.equal(texts(file).length, 2)
    const saved = parseSaved(entry('Salary (base)', 'any application'))
    assert.deepEqual(openQuestions(file, saved, lead), ['Salary (bonus target)'])
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
      openQuestions(
        'NEEDS ANSWER: Résumé format (required)\n',
        parseSaved(entry('resume format (any form of the question)', 'any application')),
        lead,
      ),
      [],
    )
  })

  test('the form wording matches too, as submit may save either', () => {
    const file = '| Desired pay (required) | NEEDS ANSWER: What base salary should you give? |'
    const saved = parseSaved(entry('Desired pay', 'any application'))
    assert.deepEqual(openQuestions(file, saved, lead), [])
    const bold = '**Desired pay** NEEDS ANSWER: What base salary should you give?\n'
    assert.deepEqual(openQuestions(bold, saved, lead), [])
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

  test('a company matches whole, its bracketed addition aside', () => {
    const saved = parseSaved(entry('What is your salary expectation?', 'Acme only'))
    const at = (company: string) => openQuestions(ask, saved, { id: 'x', company })
    assert.deepEqual(at('ACME'), [])
    assert.deepEqual(at('Acme (a Globex company)'), [])
    assert.equal(at('Acmesoft').length, 1)
    assert.equal(at('Acme Bank').length, 1)
    const longer = parseSaved(entry('What is your salary expectation?', 'Acme Bank only'))
    assert.equal(openQuestions(ask, longer, lead).length, 1)
  })

  test('a scope naming several companies covers each', () => {
    const saved = parseSaved(entry('What is your salary expectation?', 'Beta / Acme only'))
    assert.deepEqual(openQuestions(ask, saved, lead), [])
    assert.deepEqual(
      openQuestions(ask, parseSaved(entry('What is your salary expectation?', 'Acme-only')), lead),
      [],
    )
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

  test('a scope it cannot read covers only the lead it was asked for', () => {
    const unread = [
      'Beta',
      'only Beta',
      'Beta applications',
      'Any Desk only',
      'any application at Beta',
      'any application except Acme',
      '',
    ]
    for (const scope of unread) {
      const other = parseSaved(entry('What is your salary expectation?', scope))
      assert.equal(openQuestions(ask, other, lead).length, 1, scope)
      const same = parseSaved(
        entry('What is your salary expectation?', scope, 'Acme — API (`acme-api`)'),
      )
      assert.deepEqual(openQuestions(ask, same, lead), [], scope)
    }
    const none = parseSaved('## What is your salary expectation?\n\n- Answer: yes\n')
    assert.equal(openQuestions(ask, none, lead).length, 1)
  })

  test('a heading with no answer under it answers nothing', () => {
    const missing = parseSaved('## What is your salary expectation?\n\n- Date: 2026-10-24\n')
    assert.deepEqual(missing, [])
    assert.deepEqual(openQuestions(ask, missing, lead), ['What is your salary expectation?'])
    const blank = '## What is your salary expectation?\n\n- Answer:\n- Date: 2026-10-24\n'
    assert.deepEqual(parseSaved(blank), [])
    assert.deepEqual(parseSaved(blank.replace('- Answer:', '- Answer:   ')), [])
    assert.deepEqual(parseSaved(blank.replace('- Answer:\n', '- Answer:\n\n')), [])
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
    const quoted =
      '## Why us?\r\n\r\n- Answer:\r\n\r\n  > Line one.\r\n- Scope: any application\r\n'
    assert.equal(parseSaved(quoted).length, 1)
  })
})

test('the note says how many answers are needed, or that the lead can go', () => {
  assert.equal(readyNote(0), 'Ready to submit')
  assert.equal(readyNote(1), '1 answer needed')
  assert.equal(readyNote(2), '2 answers needed')
})
