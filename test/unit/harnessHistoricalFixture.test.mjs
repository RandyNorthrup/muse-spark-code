import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../test/harness/buildTraffic.mjs', () => ({
  buildTrafficHarness: () => Promise.resolve(),
}))

it('serves current usage fixture bytes when a historical renderer predates that fixture', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'left017-historical-'))
  let server
  try {
    const serving = await serveRepo(root)
    server = serving.server
    const response = await fetch(`http://127.0.0.1:${serving.port}/usage-harness.js`)
    expect(response.status).toBe(200)
    const source = await response.text()
    expect(source).toContain('museUsageHarness')
    expect(source).toContain('usageStateFor')
    expect(source).toContain('history-off')
  } finally {
    if (server !== undefined)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    await removeFolder(root)
  }
})
