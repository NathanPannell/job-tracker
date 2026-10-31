import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext, Script } from 'node:vm'

import { formResult, formScript, formStep } from '../hooks/lib/deep-form.ts'
import type { FormStep, RunStep } from '../hooks/lib/deep-form.ts'

const step = (input: Record<string, unknown>) => formStep({ tabId: 11, ...input }) as FormStep

/** A page that answers each step from `answer`, keeping the steps it was asked for. */
function pageOf(answer: (one: FormStep) => string) {
  const steps: FormStep[] = []
  const run: RunStep = one => {
    steps.push(one)
    return Promise.resolve(answer(one))
  }
  return { steps, run }
}

test('a deep_form call needs its tab, a known action and what that action works on', () => {
  assert.deepEqual(formStep({ tabId: '11', action: 'read' }), { tabId: 11, action: 'read' })
  assert.deepEqual(formStep({ tabId: 11, action: 'fill', id: ' 3 ', value: 'Victoria' }), {
    tabId: 11,
    action: 'fill',
    id: '3',
    value: 'Victoria',
  })
  assert.deepEqual(formStep({ action: 'read' }), { error: 'Error: deep_form needs tabId' })
  assert.match(
    (formStep({ tabId: 11, action: 'eval' }) as { error: string }).error,
    /one of read, fill, press, add_file_input, attach/,
  )
  // The page's half of a press, describe, is the tool's to run, not the caller's.
  assert.match((formStep({ tabId: 11, action: 'describe' }) as { error: string }).error, /one of/)
  for (const action of ['fill', 'press', 'attach']) {
    assert.match(
      (formStep({ tabId: 11, action, value: 'x' }) as { error: string }).error,
      /needs the id/,
    )
  }
  assert.match(
    (formStep({ tabId: 11, action: 'fill', id: '3' }) as { error: string }).error,
    /needs value/,
  )
})

test('only the action, id and value vary, and always as data', () => {
  const value = '"})();document.forms[0].submit();({"'
  const script = formScript(step({ action: 'fill', id: '3', value }))
  // It still parses as one call, and hands the page exactly what it was given.
  new Script(script)
  const args = /\)\((\{"action".*\})\)$/.exec(script)?.[1] ?? ''
  assert.deepEqual(JSON.parse(args), { action: 'fill', id: '3', value })
  assert.equal(
    formScript(step({ action: 'read' })).split('=> {')[0],
    formScript(step({ action: 'press', id: '9' })).split('=> {')[0],
  )
})

test('the page script sends nothing and clicks only what the tool has cleared', () => {
  const script = formScript(step({ action: 'read' }))
  for (const banned of [
    /\.submit\(/,
    /requestSubmit/,
    /\bfetch\(/,
    /XMLHttpRequest/,
    /sendBeacon/,
    /location/,
    /\beval\(/,
    /KeyboardEvent/,
    /MouseEvent/,
  ]) {
    assert.doesNotMatch(script, banned)
  }
  // One tick of a box or radio, one press.
  assert.equal(script.match(/\.click\(\)/g)?.length, 2)
})

test('the page script runs: a page with no controls reads as an empty form', () => {
  const document = { querySelectorAll: () => [] }
  const answer = runInNewContext(formScript(step({ action: 'read' })), { document }) as string
  assert.deepEqual(JSON.parse(answer), { fields: [], unreachableFrames: 0 })
})

test('a read pages through a form too long for one result', async () => {
  const pages = [
    { fields: [{ id: '1' }, { id: '2' }], unreachableFrames: 1, next: 2 },
    { fields: [{ id: '3' }], unreachableFrames: 1 },
  ]
  const { steps, run } = pageOf(one => JSON.stringify(pages[one.offset === 2 ? 1 : 0]))
  const result = JSON.parse(await formResult(step({ action: 'read' }), run)) as {
    fields: { id: string }[]
    unreachableFrames: number
  }
  assert.deepEqual(
    result.fields.map(one => one.id),
    ['1', '2', '3'],
  )
  assert.equal(result.unreachableFrames, 1)
  assert.deepEqual(
    steps.map(one => one.offset),
    [0, 2],
  )
})

test('a read that does not advance stops, and one Chrome blocked says so', async () => {
  const stuck = pageOf(() => JSON.stringify({ fields: [{ id: '1' }], next: 0 }))
  await formResult(step({ action: 'read' }), stuck.run)
  assert.equal(stuck.steps.length, 1)
  const blocked = pageOf(() => '[BLOCKED: Cookie/query string data]')
  assert.match(
    await formResult(step({ action: 'read' }), blocked.run),
    /^Error: could not read the form: \[BLOCKED/,
  )
})

test('a press looks first, and never reaches a control that reads like a submit', async () => {
  for (const [line, reason] of [
    ['button "Submit application" type="submit"', 'its label'],
    ['button "Send"', 'its label'],
    ['button "Confirm and continue"', 'its label'],
    ['button "Finish"', 'its label'],
    ['button "Apply now" type="submit"', 'a submit type not labelled as a step'],
    ['button "" type="submit"', 'an icon that submits'],
    ['button ""', 'nothing to read it by'],
  ] as const) {
    const { steps, run } = pageOf(() => JSON.stringify({ line }))
    const answer = await formResult(step({ action: 'press', id: '5' }), run)
    assert.match(answer, /^Field 5 .* deep_form never presses it/, reason)
    assert.deepEqual(
      steps.map(one => one.action),
      ['describe'],
      reason,
    )
  }
})

test('a press that cannot read its control refuses too', async () => {
  for (const look of ['[BLOCKED: Base64 encoded data]', 'x', '{"error":"No field 5"}']) {
    const { steps, run } = pageOf(() => look)
    assert.match(await formResult(step({ action: 'press', id: '5' }), run), /^Could not read/)
    assert.equal(steps.length, 1)
  }
})

test('a press goes ahead on a step button or a choice in a list', async () => {
  for (const line of [
    'button "Next"',
    'button "Next" type="submit"',
    'button "Save and continue" type="submit"',
    'option "Canada"',
  ]) {
    const { steps, run } = pageOf(one =>
      one.action === 'describe' ? JSON.stringify({ line }) : '{"pressed":"Next"}',
    )
    assert.equal(await formResult(step({ action: 'press', id: '4' }), run), '{"pressed":"Next"}')
    assert.deepEqual(
      steps.map(one => one.action),
      ['describe', 'press'],
    )
  }
})

test('the other actions are one step each', async () => {
  for (const input of [
    { action: 'fill', id: '3', value: 'true' },
    { action: 'add_file_input' },
    { action: 'attach', id: '3' },
  ]) {
    const { steps, run } = pageOf(() => '{"id":"3"}')
    assert.equal(await formResult(step(input), run), '{"id":"3"}')
    assert.deepEqual(
      steps.map(one => one.action),
      [input.action],
    )
  }
})
