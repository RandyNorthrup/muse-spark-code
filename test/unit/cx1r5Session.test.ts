import * as acp from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { runtimeProvidersFile } from '../../src/runtime/providers/providersFileStore'
import { AcpPaidUse } from '../../src/acp/paid'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { openHandshakeSession, until } from './helpers/acpWaits'

const folders: string[] = []
function fail(): never {
  throw new Error('optional owner failed')
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

async function turnWith(accounts: AcpAgentDeps['accounts'], schedules?: AcpAgentDeps['schedules']) {
  const host = new FakeAgentHost()
  host.info = { ...host.info, kind: 'modelApi' }
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const agent = createAcpAgent({
    ...(accounts !== undefined && { accounts }),
    ...(schedules !== undefined && { schedules }),
    questions: 'decline',
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: { id: 'test', name: 'Test', description: 'Test', args: [], command: 'test' },
    defaultCwd: process.cwd(),
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
  })
  const updates: acp.SessionUpdate[] = []
  const client = acp.client({ name: 'cx1r5' }).onNotification('session/update', ({ params }) => {
    updates.push(params.update)
  })
  await client.connectWith(agent, async (connection) => {
    const { sessionId } = await openHandshakeSession(connection, process.cwd())
    expect(sessionId).toBe('session-1')
    const session = host.sessions[0]
    if (session === undefined) throw new Error('session missing')
    expect(session.dispose).not.toHaveBeenCalled()
    const response = connection.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
    })
    await until(() => session.sendTurn.mock.calls.length === 1)
    session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
    expect(await response).toEqual({ stopReason: 'end_turn' })
    expect(session.dispose).not.toHaveBeenCalled()
  })
  return { log, updates }
}

function servicesAt(dataDir: string) {
  const openEntry = vi.fn(() => {
    throw new Error('credentials must remain closed')
  })
  return { services: createRuntimeAccountServices({ dataDir, openEntry }), openEntry }
}

describe('CX1R5 F1: optional integrations cannot break ordinary ACP sessions', () => {
  it('omits the account binding on an absent data path and runs a turn', async () => {
    const dataDir = path.join(tmpdir(), `cx1r5-absent-${randomUUID()}`)
    const { services, openEntry } = servicesAt(dataDir)
    try {
      const accounts = await services.sessionsIfPresent('meta')
      expect(accounts).toBeUndefined()
      await turnWith(accounts)
      expect(existsSync(dataDir)).toBe(false)
      expect(openEntry).not.toHaveBeenCalled()
    } finally {
      services.dispose()
    }
  })

  it('runs a turn with real account metadata and preserves account controls', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'cx1r5-present-'))
    folders.push(dataDir)
    writeFileSync(
      runtimeProvidersFile(dataDir),
      JSON.stringify({
        providers: {
          meta: {
            id: 'meta',
            policyProvider: 'meta',
            product: 'model-api',
            auth: 'apiKey',
            origin: 'https://api.meta.ai',
          },
        },
      }),
    )
    const { services, openEntry } = servicesAt(dataDir)
    try {
      const accounts = await services.sessionsIfPresent('meta')
      expect(accounts).toBeDefined()
      const { updates } = await turnWith(accounts)
      expect(JSON.stringify(updates)).toContain('"name":"accounts"')
      expect(openEntry).not.toHaveBeenCalled()
    } finally {
      services.dispose()
    }
  })

  it('contains an unavailable production account refresh and removes its controls', async () => {
    const dataDir = path.join(tmpdir(), `cx1r5-absent-${randomUUID()}`)
    const { services, openEntry } = servicesAt(dataDir)
    try {
      const { log, updates } = await turnWith(services.sessions('meta'))
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('accounts startup failed'))
      expect(JSON.stringify(updates)).not.toContain('"name":"accounts"')
      expect(existsSync(dataDir)).toBe(false)
      expect(openEntry).not.toHaveBeenCalled()
    } finally {
      services.dispose()
    }
  })

  it('contains account subscription and cleanup failures and schedule startup failures', async () => {
    const { log } = await turnWith(
      { read: fail, use: fail, subscribe: () => fail, usageUrl: fail },
      {
        run: fail,
        holdWorkspace: fail,
      },
    )
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('accounts cleanup failed'))
    expect(log.warn).toHaveBeenCalledWith('ACP schedule workspace startup failed')
  })
})
