import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resolveAllExecutables } from '../../../src/core/execGuard'
import { NO_WORKSPACE } from '../../../src/core/executables'

/** A Bourne shell for installer tests: bash, reached through Git on Windows. */
export function testBash() {
  const installedBash = path.join(
    process.env.ProgramFiles ?? 'C:/Program Files',
    'Git/bin/bash.exe',
  )
  let bash = process.platform === 'win32' && existsSync(installedBash) ? installedBash : 'bash'
  if (process.platform === 'win32' && !existsSync(installedBash)) {
    // Git elsewhere than Program Files: the sh.exe in its usr\bin, beside the
    // folder of whichever git on PATH has one (cmd\git.exe has; mingw64\bin\git.exe has not).
    const gits = resolveAllExecutables('git', {
      platform: process.platform,
      pathVariable: process.env.PATH,
      fileExists: existsSync,
      scope: { noWorkspace: NO_WORKSPACE, realpath: realpathSync },
    })
    for (const git of gits) {
      const shell = path.join(path.dirname(git), '..', 'usr', 'bin', 'sh.exe')
      const result = spawnSync(shell, ['--version'], { encoding: 'utf8', windowsHide: true })
      if (result.status === 0 && result.stdout.startsWith('GNU bash,')) {
        bash = shell
        break
      }
    }
  }
  return bash
}
