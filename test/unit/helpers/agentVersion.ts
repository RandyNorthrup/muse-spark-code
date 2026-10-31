// The agent's own version, read as the product reads it: the manifest's version.
import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'

export function agentVersion(manifestUrl: URL): string {
  return z.object({ version: z.string() }).parse(JSON.parse(readFileSync(manifestUrl, 'utf8')))
    .version
}
