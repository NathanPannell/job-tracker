// The Chrome guard for background prefills. Several prefills run side by side in one Claude in
// Chrome tab group; on 2026-10-28 one agent's clicks landed in another's tab and submitted an
// application nobody approved. So every Claude in Chrome call a prefill makes is checked here:
// it may act only in tabs it opened itself, only through element refs (never screen
// coordinates), and never on a control that submits, sends or confirms. The hook applies these
// verdicts; this module decides them and reads the pages, with no engine calls of its own.

/** The Claude in Chrome tools as the engine names them: `mcp__claude-in-chrome__<tool>`. */
const PREFIX = /^mcp__(claude-in-chrome)__(.+)$/i

/** A Claude in Chrome call: its server, the tool's own name and its arguments. */
export type ChromeCall = { server: string; tool: string; input: Record<string, unknown> }

/** The Claude in Chrome call a tool call is, or undefined for any other tool. */
export function chromeCall(tool: string, input: Record<string, unknown>): ChromeCall | undefined {
  const match = PREFIX.exec(tool)
  return match?.[1] && match[2] ? { server: match[1], tool: match[2], input } : undefined
}

/** A browser_batch's items as calls of their own; any other call as itself. */
export function flatten(call: ChromeCall): ChromeCall[] {
  if (call.tool !== 'browser_batch') return [call]
  const actions = Array.isArray(call.input.actions) ? call.input.actions : []
  return actions.map(item => {
    const { name, input } = (item ?? {}) as { name?: unknown; input?: unknown }
    const tool = String(name ?? '').replace(PREFIX, '$2')
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    return { server: call.server, tool, input: args }
  })
}

/** The tab a call names, when it names one by number. */
export function tabOf(call: ChromeCall): number | undefined {
  const { tabId } = call.input
  if (typeof tabId === 'number' && Number.isInteger(tabId)) return tabId
  if (typeof tabId === 'string' && /^\d+$/.test(tabId)) return Number(tabId)
  return undefined
}

/** Tools that act on no tab: reading the group, or opening a tab of the agent's own. */
const UNSCOPED = new Set(['tabs_context_mcp', 'tabs_create_mcp', 'list_connected_browsers'])

/** Tools a prefill may use on its own tab. Anything else (scripts, shortcuts, resizing) is refused. */
const SCOPED = new Set([
  'navigate',
  'read_page',
  'find',
  'get_page_text',
  'form_input',
  'file_upload',
  'computer',
  'read_console_messages',
  'read_network_requests',
])

/** `computer` actions that only look or wait. */
const LOOKS = new Set(['screenshot', 'zoom', 'wait', 'scroll', 'scroll_to', 'hover'])

/** Clicks a prefill may make, by ref only, once the element is known not to submit. */
const CLICKS = new Set(['left_click', 'double_click', 'triple_click'])

/** Keys that move focus or edit text; Enter, Return and Space can press a button, so none of them. */
const SAFE_KEYS = new Set([
  'tab',
  'shift+tab',
  'escape',
  'esc',
  'backspace',
  'delete',
  'home',
  'end',
  'pageup',
  'pagedown',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'up',
  'down',
  'left',
  'right',
  'ctrl+a',
  'cmd+a',
])

/**
 * An element to read before acting on it: a click goes ahead only if the element does not submit,
 * a fill only if it is a field (form_input on a button or link would press it).
 */
export type RefCheck = { tabId: number; ref: string; kind: 'click' | 'fill' }

/** What a prefill's call may do: refused with a reason, or allowed once each check passes. */
export type Verdict = { deny: string } | { checks: RefCheck[] }

const REFS_ONLY =
  'Background prefills act only through element refs: get one from find or read_page, then use form_input, file_upload or a computer click with `ref` (no coordinates).'

/**
 * Judges one Claude in Chrome call a background prefill makes, given the tabs it opened. A
 * browser_batch is judged item by item, and refused whole if any item is. Its elements are read
 * before any item runs, so nothing may follow a click or navigate there (the page it read would
 * be gone), and a tab is opened with a call of its own, so its id is read from its own result.
 */
export function judgePrefill(call: ChromeCall, own: readonly number[]): Verdict {
  const items = flatten(call)
  const checks: RefCheck[] = []
  for (const [n, one] of items.entries()) {
    if (call.tool === 'browser_batch' && one.tool === 'tabs_create_mcp') {
      return { deny: 'Open your tab with tabs_create_mcp on its own, not inside a browser_batch.' }
    }
    if (n < items.length - 1 && changesPage(one)) {
      return {
        deny: 'In a browser_batch, a click or navigate must be the last item: the next items would act on a page the guard has not read. Send the rest in a new call.',
      }
    }
    const verdict = judgeOne(one, own)
    if ('deny' in verdict) return verdict
    checks.push(...verdict.checks)
  }
  return { checks }
}

/** Whether a call can replace what the page shows: a click or a navigation. */
const changesPage = (call: ChromeCall) =>
  call.tool === 'navigate' ||
  (call.tool === 'computer' && CLICKS.has(String(call.input.action ?? '')))

function judgeOne(call: ChromeCall, own: readonly number[]): Verdict {
  const { tool, input } = call
  if (tool === 'browser_batch') return { deny: 'A browser_batch cannot hold another.' }
  if (UNSCOPED.has(tool)) return { checks: [] }
  if (tool === 'tabs_close_mcp') {
    return { deny: 'Leave your tab open on the form: the conversation picks it up from there.' }
  }
  if (!SCOPED.has(tool)) {
    return {
      deny: `${tool} is not available to a background prefill: it could act outside your own tab or submit the form. ${REFS_ONLY}`,
    }
  }
  const tabId = tabOf(call)
  if (tabId === undefined) {
    return {
      deny: `Pass tabId: a background prefill acts only in the tab it opened with tabs_create_mcp${own.length > 0 ? ` (yours: ${own.join(', ')})` : ''}.`,
    }
  }
  if (!own.includes(tabId)) {
    return {
      deny: `Tab ${tabId} is not yours: other prefills run side by side in this browser, so act only in the tab you opened with tabs_create_mcp${own.length > 0 ? ` (yours: ${own.join(', ')})` : ''}.`,
    }
  }
  if (tool === 'form_input') {
    const ref = typeof input.ref === 'string' ? input.ref.trim() : ''
    return ref === '' ? { deny: REFS_ONLY } : { checks: [{ tabId, ref, kind: 'fill' }] }
  }
  if (tool !== 'computer') return { checks: [] }
  return judgeComputer(input, tabId)
}

function judgeComputer(input: Record<string, unknown>, tabId: number): Verdict {
  const action = String(input.action ?? '')
  if (LOOKS.has(action)) return { checks: [] }
  if (action === 'type') {
    const text = String(input.text ?? '')
    return /[\r\n]/.test(text)
      ? { deny: 'Type text without line breaks: Enter can submit the form.' }
      : { checks: [] }
  }
  if (action === 'key') {
    const keys = String(input.text ?? '')
      .trim()
      .split(/\s+/)
      .map(one => one.toLowerCase())
    const unsafe = keys.find(one => !SAFE_KEYS.has(one))
    return unsafe === undefined
      ? { checks: [] }
      : {
          deny: `The key "${unsafe}" can press a button or submit the form; a background prefill may press only Tab, arrows, Escape, Backspace, Delete, Home, End, PageUp, PageDown and select-all.`,
        }
  }
  if (CLICKS.has(action)) {
    const ref = typeof input.ref === 'string' ? input.ref.trim() : ''
    if (input.coordinate !== undefined || ref === '') return { deny: REFS_ONLY }
    return { checks: [{ tabId, ref, kind: 'click' }] }
  }
  return {
    deny: `The computer action "${action}" is not available to a background prefill. ${REFS_ONLY}`,
  }
}

/** Labels of controls that send an application, or may in one step. */
const SUBMITS =
  /\b(submit|send|confirm|finish|complete|place order|quick apply|one[- ]click|1[- ]click)\b/i

/** Labels of buttons that move a multi-step form on: these may be type="submit" yet send nothing. */
const STEPS = /^(next|continue|proceed|review|save (and|&) (continue|next))\b/i

/** Roles a click cannot send a form from: fields, choices and options, whatever their label says. */
const FIELDS =
  /^(textbox|searchbox|combobox|listbox|option|spinbutton|slider|checkbox|radio|switch|menuitemradio|menuitemcheckbox)\b/i

/**
 * Whether an element, as read_page shows it by its ref, could send the application: it, or
 * anything inside it, is labelled like submit, send, confirm or finish, or is a submit button
 * labelled as anything but a step (Next, Continue, Review), an unlabelled icon included. Fields
 * and choices never count; link targets are left out; an element that cannot be read counts.
 */
export function isSubmitControl(element: string): boolean {
  const shown = shownOf(element)
  if (shown === '' || /^error\b/i.test(shown)) return true
  return shown.split('\n').some(line => {
    const row = line.trim()
    if (FIELDS.test(row)) return false
    const label = (/"([^"]*)"/.exec(row)?.[1] ?? '').trim()
    return SUBMITS.test(label) || (/\btype="submit"/i.test(row) && !STEPS.test(label))
  })
}

/**
 * Whether an element, as read_page shows it by its ref, is no field to fill: a button, link or
 * menu item (form_input on it would press it), or an element that cannot be read.
 */
export function isPressable(element: string): boolean {
  const shown = shownOf(element)
  return shown === '' || /^error\b/i.test(shown) || /^(button|link|menuitem)\b/i.test(shown)
}

/** The element as read_page shows it, without the viewport line or link targets. */
const shownOf = (element: string) =>
  (element.split(/\n\s*Viewport:/)[0] ?? '').replace(/\bhref="[^"]*"/g, '').trim()

/**
 * The tab a tabs_create_mcp result opens, read from its first words (`Created new tab. Tab ID:
 * 123`) and nowhere else, so a page title in its tab list can never name one.
 */
export function createdTab(text: string): number | undefined {
  const match = /^\s*Created new tab\.\s*Tab ID:\s*(\d+)/i.exec(text)
  return match?.[1] ? Number(match[1]) : undefined
}

/** Phrases a confirmation page shows once an application has been sent, and an FAQ does not. */
const SUBMITTED = [
  /thank(s| you) for (applying|your application|submitting)/i,
  /^(your )?application (successfully )?(submitted|received|sent)\b/i,
  /your application (has been|was) (successfully )?(submitted|received|sent)\b/i,
  /we('ve| have)? received your application/i,
  /you('ve| have) successfully applied/i,
  /successfully (submitted|applied)/i,
  /your application (is|has been) (on its way|in)\b/i,
]

/**
 * The line of a page's text that says the application was sent, if any: the check made on every
 * prefill's tabs when it ends, since a background run must never get that far.
 */
export function submittedLine(page: string): string | undefined {
  const line = page
    .split('\n')
    .map(one => one.trim())
    .find(one => SUBMITTED.some(pattern => pattern.test(one)))
  return line === undefined ? undefined : line.length > 160 ? `${line.slice(0, 159)}…` : line
}

/**
 * The tools a background prefill uses besides Claude in Chrome: the skill, its package files and
 * the board. Anything else (desktop control, another browser, agents, messages, schedules) could
 * act outside its own tab, so it is refused.
 */
const PREFILL_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'PowerShell',
  'ToolSearch',
  'Skill',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'mcp__job-tracker__list_leads',
])

/** Why a background prefill may not call a tool other than Claude in Chrome; undefined if it may. */
export function judgeOther(tool: string): string | undefined {
  return PREFILL_TOOLS.has(tool)
    ? undefined
    : `${tool} is not available to a background prefill: it reads its package and fills the form in its own Claude in Chrome tab, nothing else.`
}

/** The words that open a prefill's report when its tab reads as submitted. */
export const STRAY_SUBMIT = 'STRAY SUBMIT DETECTED'

/** Whether a prefill's report opens by saying its tab reads as submitted. */
export function isStraySubmit(report: string): boolean {
  return report.replace(/^[\s*_`#>-]+/, '').startsWith(STRAY_SUBMIT)
}
