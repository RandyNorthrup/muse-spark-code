// The credential lease's paths (M95, PLAN.md D74): the lease directory
// beside a providers file and the runner's own providers file. Pure path
// joins, so synchronous callers (the terminal's file resolution) keep a
// static import while the lease machinery itself loads lazily.
import path from 'node:path'
import { PROVIDERS_CONFIG_DIR_NAME, PROVIDERS_FILE_NAME } from '../shared/constants'

/** The lease directory beside a providers file. */
export function credentialLockDir(providersFilePath: string): string {
  return `${providersFilePath}.lock`
}

/**
Where the runner's own providers file lives (beside, never inside, Muse
Code's config folder). Windows joins with `\`; join keeps one dialect per
platform. Both the terminal and the panel derive the same lease directory
from it, so the one credential lease excludes writers on either side.
*/
export function providerConfigFilePath(input: {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
}): string {
  const base = path.join(
    input.xdgConfigHome ?? path.join(input.homeDir, '.config'),
    PROVIDERS_CONFIG_DIR_NAME,
  )
  return path.join(base, PROVIDERS_FILE_NAME)
}
