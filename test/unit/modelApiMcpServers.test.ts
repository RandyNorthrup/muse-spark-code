import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { McpServerPool, type McpToolSource } from '../../src/core/backends/modelapi/mcp/pool'
import { modelApiMcpPoolDeps } from '../../src/host/backend/mcpServers'
import { FakeLogOutputChannel } from './helpers/fakes'
import { FAKE_MCP_SERVER, fixtureJobLifecycle } from './helpers/mcpFixtures'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
const sources: McpToolSource[] = []
const jobState = fixtureJobLifecycle()

beforeAll(jobState.setup, 60_000)
afterAll(jobState.dispose)

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.close()))
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
}, 60_000)

function servers(settings: string | undefined, settingsPath?: string) {
  const folder = mkdtempSync(path.join(tmpdir(), 'mcp-settings-'))
  folders.push(folder)
  const file = settingsPath ?? path.join(folder, 'settings.json')
  if (settings !== undefined) {
    writeFileSync(file, settings)
  }
  const source = new McpServerPool(
    modelApiMcpPoolDeps({
      beforeWorkspaceProcessStart: () => Promise.resolve(),
      workspaceRoot: folder,
      settingsPath: () => file,
      isWorkspaceTrusted: () => true,
      clientVersion: '0.8.0',
      platform: process.platform,
      jobExecutablePath: jobState.path,
      env: () => ({ ...process.env, M50_MARK: 'from-env' }),
      fetch: globalThis.fetch.bind(globalThis),
      log: new FakeLogOutputChannel(),
    }),
  )
  sources.push(source)
  return { source, folder }
}

// Real child processes: on a loaded machine Node itself can take seconds to start.
describe('modelApiMcpPoolDeps (M50)', { timeout: 60_000 }, () => {
  it("starts the servers of Muse Code's settings file, ${VAR} from the host's environment", async () => {
    const { source } = servers(
      JSON.stringify({
        mcpServers: {
          fake: {
            command: process.execPath,
            args: [FAKE_MCP_SERVER],
            env: { MARK: '${M50_MARK}' },
          },
        },
      }),
    )
    await source.start()
    expect(source.snapshot().servers).toEqual([
      {
        name: 'fake',
        isRequired: true,
        state: { status: 'connected', toolCount: 9, unofferedCount: 0 },
      },
    ])
  })

  it('starts none without a settings file, and says so when the file cannot be read', async () => {
    const missing = servers(undefined)
    await missing.source.start()
    expect(missing.source.snapshot()).toEqual({ isStarted: true, fault: undefined, servers: [] })
    const folder = mkdtempSync(path.join(tmpdir(), 'mcp-settings-'))
    folders.push(folder)
    // A folder where the file should be: reading it fails.
    const unreadable = servers(undefined, folder)
    await unreadable.source.start()
    expect(unreadable.source.snapshot().fault).toMatchObject({ kind: 'unreadable' })
  })
})
