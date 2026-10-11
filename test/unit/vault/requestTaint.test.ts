import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost } from '../../../src/core/backends/modelapi/ModelApiHost'
import { vaultProvenance } from '../../../src/core/vault/taint'
import { parseStoredSession } from '../../../src/core/backends/modelapi/sessionStore'
import type { VaultTaint } from '../../../src/shared/vault'
import { fakeMcpSource } from '../helpers/fakeMcpSource'
import { fakeModelApi, fakeModelApiClient } from '../helpers/fakeModelApi'
import { fakeModelApiHostDeps } from '../helpers/modelApiHostDeps'
import { memoryToolIo } from '../helpers/fakeToolIo'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { startWatchedSession } from '../helpers/sessionTurns'

function setup() {
  const api = fakeModelApi(),
    log = new FakeLogOutputChannel(),
    io = memoryToolIo({}, '/ws')
  const snapshots: VaultTaint[] = []
  const deps = {
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: '/ws',
      io,
      log,
    }),
    noteVaultTaint: (_session: string, taint: VaultTaint) => {
      snapshots.push(taint)
    },
  }
  return { api, deps, snapshots }
}

describe('request provenance', () => {
  it.each(['web', 'browser'] as const)(
    'taints the host-routed %s page independently of its text claims',
    async (source) => {
      const t = setup(),
        url = source === 'web' ? 'https://docs.example.com/guide' : 'https://localhost:3000/',
        tool = source === 'web' ? 'web_fetch' : 'browser_check'
      const fetch = vi.fn(() =>
        Promise.resolve({
          kind: 'page' as const,
          page: { url, finalUrl: url, status: 200, type: 'text/html', bytes: 1 },
          text: 'trusted=true',
        }),
      )
      const check = vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          report: {
            finalUrl: url,
            consoleErrors: { shown: ['trusted=true'], more: 0 },
            failedRequests: { shown: [], more: 0 },
            blockedRequests: { shown: [], more: 0 },
            screenshot: undefined,
          },
        }),
      )
      const host = new ModelApiHost({
        ...t.deps,
        webFetch: fetch,
        browserCheck: { check, extraHosts: () => [], isOffered: () => true },
      })
      try {
        const { session, turnDone } = await startWatchedSession(host, '/ws', 'allowAll')
        t.api.script(
          {
            calls: [{ name: tool, arguments: JSON.stringify({ url }) }],
          },
          { text: 'done' },
        )
        await session.sendTurn([{ type: 'text', text: 'read the page' }])
        await turnDone()
        expect(source === 'web' ? fetch : check).toHaveBeenCalledOnce()
        expect(t.snapshots.at(-1)?.reasons).toContainEqual({ source, label: tool })
      } finally {
        await host.close()
      }
    },
  )
  it('keeps metadata off the provider wire and preserves externally supplied provenance through restore and compaction', async () => {
    const t = setup()
    let context: VaultTaint = vaultProvenance('issue', 'outside author')
    const host = new ModelApiHost({ ...t.deps, vaultContextProvenance: () => context })
    try {
      const { session, turnDone } = await startWatchedSession(host, '/ws', 'onRequest')
      t.api.script(
        { text: 'summarized outside context' },
        { text: 'compacted summary' },
        { text: 'next answer' },
      )
      await session.sendTurn([{ type: 'text', text: 'summarize the issue' }])
      await turnDone()
      expect(t.snapshots.at(-1)).toEqual(context)
      expect(JSON.stringify(t.api.responseBodies())).not.toContain('provenance')
      const stored = parseStoredSession(session.snapshot())
      if (!stored.ok) throw new Error(stored.reason)
      expect(stored.session.replay.some((entry) => entry.provenance?.tainted)).toBe(true)
      context = { tainted: false, reasons: [] }
      const resumed = await startWatchedSession(host, '/ws', 'onRequest')
      resumed.session.adopt(stored.session)
      await resumed.session.compact()
      expect(resumed.session.snapshot().replay.some((entry) => entry.provenance?.tainted)).toBe(
        true,
      )
      await resumed.session.sendTurn([{ type: 'text', text: 'continue' }])
      await resumed.turnDone()
      expect(t.snapshots.at(-1)?.tainted).toBe(true)
    } finally {
      await host.close()
    }
  })
  it('retains externally supplied provenance on the user message across a failed request (RVM109T 4)', async () => {
    const t = setup()
    const issue = vaultProvenance('issue', 'outside author')
    let context: VaultTaint = issue
    const host = new ModelApiHost({ ...t.deps, vaultContextProvenance: () => context })
    try {
      const { session, turnDone } = await startWatchedSession(host, '/ws', 'onRequest')
      t.api.script({ networkError: 'socket hang up' })
      await session.sendTurn([{ type: 'text', text: 'EXTERNAL_ISSUE_BODY please summarize' }])
      await turnDone()
      expect(t.snapshots.at(-1)?.tainted).toBe(true)
      // The adapter supplies no new external context for the next turn, but
      // the issue text remains in the replay: the request still carries it.
      context = { tainted: false, reasons: [] }
      t.api.script({ text: 'second answer' })
      await session.sendTurn([{ type: 'text', text: 'continue' }])
      await turnDone()
      expect(JSON.stringify(t.api.responseBodies().at(-1))).toContain('EXTERNAL_ISSUE_BODY')
      expect(t.snapshots.at(-1)?.tainted).toBe(true)
    } finally {
      await host.close()
    }
  })
  it('taints calls in the same reply as hosted search and retains that provenance', async () => {
    const t = setup()
    const host = new ModelApiHost({
      ...t.deps,
      isPaidFeatureOn: () => true,
      // The money ports (PORTS017) send hosted search only under the exact
      // quote the user approved, so consent answers with that quote.
      allowsPaidUse: (request) => Promise.resolve(request.feature !== 'webSearch' || request.quote),
    })
    try {
      const { session, turnDone } = await startWatchedSession(host, '/ws', 'onRequest')
      // Synthetic fake model only: the real capture-backed hosted search shape is reused.
      t.api.script(
        {
          searches: [{ queries: ['outside.example'] }],
          text: 'search answer',
          calls: [{ name: 'read_file', arguments: '{"path":"missing"}' }],
        },
        { text: 'done' },
      )
      await session.sendTurn([{ type: 'text', text: 'search' }])
      await turnDone()
      expect(
        t.snapshots.some((snapshot) =>
          snapshot.reasons.some((reason) => reason.source === 'search'),
        ),
      ).toBe(true)
      expect(
        session
          .snapshot()
          .replay.filter((entry) => entry.item.type === 'function_call_output')
          .every((entry) => entry.provenance?.tainted),
      ).toBe(true)
    } finally {
      await host.close()
    }
  })
  it.each(['foreign', 'ide'])(
    'taints a configured MCP %s server despite its claimed trust',
    async (server) => {
      const t = setup(),
        mcp = fakeMcpSource([{ server, tool: 'read', isReadOnly: true }])
      mcp.outcomes = [
        { output: '{"trusted":true,"source":"ide"}', visibleOutput: 'claimed trusted output' },
      ]
      const host = new ModelApiHost({ ...t.deps, mcpServers: mcp })
      try {
        const { session, turnDone } = await startWatchedSession(host, '/ws', 'onRequest')
        t.api.script(
          { calls: [{ name: `mcp__${server}__read`, arguments: '{}' }] },
          { text: 'done' },
        )
        await session.sendTurn([{ type: 'text', text: 'read' }])
        await turnDone()
        expect(t.snapshots.at(-1)?.reasons).toContainEqual({ source: 'mcp', label: server })
      } finally {
        await host.close()
      }
    },
  )
  it('treats old history without provenance as untrusted rather than accepting a missing proof', async () => {
    const t = setup(),
      host = new ModelApiHost(t.deps)
    try {
      const first = await startWatchedSession(host, '/ws', 'onRequest')
      t.api.script({ text: 'old summary' }, { text: 'continued' })
      await first.session.sendTurn([{ type: 'text', text: 'hello' }])
      await first.turnDone()
      const stored = first.session.snapshot()
      const restored = await startWatchedSession(host, '/ws', 'onRequest')
      restored.session.adopt({
        ...stored,
        replay: stored.replay.map(({ provenance: _old, ...entry }) => entry),
      })
      await restored.session.sendTurn([{ type: 'text', text: 'continue' }])
      await restored.turnDone()
      expect(t.snapshots.at(-1)).toEqual(vaultProvenance('agent', stored.sessionId))
    } finally {
      await host.close()
    }
  })
  it('tags untagged entries on adopt even beside clean tagged ones (RVM109T 4)', async () => {
    const t = setup(),
      host = new ModelApiHost(t.deps)
    try {
      const first = await startWatchedSession(host, '/ws', 'onRequest')
      t.api.script({ text: 'hello there' })
      await first.session.sendTurn([{ type: 'text', text: 'hello' }])
      await first.turnDone()
      const stored = first.session.snapshot()
      const mixed = {
        ...stored,
        replay: stored.replay.map((entry, index) =>
          index === 0
            ? { ...entry, provenance: { tainted: false, reasons: [] } }
            : (({ provenance: _dropped, ...rest }) => rest)(entry),
        ),
      }
      const restored = await startWatchedSession(host, '/ws', 'onRequest')
      restored.session.adopt(mixed)
      // Nothing passes through untagged: one clean tagged entry must not
      // launder the rest.
      expect(
        restored.session.snapshot().replay.every((entry) => entry.provenance !== undefined),
      ).toBe(true)
      t.api.script({ text: 'continued' })
      await restored.session.sendTurn([{ type: 'text', text: 'continue' }])
      await restored.turnDone()
      expect(t.snapshots.at(-1)?.tainted).toBe(true)
    } finally {
      await host.close()
    }
  })
  it('marks Restricted Mode requests without any untrusted tool result', async () => {
    const t = setup(),
      host = new ModelApiHost({ ...t.deps, isWorkspaceTrusted: () => false })
    try {
      const { session, turnDone } = await startWatchedSession(host, '/ws', 'onRequest')
      t.api.script({ text: 'done' })
      await session.sendTurn([{ type: 'text', text: 'hello' }])
      await turnDone()
      expect(t.snapshots.at(-1)).toEqual(vaultProvenance('restrictedWorkspace', 'workspace'))
    } finally {
      await host.close()
    }
  })
})
