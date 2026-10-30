import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { NO_WORKSPACE } from '../../../src/core/executables'
import { resolveExecutable } from '../../../src/core/execGuard'

/** Where Git for Windows keeps its OpenSSL, from the folder of its `git.exe`. */
const GIT_OPENSSL_FOLDERS = [
  ['..', 'mingw64', 'bin'],
  ['..', 'usr', 'bin'],
  ['..', '..', 'mingw64', 'bin'],
  ['..', '..', 'usr', 'bin'],
]

/**
Makes a real `openssl` reachable on this process's PATH (and so on its
children's) for the suites that sign and verify with it. Hosted runners and
Git Bash have one on PATH. A Windows shell outside Git Bash (PowerShell, cmd)
does not, though Git for Windows ships OpenSSL beside the `git` that shell
finds, so that folder is put in front of PATH. Returns the function that puts
PATH back. With no OpenSSL anywhere, PATH stays as it was and the suite's own
probe refuses loudly.
*/
export function opensslOnPath() {
  if (process.platform !== 'win32') return () => undefined
  if (spawnSync('openssl', ['version'], { windowsHide: true }).status === 0) return () => undefined
  const before = process.env.PATH
  const git = resolveExecutable('git', {
    platform: process.platform,
    pathVariable: before,
    fileExists: existsSync,
    scope: { noWorkspace: NO_WORKSPACE, realpath: realpathSync },
  })
  if (git === undefined) return () => undefined
  const folder = GIT_OPENSSL_FOLDERS.map((segments) =>
    path.resolve(path.dirname(git), ...segments),
  ).find((candidate) => existsSync(path.join(candidate, 'openssl.exe')))
  if (folder === undefined) return () => undefined
  process.env.PATH = `${folder}${path.delimiter}${before ?? ''}`
  return () => {
    if (before === undefined) Reflect.deleteProperty(process.env, 'PATH')
    else process.env.PATH = before
  }
}
