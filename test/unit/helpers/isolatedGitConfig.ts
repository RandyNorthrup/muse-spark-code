// Real-git tests must not read the machine's Git configuration: a filter,
// alias, signing or LFS setting on the machine would change the result (a
// global LFS filter hid REVIEWEXIT's exit-code defect on every machine that
// ran these tests). The child environment points Git's own global and system
// configuration at empty files the test owns, so only the repository-local
// configuration a test writes itself can matter.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface IsolatedGitConfig {
  /** The test-owned file Git reads as its global configuration. */
  readonly globalFile: string
  /** The test-owned file Git reads as its system configuration. */
  readonly systemFile: string
  /** Overlay for a git child's environment (or a runner's `env` option). */
  readonly env: NodeJS.ProcessEnv
  /** Removes the files the test owned. */
  readonly dispose: () => Promise<void>
}

/** Empty global and system Git configuration files, owned by the test. */
export function isolatedGitConfig(): IsolatedGitConfig {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-git-config-'))
  const globalFile = path.join(folder, 'global')
  const systemFile = path.join(folder, 'system')
  writeFileSync(globalFile, '')
  writeFileSync(systemFile, '')
  return {
    globalFile,
    systemFile,
    env: {
      GIT_CONFIG_GLOBAL: globalFile,
      GIT_CONFIG_SYSTEM: systemFile,
      GIT_CONFIG_NOSYSTEM: '1',
    },
    dispose: () => rm(folder, { recursive: true, force: true }),
  }
}
