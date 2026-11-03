// The real Muse Code CLI the product would run, found as the product
// finds it: shared by the suites that drive the real CLI (RLF-SHUTDOWN,
// RLF-EMPTYCAT). Answers the command, or why it is missing.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolveMuseLaunch } from '../../../src/core/backends/musecode/launch'
import { isRealMuseAsked, REAL_MUSE_VARIABLE } from './realMuse'

export function resolveInstalledMuse(options: {
  readonly localAppData: string | undefined
  readonly workspaceRoot: string
}): { readonly command: string } | { readonly missing: string } {
  if (!isRealMuseAsked()) return { missing: `this run did not set ${REAL_MUSE_VARIABLE}=1` }
  const found = resolveMuseLaunch({
    platform: process.platform,
    configuredPath: '',
    pathEntries: (process.env['PATH'] ?? '').split(path.delimiter).filter((entry) => entry !== ''),
    homeDir: homedir(),
    localAppData: options.localAppData,
    fileExists: (file) => existsSync(file),
    readTextFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    listDirectory: (folder) => (existsSync(folder) ? readdirSync(folder) : []),
    serveArgs: [],
    scope: { workspaceRoot: options.workspaceRoot, realpath: realpathSync },
  })
  return found.ok
    ? { command: found.launch.command }
    : { missing: 'no Muse Code CLI is installed on this machine' }
}
