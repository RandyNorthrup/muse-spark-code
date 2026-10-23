import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resolveExecutable } from '../../../src/core/executables'

/** A Bourne shell for installer tests: bash, reached through Git on Windows. */
export function testBash() {
  const installedBash = path.join(
    process.env.ProgramFiles ?? 'C:/Program Files',
    'Git/bin/bash.exe',
  )
  let bash = process.platform === 'win32' && existsSync(installedBash) ? installedBash : 'bash'
  if (process.platform === 'win32' && !existsSync(installedBash)) {
    const git = resolveExecutable('git', {
      platform: process.platform,
      pathVariable: process.env.PATH,
      fileExists: existsSync,
    })
    if (git !== undefined) {
      const shell = path.join(path.dirname(git), '..', 'usr', 'bin', 'sh.exe')
      const result = spawnSync(shell, ['--version'], { encoding: 'utf8', windowsHide: true })
      if (result.status === 0 && result.stdout.startsWith('GNU bash,')) bash = shell
    }
  }
  return bash
}
