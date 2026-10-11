import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../test/harness/buildTraffic.mjs', () => ({
  buildTrafficHarness: () => Promise.resolve(),
}))

it('builds schedules from the historical source root into the directory that its server serves', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cifixv-schedules-'))
  let server
  try {
    await mkdir(path.join(root, 'src/webview/schedules'), { recursive: true })
    await mkdir(path.join(root, 'test/harness'), { recursive: true })
    await writeFile(
      path.join(root, 'src/webview/schedules/ScheduleSurface.tsx'),
      "export const sourceRevision = 'historical-schedule-source'",
    )
    await writeFile(
      path.join(root, 'test/harness/schedules.mjs'),
      "export * from '../../temp/m115-v/surface/ScheduleSurface.js'",
    )
    const serving = await serveRepo(root)
    server = serving.server
    const origin = `http://127.0.0.1:${serving.port}`
    const entry = await fetch(`${origin}/test/harness/schedules.mjs`)
    expect(entry.status).toBe(200)
    const response = await fetch(`${origin}/temp/m115-v/surface/ScheduleSurface.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript')
    expect(await response.text()).toContain('historical-schedule-source')
  } finally {
    if (server !== undefined)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    await removeFolder(root)
  }
})

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
