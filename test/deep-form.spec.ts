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
    ['button "Apply"', 'the final button of a form past the refs'],
    ['button "Apply now"', 'the final button of a form past the refs'],
    ['menuitem "Submit application"', 'its label, whatever its role'],
    ['tab "Submit"', 'its label, whatever its role'],
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
    assert.equal(steps[1]?.expect, line)
  }
})

/** One element as the page script reads it, tagged with a field id, and its clicks. */
function element(tagName: string, attrs: Record<string, string>, text = '', own = {}) {
  const shown = { nodeType: 3, textContent: text }
  const tagged: Record<string, string> = { 'data-job-tracker-field': '5', ...attrs }
  const seen = { clicks: 0, shown }
  const el = {
    nodeType: 1,
    tagName,
    childNodes: [shown],
    getAttribute: (name: string) => tagged[name] ?? null,
    hasAttribute: (name: string) => name in tagged,
    getRootNode: () => ({}),
    click: () => (seen.clicks += 1),
    ...own,
  }
  return { el, seen }
}

/** Runs each step's real script on a page of these elements. */
const scriptOn =
  (...els: unknown[]): RunStep =>
  one => {
    const document = { querySelectorAll: () => els }
    return Promise.resolve(runInNewContext(formScript(one), { document }) as string)
  }

test('on the page, a press reports the real role, so a menu item or tab cannot pass as a choice', async () => {
  for (const role of ['menuitem', 'tab']) {
    const { el, seen } = element('DIV', { role }, 'Submit application')
    assert.match(
      await formResult(step({ action: 'press', id: '5' }), scriptOn(el)),
      /deep_form never presses it/,
    )
    assert.equal(seen.clicks, 0, role)
  }
  const { el, seen } = element('DIV', { role: 'option' }, 'Canada')
  await formResult(step({ action: 'press', id: '5' }), scriptOn(el))
  assert.equal(seen.clicks, 1)
})

test('on the page, a button that becomes something else between the look and the click is left', async () => {
  const { el, seen } = element('BUTTON', {}, 'Next', { type: 'button' })
  const page = scriptOn(el)
  const run: RunStep = async one => {
    const answer = await page(one)
    seen.shown.textContent = 'Submit application'
    return answer
  }
  assert.match(await formResult(step({ action: 'press', id: '5' }), run), /changed, so read it/)
  assert.equal(seen.clicks, 0)
})

test('on the page, a box drawn as a button is ticked, unless a click would also submit', async () => {
  const box = element('BUTTON', { role: 'checkbox', 'aria-checked': 'false' }, '', {
    type: 'button',
  })
  await formResult(step({ action: 'fill', id: '5', value: 'true' }), scriptOn(box.el))
  assert.equal(box.seen.clicks, 1)
  const sends = element('BUTTON', { role: 'checkbox' }, 'Yes', { type: 'submit' })
  assert.match(
    await formResult(step({ action: 'fill', id: '5', value: 'true' }), scriptOn(sends.el)),
    /which fill leaves alone/,
  )
  assert.equal(sends.seen.clicks, 0)
})

test('on the page, a box shows the wording beside its label', async () => {
  const box = element('INPUT', { type: 'checkbox', 'aria-label': 'Consent' }, '', {
    type: 'checkbox',
    checked: false,
    parentNode: {
      nodeType: 1,
      tagName: 'DIV',
      childNodes: [
        { nodeType: 3, textContent: 'I accept the Terms of Use and binding arbitration' },
      ],
      getAttribute: () => null,
    },
    matches: () => true,
    getClientRects: () => [],
  })
  const answer = JSON.parse(await scriptOn(box.el)(step({ action: 'read' }))) as {
    fields: { label: string; near: string }[]
  }
  assert.equal(answer.fields[0]?.label, 'Consent')
  assert.match(answer.fields[0]?.near ?? '', /Terms of Use and binding arbitration/)
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
