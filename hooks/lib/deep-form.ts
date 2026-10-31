// Forms element refs cannot reach. find and read_page stop at shadow roots and iframes, so the
// fields and file inputs of forms such as SmartRecruiters' and HubSpot's get no ref, and a
// background prefill used to stop there. A prefill may still not run JavaScript of its own: a
// script could press the final submit, and one page's text could write it. So the deep_form tool
// runs the fixed script below, in which only the action, a field id and a value vary, always as
// JSON. It reaches open shadow roots and same-origin iframes, and it presses nothing that reads
// like a submit (isSubmitControl, the guard's own check, decides from the page's own label).

import { isSubmitControl, tabOf } from './chrome.ts'

export const FORM_ACTIONS = ['read', 'fill', 'press', 'add_file_input', 'attach'] as const

/** One script run: what a deep_form call asks, or the look at a control that comes before a press. */
export type FormStep = {
  tabId: number
  action: (typeof FORM_ACTIONS)[number] | 'describe'
  id?: string
  value?: string
  /** Where a read carries on: Claude in Chrome cuts a script's result at about 1000 characters. */
  offset?: number
}

/** A deep_form call's arguments as a step, or why they cannot be one. */
export function formStep(input: Record<string, unknown>): FormStep | { error: string } {
  const tabId = tabOf({ server: '', tool: 'deep_form', input })
  const action = FORM_ACTIONS.find(one => one === input.action)
  if (tabId === undefined) return { error: 'Error: deep_form needs tabId' }
  if (action === undefined) return { error: `Error: action is one of ${FORM_ACTIONS.join(', ')}` }
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (id === '' && ['fill', 'press', 'attach'].includes(action)) {
    return { error: `Error: ${action} needs the id of a field from action read` }
  }
  if (action === 'fill' && typeof input.value !== 'string') {
    return { error: 'Error: fill needs value, a string' }
  }
  return {
    tabId,
    action,
    ...(id === '' ? {} : { id }),
    ...(typeof input.value === 'string' ? { value: input.value } : {}),
  }
}

/** Runs one step in the page and gives back its text. */
export type RunStep = (step: FormStep) => Promise<string>

/** What a deep_form call answers: a whole read, a press if it may go ahead, or a step's result. */
export function formResult(step: FormStep, run: RunStep): Promise<string> {
  if (step.action === 'read') return readAll(step, run)
  return step.action === 'press' ? press(step, run) : run(step)
}

/** A read pages through the form, however many results it takes. */
async function readAll(step: FormStep, run: RunStep): Promise<string> {
  const fields: unknown[] = []
  let offset: number | undefined = 0
  let unreachableFrames: unknown
  while (offset !== undefined) {
    const text: string = await run({ ...step, offset })
    const page = parsed(text)
    if (!Array.isArray(page?.fields)) return `Error: could not read the form: ${text}`
    fields.push(...(page.fields as unknown[]))
    unreachableFrames = page.unreachableFrames
    offset = typeof page.next === 'number' && page.next > offset ? page.next : undefined
  }
  return JSON.stringify({ fields, unreachableFrames })
}

async function press(step: FormStep, run: RunStep): Promise<string> {
  const look = await run({ ...step, action: 'describe' })
  return pressRefusal(look, step.id ?? '') ?? run(step)
}

/**
 * Why a control may not be pressed, from what the describe step gave back, or undefined if it may.
 * A control with no label to read, or a result that is not the script's, counts as a submit.
 */
function pressRefusal(look: string, id: string): string | undefined {
  const line = parsed(look)?.line
  if (typeof line !== 'string') return `Could not read field ${id}: ${look}`
  return isSubmitControl(line) || /""/.test(line)
    ? `Field ${id} (${line}) looks like it submits, sends or confirms, or has no label, so deep_form never presses it. A background prefill leaves it for the conversation, which asks the person first.`
    : undefined
}

function parsed(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** The script for one step: the page's half of the tool, with its arguments as JSON data. */
export const formScript = ({ action, id, value, offset }: FormStep) =>
  `(${PAGE})(${JSON.stringify({ action, id, value, offset })})`

/** Runs in the page. It returns JSON text; nothing here but `press` and a box's tick clicks. */
const PAGE = String.raw`({ action, id, value, offset = 0 }) => {
  const ATTR = 'data-job-tracker-field'
  const TEMP = 'job-tracker-temp-file'
  const ROLES = 'button,checkbox,radio,switch,combobox,listbox,option,menuitem,menuitemradio,tab'
  const CONTROLS = [
    'input:not([type=hidden])',
    'textarea',
    'select',
    'button',
    '[contenteditable=true]',
    ...ROLES.split(',').map(role => '[role=' + role + ']'),
  ].join(',')

  const all = (root, found = []) => {
    for (const el of root.querySelectorAll('*')) {
      found.push(el)
      if (el.shadowRoot) all(el.shadowRoot, found)
      if (el.tagName === 'IFRAME' && el.contentDocument) all(el.contentDocument, found)
    }
    return found
  }

  const SILENT = ['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'SELECT', 'TEXTAREA']
  const textOf = node => {
    if (node.nodeType === 3) return node.textContent
    if (SILENT.includes(node.tagName)) return ''
    const named = node.nodeType === 1 ? (node.getAttribute('aria-label') ?? node.alt ?? '') : ''
    const kids =
      node.tagName === 'SLOT' && node.assignedNodes({ flatten: true }).length > 0
        ? node.assignedNodes({ flatten: true })
        : (node.shadowRoot ?? node).childNodes
    return [named, ...[...kids].map(textOf)].join(' ')
  }
  const clean = text => String(text ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim()
  // Claude in Chrome blocks a whole result that holds text like a query string or cookie.
  const short = (text, most = 160) => {
    const kept = clean(String(text ?? '').replace(/\S*=\S*/g, ''))
    return kept.length > most ? kept.slice(0, most - 1) + '…' : kept
  }

  const kindOf = el => {
    const tag = el.tagName
    const type = String(el.type ?? '').toLowerCase()
    if (tag === 'BUTTON' || tag === 'A') return 'button'
    if (tag === 'SELECT') return 'select'
    if (tag === 'TEXTAREA') return 'text'
    if (tag === 'INPUT') {
      if (['submit', 'button', 'image', 'reset'].includes(type)) return 'button'
      return ['checkbox', 'radio', 'file', 'password'].includes(type) ? type : 'text'
    }
    const role = el.getAttribute('role') ?? ''
    if (role === 'button') return 'button'
    if (role === 'checkbox' || role === 'switch') return 'checkbox'
    if (role === 'radio') return 'radio'
    return ROLES.split(',').includes(role) ? 'choice' : 'text'
  }

  const labelOf = el => {
    const kind = kindOf(el)
    const root = el.getRootNode()
    const by = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .flatMap(one => root.getElementById?.(one) ?? [])
    const named = clean(
      [el.getAttribute('aria-label'), ...by.map(textOf), ...[...(el.labels ?? [])].map(textOf)].join(' '),
    )
    if (kind === 'button' || kind === 'choice') {
      const shown = el.tagName === 'INPUT' ? el.value : textOf(el)
      return clean(named + ' ' + (el.getAttribute('title') ?? '') + ' ' + shown)
    }
    if (named) return named
    const own = el.getAttribute('placeholder') ?? el.getAttribute('title') ?? ''
    if (clean(own)) return clean(own)
    for (let node = el, up = 0; up < 6; up += 1) {
      node = node.parentNode ?? node.host
      if (!node || node.tagName === 'FORM' || node.tagName === 'BODY') break
      const near = clean(textOf(node))
      if (near) return near
    }
    return clean(el.getAttribute('name'))
  }

  const stateOf = el => {
    const kind = kindOf(el)
    if (kind === 'checkbox' || kind === 'radio') {
      return { checked: el.checked ?? el.getAttribute('aria-checked') === 'true' }
    }
    if (kind === 'file') return { files: [...el.files].map(one => one.name) }
    if (kind === 'text') return { value: short(el.value ?? el.textContent) }
    if (kind === 'select') {
      let room = 300
      const options = [...el.options]
        .map(one => short(one.text))
        .filter(text => (room -= text.length + 3) > 0)
      return { value: short(el.selectedOptions[0]?.text), options }
    }
    return {}
  }

  const describe = (el, fieldId) => ({
    id: fieldId,
    kind: kindOf(el),
    // A box's whole wording decides whether it may be ticked.
    label: short(labelOf(el), kindOf(el) === 'checkbox' ? 500 : 160),
    ...stateOf(el),
    ...(el.required || el.getAttribute('aria-required') === 'true' ? { required: true } : {}),
    ...(el.disabled || el.getAttribute('aria-disabled') === 'true' ? { disabled: true } : {}),
  })

  const read = () => {
    const nodes = all(document)
    const used = nodes.map(el => Number(el.getAttribute(ATTR)) || 0)
    let next = Math.max(0, ...used)
    const fields = nodes.flatMap(el => {
      if (!el.matches(CONTROLS)) return []
      const hideable = ['checkbox', 'radio', 'file'].includes(kindOf(el))
      if (!hideable && el.getClientRects().length === 0) return []
      if (!el.hasAttribute(ATTR)) {
        next += 1
        el.setAttribute(ATTR, String(next))
      }
      return [describe(el, el.getAttribute(ATTR))]
    })
    const frames = nodes.filter(el => el.tagName === 'IFRAME' && !el.contentDocument).length
    const page = []
    let size = 0
    for (const field of fields.slice(offset)) {
      size += JSON.stringify(field).length + 1
      if (page.length > 0 && size > 800) break
      page.push(field)
    }
    const end = offset + page.length
    return { fields: page, unreachableFrames: frames, ...(end < fields.length ? { next: end } : {}) }
  }

  const fire = (el, ...types) => {
    for (const type of types) {
      el.dispatchEvent(new Event(type, { bubbles: true, composed: true }))
    }
  }

  const setValue = (el, text) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    if (setter) setter.call(el, text)
    else el.value = text
  }

  const fill = el => {
    const kind = kindOf(el)
    if (kind === 'checkbox' || kind === 'radio') {
      if (Boolean(stateOf(el).checked) !== (value !== 'false')) el.click()
    } else if (kind === 'select') {
      const option = [...el.options].find(one => clean(one.text) === value || one.value === value)
      if (!option) return { error: 'No option "' + value + '" in ' + labelOf(el) }
      setValue(el, option.value)
      fire(el, 'input', 'change', 'blur', 'focusout')
    } else if (kind === 'text') {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') setValue(el, value)
      else el.textContent = value
      fire(el, 'input', 'change', 'blur', 'focusout')
    } else {
      return { error: labelOf(el) + ' is a ' + kind + ' control, which fill leaves alone' }
    }
    return describe(el, id)
  }

  const addFileInput = () => {
    if (!document.getElementById(TEMP)) {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = TEMP
      input.setAttribute('aria-label', 'Job tracker temporary file input')
      input.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647'
      document.body.append(input)
    }
    return { added: TEMP, next: 'find it, file_upload to its ref, then action attach' }
  }

  const attach = el => {
    const temp = document.getElementById(TEMP)
    if (kindOf(el) !== 'file') return { error: labelOf(el) + ' is not a file input' }
    if (!temp?.files?.length) return { error: 'No file in the temporary input: file_upload first' }
    const data = new DataTransfer()
    for (const file of temp.files) data.items.add(file)
    el.files = data.files
    fire(el, 'input', 'change')
    temp.remove()
    return describe(el, id)
  }

  const result = (() => {
    if (action === 'read') return read()
    if (action === 'add_file_input') return addFileInput()
    const el = all(document).find(one => one.getAttribute(ATTR) === id)
    if (!el) return { error: 'No field ' + id + ': the page changed, so read it again' }
    if (action === 'fill') return fill(el)
    if (action === 'attach') return attach(el)
    const kind = kindOf(el)
    if (kind !== 'button' && kind !== 'choice') {
      return { error: labelOf(el) + ' is a ' + kind + ' control, which press leaves alone' }
    }
    if (action === 'describe') {
      const type = String(el.type ?? '').toLowerCase()
      const sends = kind === 'button' && (type === 'submit' || type === 'image')
      const role = kind === 'button' ? 'button' : 'option'
      return { line: role + ' "' + labelOf(el) + '"' + (sends ? ' type="submit"' : '') }
    }
    el.click()
    return { pressed: short(labelOf(el)) }
  })()
  return JSON.stringify(result)
}`
