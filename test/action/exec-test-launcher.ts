// M80 W (SPEC §7.5): the bin of the fake-only test package. Never released:
// scripts/package-acp-test.mjs bundles it as dist/exec-test-launcher.js in a
// private, separately named tarball. It snapshots exec's arguments and
// environment as hashes, replaces fetch only for the Model API's exact origin
// with execTestTransport's scripted fake (other URLs keep the real
// transport), then loads the real dist/acp.js beside it. At exit it writes
// its report beside the Action invocation's private work/ (the working
// directory run-exec gives exec and the scanner), which tidy keeps.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { createWTransport, scenarioOf, wReport } from './execTestTransport'

const REPORT_MODE = 0o600
const WORK_FOLDER = 'work'

/** A process's initial OS environment: Linux /proc, macOS `ps eww` (limited evidence). */
function initialEnvironOf(pid: number): string | undefined {
  try {
    if (process.platform === 'linux') return readFileSync(`/proc/${String(pid)}/environ`, 'latin1')
    if (process.platform === 'darwin') {
      return execFileSync('/bin/ps', ['eww', '-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
      })
    }
  } catch {
    // Not inspectable here; the report says so.
  }
  return undefined
}

const argv = process.argv.slice(2)
const env = { ...process.env }
const scenario = scenarioOf(argv)
const transport = createWTransport(scenario, globalThis.fetch.bind(globalThis))
// Replaced before acp.js loads: the runtime binds globalThis.fetch when it runs.
Object.defineProperty(globalThis, 'fetch', {
  value: transport.fetch,
  writable: true,
  configurable: true,
})
const initialEnviron = initialEnvironOf(process.pid)
const parentEnviron = initialEnvironOf(process.ppid)
const cwd = process.cwd()
const reportDir = path.basename(cwd) === WORK_FOLDER ? path.dirname(cwd) : undefined

process.on('exit', () => {
  if (reportDir === undefined) return
  const report = wReport({
    command: argv[0] ?? '',
    scenario,
    argv,
    env,
    transport,
    initialEnviron,
    parentEnviron,
  })
  writeFileSync(
    path.join(reportDir, `w-report-${report.command}-${String(process.pid)}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx', mode: REPORT_MODE },
  )
})

createRequire(path.resolve(process.argv[1] ?? ''))('./acp.js')
