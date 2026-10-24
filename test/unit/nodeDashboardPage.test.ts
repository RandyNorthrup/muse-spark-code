// The node dashboard methods (src/runtime/node/web/dashboard.ts): reads
// assemble the service's state with the machine's readings, and the audit
// pages newest-first over the real hash-chained store. Port inputs (sessions,
// readings) are parameters; the store, the paging and the schema's cross-field
// refinement are real. The store runs natively on Linux or WSL only; on
// Windows each case proves the store's refusal in words (nodeNativeTest).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect } from 'vitest'
import {
  NODE_MAX_PAGE_ITEMS,
  NODE_PROTOCOL_VERSION,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
} from '../../src/shared/constants'
import type { NodeAudit } from '../../src/shared/node'
import type { NodeSession } from '../../src/shared/nodeAuth'
import { initializedPageStore, pageRefusal } from './helpers/node/pageMethods'
import { nodeNativeTest } from './helpers/nodeNative'
import {
  createNodeDashboardMethods,
  type NodeDashboardPagePort,
} from '../../src/runtime/node/web/dashboard'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

function session(id: string): NodeSession {
  return {
    v: NODE_PROTOCOL_VERSION,
    id,
    ownerId: 'owner',
    surface: 'web',
    createdAt: 1000,
    lastSeenAt: 1000,
    idleExpiresAt: 1000 + NODE_SESSION_IDLE_MS,
    absoluteExpiresAt: 1000 + NODE_SESSION_MAX_MS,
  }
}

async function setup(overrides: Partial<NodeDashboardPagePort> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'node-dashboard-'))
  folders.push(root)
  const { store, initial } = await initializedPageStore(root)
  const reported: unknown[] = []
  const port: NodeDashboardPagePort = {
    nodeId: initial.nodeId,
    version: '0.19.0',
    startedAtMs: 500,
    now: () => 1500,
    sessions: () => Promise.resolve([session('a')]),
    locked: () => Promise.resolve(false),
    keyStoreSealed: () => Promise.resolve(true),
    pendingChallenges: () => Promise.resolve(0),
    readings: () =>
      Promise.resolve({
        cpuPercent: 12.5,
        memory: { usedBytes: 1000, totalBytes: 8000 },
        disk: { freeBytes: 6000, totalBytes: 8000 },
      }),
    workspaces: () => Promise.resolve([]),
    audit: () => Promise.resolve(store.audit()),
    report: (error: unknown) => {
      reported.push(error)
    },
    ...overrides,
  }
  return { store, methods: createNodeDashboardMethods(port), reported }
}

describe('node dashboard methods', () => {
  nodeNativeTest('reads the dashboard with attendance derived from sessions', async () => {
    const test = await setup()
    const signal = new AbortController().signal
    const dashboard = await test.methods.read({}, signal)
    expect(dashboard.uptimeMs).toBe(1000)
    expect(dashboard.sandbox).toBe('shared')
    expect(dashboard.attendance).toBe('attended')
    expect(dashboard.sessions.map((entry) => entry.id)).toEqual(['a'])
    expect(dashboard.cpuPercent).toBe(12.5)
    expect(dashboard.memory).toEqual({ usedBytes: 1000, totalBytes: 8000 })
    expect(test.reported).toEqual([])
  })

  nodeNativeTest('reads unattended with no sessions and stays sealed', async () => {
    const test = await setup({ sessions: () => Promise.resolve([]) })
    const signal = new AbortController().signal
    const dashboard = await test.methods.read({}, signal)
    expect(dashboard.attendance).toBe('unattended')
    expect(dashboard.keyStoreSealed).toBe(true)
  })

  nodeNativeTest(
    'refuses a locked node that still holds sessions as unavailable, and files it',
    async () => {
      const test = await setup({ locked: () => Promise.resolve(true) })
      const signal = new AbortController().signal
      const failed = await pageRefusal(test.methods.read({}, signal))
      expect(failed.code).toBe('unavailable')
      expect(test.reported).toHaveLength(1)
    },
  )

  nodeNativeTest('pages the audit newest-first over the real store', async () => {
    const test = await setup()
    const signal = new AbortController().signal
    const dashboard = await test.methods.read({}, signal)
    expect(dashboard.nodeId).toBe(test.store.read().nodeId)
    await test.store.append({
      time: 1100,
      sessionId: 'a',
      outcome: 'allowed',
      kind: 'signin',
      action: 'signin',
      credentialIdHash: '1'.repeat(64),
    })
    await test.store.append({
      time: 1200,
      sessionId: 'a',
      outcome: 'allowed',
      kind: 'signin',
      action: 'signout',
      credentialIdHash: '1'.repeat(64),
    })
    const first = await test.methods.list({ cursor: null }, signal)
    expect(first.entries.map((entry) => entry.seq)).toEqual([2, 1])
    expect(first.nextCursor).toBeNull()
    const second = await test.methods.list({ cursor: first.nextCursor }, signal)
    expect(second.entries.map((entry) => entry.seq)).toEqual([2, 1])
    const tail = await test.methods.list({ cursor: '1' }, signal)
    expect(tail.entries).toEqual([])
    expect(tail.nextCursor).toBeNull()
  })

  nodeNativeTest('walks a long trail page by page and restarts an unknown cursor', async () => {
    const generated: NodeAudit[] = []
    for (let seq = 1; seq <= NODE_MAX_PAGE_ITEMS + 2; seq += 1) {
      generated.push({
        v: NODE_PROTOCOL_VERSION,
        seq,
        time: 1000 + seq,
        nodeId: 'a'.repeat(64),
        sessionId: null,
        previousHash: 'b'.repeat(64),
        hash: 'c'.repeat(64),
        outcome: 'allowed',
        kind: 'node',
        action: 'stop',
      })
    }
    const test = await setup({ audit: () => Promise.resolve(generated) })
    const signal = new AbortController().signal
    const first = await test.methods.list({ cursor: null }, signal)
    expect(first.entries).toHaveLength(NODE_MAX_PAGE_ITEMS)
    expect(first.entries[0]?.seq).toBe(NODE_MAX_PAGE_ITEMS + 2)
    expect(first.nextCursor).toBe(String(3))
    const second = await test.methods.list({ cursor: first.nextCursor }, signal)
    expect(second.entries.map((entry) => entry.seq)).toEqual([2, 1])
    expect(second.nextCursor).toBeNull()
    const restarted = await test.methods.list({ cursor: 'forged' }, signal)
    expect(restarted.entries).toHaveLength(NODE_MAX_PAGE_ITEMS)
    expect(restarted.nextCursor).toBe(String(3))
  })
})
