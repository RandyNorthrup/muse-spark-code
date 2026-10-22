// The committed Tab hook fixtures (`test/fixtures/tabHooks/read.sh` and
// `read.ps1`) over a guard's real stdin, reporting the real exit code and
// pipes. Shared so the Tab suites cannot drift apart.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { TabHookRun, TabHooksDeps } from '../../../src/core/tab/tabHooks'
import {
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../src/shared/constants'

/** The fixture's answer: allow, deny (exit 2), crash, or garbage output. */
export type TabHookFixtureMode = 'allow' | 'deny' | 'crash' | 'garbage'

/** A `run` that answers through the fixture for `mode`, keeping each request in `seen`. */
export function fixtureHookRun(
  mode: TabHookFixtureMode,
  seen: TabHookRun[] = [],
): TabHooksDeps['run'] {
  return (request: TabHookRun) => {
    seen.push(request)
    const isWindows = process.platform === 'win32'
    const systemRoot = process.env['SystemRoot']
    if (isWindows && systemRoot === undefined)
      throw new Error('Windows fixture requires SystemRoot')
    const program = isWindows
      ? path.win32.join(systemRoot ?? '', WINDOWS_POWERSHELL_RELATIVE_PATH)
      : '/bin/sh'
    const args = isWindows
      ? [
          ...WINDOWS_POWERSHELL_COMMAND_ARGS.filter((arg) => arg !== '-Command'),
          '-File',
          'test/fixtures/tabHooks/read.ps1',
          mode,
        ]
      : ['test/fixtures/tabHooks/read.sh', mode]
    const child = spawnSync(program, args, {
      input: request.stdin,
      encoding: 'utf8',
      env: isWindows ? { SystemRoot: systemRoot } : {},
    })
    if (child.error !== undefined) throw child.error
    return Promise.resolve([
      {
        exitCode: child.status,
        stdout: child.stdout,
        stderr: child.stderr,
        isTimedOut: false,
        isCancelled: false,
      },
    ])
  }
}
