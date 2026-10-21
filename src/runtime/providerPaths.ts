import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { providerConfigFilePath } from '../core/credentialPaths'

/** Where the runner's own user file lives (D74: beside, never inside, Muse Code's config folder). */
export function providersFilePath(input: {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
}): string {
  // One implementation: the credential lease derives its lock directory
  // from this same file, so both sides resolve it identically.
  return providerConfigFilePath(input)
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
