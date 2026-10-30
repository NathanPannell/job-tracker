// Has the engine write its plugin API's declarations to .claude-plugin/types, where tsconfig.json
// reads them. They are Anthropic's work under its own terms, so they are generated, never
// committed. The engine writes them when a session loads a mod; `plugin validate` and `plugin test`
// do not, so this starts a headless session and stops it once they are there. Nothing is sent:
// the key is a placeholder, the API address is closed, and the session has its own empty config
// and no data folder. CLAUDE_BIN picks the engine; CI and the local gate use the pinned one.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TYPES = join('.claude-plugin', 'types')
const API = join(TYPES, 'claude-code', 'index.d.ts')
const WRITTEN = [API, join(TYPES, 'claude-code-tools', 'index.d.ts'), join(TYPES, 'tsconfig.json')]
const WAIT_MS = 60_000
const POLL_MS = 200
const KILL_MS = 5_000

rmSync(TYPES, { recursive: true, force: true })
const config = mkdtempSync(join(tmpdir(), 'job-tracker-types-'))
const engine = spawn(
  process.env.CLAUDE_BIN ?? 'claude',
  ['--plugin-dir', '.', '-p', 'ok', '--max-turns', '1'],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_PLUGIN_DIRS: '',
      // A headless session writes them only with this set.
      CLAUDE_CODE_PLUGIN_DIR_WATCH: '1',
      JOB_TRACKER_DATA: '',
      ANTHROPIC_API_KEY: 'unused',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    },
  },
)
const exited = new Promise<void>(resolve => {
  engine.once('exit', () => resolve())
  engine.once('error', error => {
    console.error(`Could not start the engine: ${error.message}. Set CLAUDE_BIN.`)
    resolve()
  })
})

const started = Date.now()
const isWritten = () => WRITTEN.every(file => existsSync(file))
while (!isWritten() && engine.exitCode === null && Date.now() - started < WAIT_MS) {
  await new Promise(resolve => setTimeout(resolve, POLL_MS))
}
// The engine may be part way through the last file it saw through.
await new Promise(resolve => setTimeout(resolve, POLL_MS))
engine.kill()
setTimeout(() => engine.kill('SIGKILL'), KILL_MS).unref()
await exited
rmSync(config, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

if (!isWritten()) {
  console.error(`The engine did not write ${TYPES}.`)
  process.exit(1)
}
console.log(readFileSync(API, 'utf8').split('\n')[0])
