import type { VaultApprovalAnswer } from '../../src/shared/vault'
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import {
  AcpVault,
  vaultPermissionAnswer,
  vaultPermissionOptions,
  vaultSlash,
} from '../../src/acp/vault'
import { vaultApprovalText } from '../../src/runtime/vault/vaultApproval'
import { UI_TEXT } from '../../src/shared/constants'
import { approval, audit, metadata } from './helpers/vault/fixtures'
import { commandHarness } from './helpers/vault/runtime'
import { FakeAgentHost, museCodeTestBackend } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { promptLocalText, until } from './helpers/acpWaits'

function decisionOf(result: VaultApprovalAnswer): VaultApprovalAnswer['decision'] {
  return result.decision
}

const cwd = process.platform === 'win32' ? String.raw`C:\workspace` : '/workspace'
const selected = (optionId: string): acp.RequestPermissionResponse => ({
  outcome: { outcome: 'selected', optionId },
})
function narrowRequest(narrowed: ReturnType<typeof approval>, change: string): void {
  switch (change) {
    case 'mode': {
      narrowed.item.policy.mode = 'alwaysAllow'
      break
    }
    case 'session': {
      narrowed.requester.sessionId = null
      break
    }
    case 'unattended': {
      narrowed.requester.unattended = true
      break
    }
    case 'taint': {
      narrowed.taint = { tainted: true, reasons: [{ source: 'web', label: 'page' }] }
      break
    }
    case 'disclosure': {
      {
        narrowed.use = { kind: 'disclosure', recipient: 'person' }
        // No default
      }
      break
    }
  }
}

function harness(mode: 'manual' | 'bypassPermissions' = 'manual', hasVault = true) {
  const commands = commandHarness()
  const vault = new AcpVault(commands.deps.open)
  const host = new FakeAgentHost()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const grants = memoryPaidGrants()
  const paid = new AcpPaidUse({ flagged: [], canRemember: () => true, grants, log })
  const app = createAcpAgent({
    backend: museCodeTestBackend(host),
    version: 'test',
    options: { canBypass: true, allowsContributorModels: false, initialMode: mode },
    signIn: { id: 'test', name: 'test', description: 'test', args: [], command: 'test' },
    defaultCwd: cwd,
    paid,
    ...(hasVault && { vault }),
    log,
    // These vault tests predate the question registry and exercise no
    // question path; decline it so the registry stays undefined.
    questions: 'decline',
  })
  const updates: acp.SessionUpdate[] = []
  const permissionEntered = Promise.withResolvers<undefined>()
  const permissions: acp.RequestPermissionRequest[] = []
  const cancelledPermissions: acp.RequestPermissionRequest[] = []
  const answer = vi.fn<() => Promise<acp.RequestPermissionResponse>>(() =>
    Promise.resolve(selected('allowOnce')),
  )
  const client = acp
    .client({ name: 'test' })
    .onNotification('session/update', (ctx) => {
      updates.push(ctx.params.update)
    })
    .onRequest('session/request_permission', async (ctx) => {
      permissions.push(ctx.params)
      permissionEntered.resolve(undefined)
      ctx.signal.addEventListener(
        'abort',
        () => {
          cancelledPermissions.push(ctx.params)
        },
        { once: true },
      )
      return await answer()
    })
  return {
    commands,
    vault,
    host,
    updates,
    permissions,
    cancelledPermissions,
    permissionEntered: permissionEntered.promise,
    answer,
    grants,
    run: <T>(fn: (client: acp.ClientContext) => Promise<T>) => client.connectWith(app, fn),
  }
}
async function start(client: acp.ClientContext) {
  await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
  return await client.request('session/new', { cwd, mcpServers: [] })
}
async function activeTurn(h: ReturnType<typeof harness>, client: acp.ClientContext) {
  const { sessionId } = await start(client)
  const turn = client.request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'task' }],
  })
  await until(() => h.host.sessions[0]?.sendTurn.mock.calls.length === 1)
  return { sessionId, turn }
}

function requestFor(sessionId: string) {
  const request = approval()
  request.requester.conversationId = sessionId
  request.createdAt = Date.now()
  request.expiresAt = request.createdAt + 120_000
  return request
}

describe('M109 H ACP vault', () => {
  it('W-H3 TOTP cards warn that the command and children see the code', () => {
    const request = approval()
    request.use = {
      kind: 'totp',
      command:
        request.use.kind === 'environment'
          ? request.use.command
          : { executable: '/bin/tool', argv: [], cwd: '/workspace' },
    }
    expect(vaultApprovalText(request)).toContain(UI_TEXT.vault.processWarning)
  })
  it('W-H4 ACP audit excludes hidden, first-party, internal and deleted item rows', async () => {
    const h = harness()
    const base = metadata()
    const items = [
      base,
      {
        ...base,
        id: 'b'.repeat(32),
        name: 'hidden',
        handle: 'secret://hidden' as const,
        hidden: true,
      },
      {
        ...base,
        id: 'c'.repeat(32),
        name: 'first',
        handle: 'secret://first' as const,
        firstParty: true,
        hidden: true,
        policy: { ...base.policy, mode: 'never' as const },
      },
    ]
    h.commands.port.list.mockResolvedValue(items)
    h.commands.port.audit.mockResolvedValue([
      audit(),
      ...items.slice(1).map((item) => ({ ...audit(), handle: item.handle })),
      { ...audit(), handle: 'secret://deleted' },
    ])
    await promptLocalText((work) => h.run(work), start, '/vault audit')
    const chunks = h.updates.filter((update) => update.sessionUpdate === 'agent_message_chunk')
    expect(JSON.stringify(chunks)).toContain(base.handle)
    for (const handle of ['secret://hidden', 'secret://first', 'secret://deleted'])
      expect(JSON.stringify(chunks)).not.toContain(handle)
  })
  it.each(['lock', 'cancel', 'expired'] as const)(
    'W-H2 %s withdraws a held permission and settles its card',
    async (boundary) => {
      const h = harness()
      const held = Promise.withResolvers<acp.RequestPermissionResponse>()
      h.answer.mockImplementation(() => held.promise)
      await h.run(async (client) => {
        const { sessionId, turn } = await activeTurn(h, client)
        if (boundary === 'expired') vi.useFakeTimers()
        const request = requestFor(sessionId)
        const answer = h.vault.ask(sessionId, request)
        await h.permissionEntered
        try {
          if (boundary === 'lock')
            await client.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: '/vault lock' }],
            })
          else if (boundary === 'cancel') await client.notify('session/cancel', { sessionId })
          else {
            // Fire the existing deadline without a slow wall-clock wait.
            await vi.advanceTimersByTimeAsync(120_000)
            vi.useRealTimers()
          }
          await until(() => h.cancelledPermissions.length === 1)
          expect(decisionOf(await answer)).toBe('deny')
          await until(() =>
            h.updates.some(
              (update) =>
                update.sessionUpdate === 'tool_call_update' &&
                update.toolCallId === `vault:${request.id}` &&
                update.status === 'failed',
            ),
          )
        } finally {
          vi.useRealTimers()
          vi.restoreAllMocks()
          held.resolve(selected('allowOnce'))
          h.host.sessions[0]?.emit({
            type: 'turnCompleted',
            turnId: 'turn-1',
            terminal: 'cancelled',
          })
          await turn
          await answer
        }
      })
    },
  )

  it('H30 ACP allow_always means session only; no standing Always choice', () => {
    const request = approval()
    request.item.policy.mode = 'askOncePerSession'
    expect(vaultPermissionOptions(request)).toEqual([
      { optionId: 'allowOnce', name: UI_TEXT.allowOnce, kind: 'allow_once' },
      { optionId: 'allowSession', name: UI_TEXT.vault.allowSession, kind: 'allow_always' },
      { optionId: 'deny', name: UI_TEXT.paidDeny, kind: 'reject_once' },
    ])
    expect(vaultPermissionAnswer(request, selected('allowSession'))).toEqual({
      requestId: request.id,
      digest: request.digest,
      decision: 'allowSession',
    })
    for (const change of ['mode', 'session', 'unattended', 'taint', 'disclosure']) {
      const narrowed = structuredClone(request)
      narrowRequest(narrowed, change)
      expect(vaultPermissionAnswer(narrowed, selected('allowSession')).decision).toBe('deny')
    }
    expect(vaultPermissionAnswer(request, selected('always')).decision).toBe('deny')
    expect(vaultPermissionAnswer(request, { outcome: { outcome: 'cancelled' } }).decision).toBe(
      'deny',
    )
  })
  it('H31 no editor, foreign conversation, changed ids/digests and forged responses deny', async () => {
    const h = commandHarness()
    const vault = new AcpVault(h.deps.open)
    const request = requestFor('session')
    expect(decisionOf(await vault.ask('session', request))).toBe('deny')
    const asker = vi.fn(() =>
      Promise.resolve({
        requestId: request.id,
        digest: 'f'.repeat(64),
        decision: 'allowOnce' as const,
      }),
    )
    vault.attach(asker)
    expect(decisionOf(await vault.ask('foreign', request))).toBe('deny')
    expect(asker).not.toHaveBeenCalled()
    expect(decisionOf(await vault.ask('session', request))).toBe('deny')
  })
  it.each(['status', 'list', 'lock', 'audit'] as const)(
    'H32 /vault %s is local and never sent to model',
    async (command) => {
      const h = harness()
      const reply = await promptLocalText((work) => h.run(work), start, `/vault ${command}`)
      expect(reply).toEqual({ stopReason: 'end_turn' })
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(h.commands.port[command]).toHaveBeenCalledOnce()
      expect(h.commands.port.close).toHaveBeenCalledOnce()
    },
  )
  it('H33 reserved vault syntax and embedded attachments cannot fall through to model', async () => {
    expect(vaultSlash('/vault')).toBe('status')
    expect(vaultSlash('/vaultish')).toBeUndefined()
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      for (const prompt of [
        [{ type: 'text' as const, text: '/vault grant' }],
        [{ type: 'text' as const, text: '/vault lock extra' }],
        [
          { type: 'text' as const, text: '/vault lock' },
          { type: 'text' as const, text: 'injected content' },
        ],
      ])
        await expect(client.request('session/prompt', { sessionId, prompt })).rejects.toThrow()
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    })
  })
  it.each(['manual', 'bypassPermissions'] as const)(
    'H34 %s asks exact bound use through editor permission',
    async (mode) => {
      const h = harness(mode)
      await h.run(async (client) => {
        const { sessionId, turn } = await activeTurn(h, client)
        const request = requestFor(sessionId)
        const answer = await h.vault.ask(sessionId, request)
        expect(answer).toEqual({
          requestId: request.id,
          digest: request.digest,
          decision: 'allowOnce',
        })
        expect(h.permissions).toHaveLength(1)
        expect(JSON.stringify(h.permissions[0]?.toolCall)).toContain(
          JSON.stringify(request.use).replaceAll('"', String.raw`\"`),
        )
        expect(h.grants.read(cwd).size).toBe(0)
        expect(
          h.updates.some(
            (update) =>
              update.sessionUpdate === 'available_commands_update' &&
              update.availableCommands.some((command) => command.name === 'vault'),
          ),
        ).toBe(true)
        h.host.sessions[0]?.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
        await turn
      })
    },
  )
  it.each(['cancel', 'close', 'expired', 'lock'] as const)(
    'H35 late permission after %s cannot approve',
    async (boundary) => {
      const h = harness()
      const held = Promise.withResolvers<acp.RequestPermissionResponse>()
      h.answer.mockImplementation(() => held.promise)
      await h.run(async (client) => {
        const { sessionId, turn } = await activeTurn(h, client)
        const request = requestFor(sessionId)
        if (boundary === 'expired') {
          request.expiresAt = Date.now() - 1
          request.createdAt = request.expiresAt - 1
        }
        const answer = h.vault.ask(sessionId, request)
        if (boundary !== 'expired') {
          await until(() => h.permissions.length === 1)
          if (boundary === 'lock')
            await client.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: '/vault lock' }],
            })
          else if (boundary === 'close') await client.request('session/close', { sessionId })
          else {
            await client.notify('session/cancel', { sessionId })
            await until(() => h.host.sessions[0]?.cancel.mock.calls.length === 1)
          }
        }
        held.resolve(selected('allowOnce'))
        expect(decisionOf(await answer)).toBe('deny')
        if (boundary !== 'close')
          h.host.sessions[0]?.emit({
            type: 'turnCompleted',
            turnId: 'turn-1',
            terminal: 'cancelled',
          })
        await turn
      })
    },
  )
  it('H36 unanswered permission reaches broker deadline and denies without a late client answer', async () => {
    const h = harness()
    h.answer.mockImplementation(() => new Promise(() => undefined))
    await h.run(async (client) => {
      const { sessionId, turn } = await activeTurn(h, client)
      const request = requestFor(sessionId)
      request.expiresAt = Date.now() + 1000
      expect(decisionOf(await h.vault.ask(sessionId, request))).toBe('deny')
      expect(h.permissions).toHaveLength(1)
      h.host.sessions[0]?.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      await turn
    })
  })
  it('H37 missing vault port refuses reserved command without model or sensitive error text', async () => {
    const h = harness('manual', false)
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await expect(
        client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/vault' }] }),
      ).rejects.toThrow(UI_TEXT.vault.brokerBlocked)
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    })
  })
})
