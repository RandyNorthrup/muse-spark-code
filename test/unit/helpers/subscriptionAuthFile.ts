// The subscription auth file lands where the wrapper's own resolved path
// says. Shared so the duplication gate stays silent.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SubscriptionKeySource } from '../../../src/core/backends/modelapi/subscriptionKey'

export async function writeSubscriptionAuthFile(root: string, text: string): Promise<void> {
  const file = new SubscriptionKeySource({
    platform: 'linux',
    homeDir: '/none',
    xdgConfigHome: root,
  }).path()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}
