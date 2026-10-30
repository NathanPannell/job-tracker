// Fails when a file that git would commit holds personal data. Run in CI and before every commit;
// with JOB_TRACKER_DATA set it also checks for the exact identity values in the local profile.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { denyListFromProfile, scanFile } from '../bin/lib/personal-data.ts'

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)

const dataDir = process.env.JOB_TRACKER_DATA
const profilePath = dataDir ? join(dataDir, 'profile', 'knowledge-base', 'profile.md') : ''
const denyList =
  profilePath && existsSync(profilePath)
    ? denyListFromProfile(readFileSync(profilePath, 'utf8'))
    : []

const problems = files.flatMap(file =>
  existsSync(file) && statSync(file).isFile()
    ? scanFile(file, readFileSync(file, 'utf8'), denyList)
    : [],
)

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} problem(s): personal data must stay in the data folder.`)
  process.exit(1)
}
console.log(
  `No personal data in ${files.length} files${denyList.length ? ' (profile deny-list checked)' : ''}.`,
)
