import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  chromeCall,
  createdTab,
  flatten,
  isPressable,
  isStraySubmit,
  isSubmitControl,
  judgeOther,
  judgePrefill,
  STRAY_SUBMIT,
  submittedLine,
  tabOf,
} from '../hooks/lib/chrome.ts'
import type { ChromeCall, Verdict } from '../hooks/lib/chrome.ts'
import { submitFollowUp, submitTask } from '../hooks/lib/model.ts'

const chrome = (tool: string, input: Record<string, unknown> = {}): ChromeCall => ({
  server: 'claude-in-chrome',
  tool,
  input,
})
const OWN = [11]
const denied = (verdict: Verdict) => ('deny' in verdict ? verdict.deny : undefined)
const checks = (verdict: Verdict) => ('checks' in verdict ? verdict.checks : undefined)

test('a Claude in Chrome tool call is known by its name; any other tool is not one', () => {
  assert.deepEqual(chromeCall('mcp__claude-in-chrome__computer', { tabId: 1 }), {
    server: 'claude-in-chrome',
    tool: 'computer',
    input: { tabId: 1 },
  })
  assert.equal(chromeCall('mcp__job-tracker__list_leads', {}), undefined)
  assert.equal(chromeCall('Bash', {}), undefined)
})

test('a browser_batch is judged as its items; anything else as itself', () => {
  const batch = chrome('browser_batch', {
    actions: [
      { name: 'find', input: { tabId: 11, query: 'email' } },
      { name: 'mcp__claude-in-chrome__get_page_text', input: { tabId: 11 } },
      null,
      { name: 'read_page' },
    ],
  })
  assert.deepEqual(
    flatten(batch).map(one => [one.tool, tabOf(one)]),
    [
      ['find', 11],
      ['get_page_text', 11],
      ['', undefined],
      ['read_page', undefined],
    ],
  )
  assert.deepEqual(flatten(chrome('browser_batch', {})), [])
  assert.deepEqual(flatten(chrome('find', { tabId: 11 })), [chrome('find', { tabId: 11 })])
  assert.equal(tabOf(chrome('find', { tabId: '11' })), 11)
  assert.equal(tabOf(chrome('find', { tabId: 'eleven' })), undefined)
  assert.equal(tabOf(chrome('find', { tabId: 1.5 })), undefined)
})

test('a prefill acts only in the tabs it opened, and opens them only with tabs_create_mcp', () => {
  assert.deepEqual(judgePrefill(chrome('tabs_create_mcp'), []), { checks: [] })
  assert.deepEqual(judgePrefill(chrome('tabs_context_mcp'), []), { checks: [] })
  // With no tab group yet, tabs_create_mcp fails until one is made: that tab is still nobody's.
  assert.deepEqual(judgePrefill(chrome('tabs_context_mcp', { createIfEmpty: true }), []), {
    checks: [],
  })
  assert.deepEqual(judgePrefill(chrome('read_page', { tabId: 11 }), OWN), { checks: [] })
  // Another agent's tab, or none named, is refused, saying which tabs are its own.
  assert.match(
    denied(judgePrefill(chrome('read_page', { tabId: 12 }), OWN)) ?? '',
    /Tab 12 is not yours.*yours: 11/,
  )
  assert.match(
    denied(judgePrefill(chrome('find', { tabId: 12 }), [])) ?? '',
    /not yours: other prefills/,
  )
  assert.match(
    denied(judgePrefill(chrome('navigate', { url: 'https://x' }), OWN)) ?? '',
    /Pass tabId.*yours: 11/,
  )
  assert.match(
    denied(judgePrefill(chrome('navigate', { url: 'https://x' }), [])) ?? '',
    /tabs_create_mcp\.$/,
  )
  // Its tab stays open for the conversation.
  assert.match(
    denied(judgePrefill(chrome('tabs_close_mcp', { tabId: 11 }), OWN)) ?? '',
    /Leave your tab open/,
  )
})

test('a prefill may not run scripts, shortcuts or resize the shared window', () => {
  for (const tool of ['javascript_tool', 'shortcuts_execute', 'resize_window', 'gif_creator']) {
    assert.match(
      denied(judgePrefill(chrome(tool, { tabId: 11 }), OWN)) ?? '',
      new RegExp(`^${tool} is not available`),
    )
  }
})

test('a prefill clicks only by ref, and each ref is read before the click', () => {
  const click = (input: Record<string, unknown>) =>
    judgePrefill(chrome('computer', { tabId: 11, ...input }), OWN)
  assert.deepEqual(checks(click({ action: 'left_click', ref: ' ref_4 ' })), [
    { tabId: 11, ref: 'ref_4', kind: 'click' },
  ])
  assert.deepEqual(checks(click({ action: 'triple_click', ref: 'ref_5' })), [
    { tabId: 11, ref: 'ref_5', kind: 'click' },
  ])
  // A fill names its field by ref too, and the field is read first.
  assert.deepEqual(checks(judgePrefill(chrome('form_input', { tabId: 11, ref: 'ref_6' }), OWN)), [
    { tabId: 11, ref: 'ref_6', kind: 'fill' },
  ])
  assert.match(
    denied(judgePrefill(chrome('form_input', { tabId: 11, value: 'x' }), OWN)) ?? '',
    /refs/,
  )
  assert.match(denied(click({ action: 'left_click', coordinate: [10, 20] })) ?? '', /refs/)
  assert.match(
    denied(click({ action: 'left_click', ref: 'ref_4', coordinate: [1, 2] })) ?? '',
    /refs/,
  )
  assert.match(denied(click({ action: 'right_click', ref: 'ref_4' })) ?? '', /"right_click" is not/)
  assert.match(denied(click({ action: 'left_click_drag' })) ?? '', /not available/)
  assert.match(denied(click({})) ?? '', /"" is not available/)
  for (const action of ['screenshot', 'zoom', 'wait', 'scroll', 'scroll_to', 'hover']) {
    assert.deepEqual(click({ action }), { checks: [] })
  }
})

test('a prefill types without Enter and presses only keys that cannot press a button', () => {
  const act = (action: string, text?: string) =>
    judgePrefill(chrome('computer', { tabId: 11, action, text }), OWN)
  assert.deepEqual(act('type', 'Victoria, BC'), { checks: [] })
  assert.match(denied(act('type', 'line one\nline two')) ?? '', /line breaks/)
  assert.deepEqual(act('key', 'Tab shift+Tab ArrowDown Escape ctrl+a Backspace'), { checks: [] })
  assert.match(denied(act('key', 'ArrowDown Enter')) ?? '', /"enter"/)
  assert.match(denied(act('key', 'space')) ?? '', /"space"/)
  assert.match(denied(act('key', 'Return')) ?? '', /"return"/)
  assert.match(denied(act('key')) ?? '', /"" can press/)
})

test('a batch is refused whole when any item is, and its ref checks add up', () => {
  const batch = (...actions: { name: string; input: Record<string, unknown> }[]) =>
    judgePrefill(chrome('browser_batch', { actions }), OWN)
  assert.deepEqual(
    checks(
      batch(
        { name: 'form_input', input: { tabId: 11, ref: 'ref_1', value: 'Nathan' } },
        { name: 'form_input', input: { tabId: 11, ref: 'ref_2', value: 'Pannell' } },
        { name: 'computer', input: { tabId: 11, action: 'left_click', ref: 'ref_3' } },
      ),
    ),
    [
      { tabId: 11, ref: 'ref_1', kind: 'fill' },
      { tabId: 11, ref: 'ref_2', kind: 'fill' },
      { tabId: 11, ref: 'ref_3', kind: 'click' },
    ],
  )
  assert.match(
    denied(
      batch(
        { name: 'form_input', input: { tabId: 11, ref: 'ref_1', value: 'Nathan' } },
        { name: 'computer', input: { tabId: 12, action: 'left_click', ref: 'ref_2' } },
      ),
    ) ?? '',
    /Tab 12 is not yours/,
  )
  assert.match(
    denied(batch({ name: 'browser_batch', input: { actions: [] } })) ?? '',
    /cannot hold another/,
  )
})

test('in a batch nothing follows a click or navigate, whose page the guard never read', () => {
  const batch = (...actions: { name: string; input: Record<string, unknown> }[]) =>
    judgePrefill(chrome('browser_batch', { actions }), OWN)
  // Next, Next on one wizard button: the second click would press whatever the first revealed.
  const next = { name: 'computer', input: { tabId: 11, action: 'left_click', ref: 'ref_3' } }
  assert.match(denied(batch(next, next)) ?? '', /must be the last item/)
  assert.match(
    denied(
      batch(
        { name: 'navigate', input: { tabId: 11, url: 'https://jobs.example/apply' } },
        { name: 'read_page', input: { tabId: 11 } },
      ),
    ) ?? '',
    /must be the last item/,
  )
  // A tab is opened by a call of its own, whose result alone names it.
  assert.match(
    denied(batch({ name: 'tabs_create_mcp', input: {} })) ?? '',
    /tabs_create_mcp on its own/,
  )
})

test('a control that submits, sends or confirms is known by its label and type, not where it links', () => {
  for (const label of [
    'button "Submit application" [ref_9]',
    'button "Submit your application" [ref_9] type="submit"',
    'button "Send" [ref_9]',
    'button "Confirm and continue" [ref_9]',
    'button "Finish" [ref_9]',
    'button "1-click apply" [ref_9]',
    // A submit button labelled as anything but a step, an unlabelled icon included.
    'button "Apply now" [ref_9] type="submit"',
    'button [ref_9] type="submit"',
    'form [ref_2]\n button "Next" [ref_3]\n button "Submit" [ref_4]',
    'button [ref_5]\n StaticText "Submit"',
    '',
    'Error: no element ref_99',
  ]) {
    assert.equal(isSubmitControl(`${label}\n\nViewport: 824x764`), true, label)
  }
  for (const label of [
    'button "Continue" [ref_9]',
    'button "Next" [ref_9] type="submit"',
    'button "Save and continue" [ref_9] type="submit"',
    'button "Review" [ref_9] type="submit"',
    'link "Apply for this job" [ref_9] href="/jobs/123/application/submit"',
    'button "Apply now" [ref_9]',
    'button "Apply with Indeed" [ref_9]',
    'button "Easy Apply" [ref_9]',
    'radio "Yes" [ref_9]',
    // Fields and choices send nothing, whatever their label or value says.
    'combobox "Please confirm you are legally authorized to work in Canada" [ref_9]',
    'textbox "Notes" [ref_9] value="I can complete onboarding in May"',
    'checkbox "Send me job alerts" [ref_9]',
    'generic [ref_47]',
  ]) {
    assert.equal(isSubmitControl(`${label}\n\nViewport: 824x764`), false, label)
  }
})

test('form_input fills fields only: a button, link or unreadable element is pressable', () => {
  for (const element of [
    'button "Next" [ref_3]',
    'link "Apply for this job" [ref_4] href="/apply"',
    'menuitem "Submit" [ref_5]',
    '',
    'Error: no element ref_99',
  ]) {
    assert.equal(isPressable(`${element}\n\nViewport: 824x764`), true, element)
  }
  for (const element of [
    'textbox "First name" [ref_1]',
    'combobox "Country" [ref_2]',
    'checkbox "I need sponsorship" [ref_3]',
    'textbox "Complete address" [ref_4]',
  ]) {
    assert.equal(isPressable(`${element}\n\nViewport: 824x764`), false, element)
  }
})

test("tabs_create_mcp names the tab it opened in its first words, never a page's title", () => {
  assert.equal(createdTab('Created new tab. Tab ID: 404532447\n\nTab Context: ...'), 404532447)
  assert.equal(
    createdTab('Done\n- Available tabs:\n  • tabId 7: "Created new tab. Tab ID: 404532448"'),
    undefined,
  )
  assert.equal(createdTab('Tab Context:\n- Executed on tabId: 7'), undefined)
})

test('a prefill uses only the tools it needs besides Chrome', () => {
  for (const tool of ['Read', 'Bash', 'ToolSearch', 'Skill', 'mcp__job-tracker__list_leads']) {
    assert.equal(judgeOther(tool), undefined, tool)
  }
  for (const tool of [
    'Agent',
    'Workflow',
    'SendMessage',
    'CronCreate',
    'request_computer',
    'mcp__Claude_Browser__computer',
    'mcp__job-tracker__update_lead',
  ]) {
    assert.match(judgeOther(tool) ?? '', /is not available to a background prefill/, tool)
  }
})

test('a page that reads as a sent application is found by its line; a form or FAQ is not', () => {
  assert.equal(
    submittedLine('Acme\n  Thank you for applying to Acme!  \nWe will be in touch.'),
    'Thank you for applying to Acme!',
  )
  for (const page of [
    'Your application has been submitted.',
    'Application received',
    'Your application was successfully sent',
    "We've received your application for Backend Developer",
    'You have successfully applied',
    'Your application is on its way',
    'Your application is in!',
  ]) {
    assert.ok(submittedLine(page), page)
  }
  for (const page of [
    'Apply for this job\nFirst name *\nSubmit application',
    'Your application is incomplete',
    'Your application will be submitted once you click Submit',
    'Thank you for your interest in Acme. Fill in the form below.',
    "Once you've applied, you'll receive an email from our team.",
    'We process any application submitted through this site under our privacy policy.',
  ]) {
    assert.equal(submittedLine(page), undefined, page)
  }
  assert.equal(submittedLine(`Application submitted ${'x'.repeat(300)}`)?.length, 160)
})

test('a stray submit opens the report, and the conversation is told to say so first and touch nothing', () => {
  const lead = { id: 'acme-api', company: 'Acme', role: 'Backend Developer' }
  const report = `${STRAY_SUBMIT}: tab 11 reads "Thank you for applying". Nobody approved a submit.\n\nTab: Acme`
  assert.equal(isStraySubmit(report), true)
  assert.equal(isStraySubmit(`**${STRAY_SUBMIT}**`), true)
  assert.equal(isStraySubmit('Tab: Acme\nStopped at: filled'), false)
  const next = submitFollowUp(lead, report)
  assert.match(next, /^Before anything else: the background prefill/)
  assert.match(next, /Do not click, fill or submit anything/)
  assert.ok(next.includes(`<<<PREFILL REPORT\n${report}\nPREFILL REPORT>>>`))
  // The prefill's own task names the rules the guard enforces.
  assert.match(submitTask(lead), /tabs_create_mcp, pass its tabId on every call/)
  assert.match(submitTask(lead), /no screen coordinates/)
})
