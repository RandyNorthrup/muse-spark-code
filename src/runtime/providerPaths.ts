import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import path from 'node:path'
import { PROVIDERS_CONFIG_DIR_NAME, PROVIDERS_FILE_NAME } from '../shared/constants'

/** Where the runner's own user file lives (D74: beside, never inside, Muse Code's config folder). */
export function providersFilePath(input: {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
}): string {
  const base = path.join(
    input.xdgConfigHome ?? path.join(input.homeDir, '.config'),
    PROVIDERS_CONFIG_DIR_NAME,
  )
  // Windows joins with `\`; join keeps one dialect per platform, as the
  // skill and memory roots do.
  return path.join(base, PROVIDERS_FILE_NAME)
}

/** DNS answers for an endpoint name; an IP literal is its own answer. */
export async function resolveEndpointHost(hostname: string): Promise<readonly string[]> {
  if (isIP(hostname) !== 0) {
    return [hostname]
  }
  try {
    const answers = await lookup(hostname, { all: true })
    return answers.map((answer) => answer.address)
  } catch {
    return []
  }
}
