import { expect, test } from 'claude-code/testing'

test('the mod loads and the session starts', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const started = await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  expect(started.cwd).toBe('.')
})
