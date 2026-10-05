import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
// M91 lane H: the `mcp_tool` hook handler (PLAN.md D70). A tool on a
// configured MCP server, through that tool's own approval path: the policy
// judgement, the trust check and the approval card are the tool's own. A
// helper call fires no hook and skips the Auto reviewer, so a hook can never
// approve or review itself into a loop. Its answer parses like a command's.

import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type { HookDefinition } from '../../src/core/backends/modelapi/hooks'
import { runMcpToolHandler, type HookMcpCall } from '../../src/core/backends/modelapi/hookHandlers'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { memoryToolIo } from './helpers/fakeToolIo'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'

function parseAnswer(stdout: string) {
  return stdout === '{"decision":"block","reason":"no"}'
    ? { status: 'blocked' as const, reason: 'no' }
    : { status: 'completed' as const, context: stdout === '{}' ? undefined : stdout }
}

function config(): {
  type: 'mcp_tool'
  event: string
  source: 'user'
  mcpServer: string
  mcpTool: string
} {
  return {
    type: 'mcp_tool',
    event: 'PreToolUse',
    source: 'user',
    mcpServer: 'docs',
    mcpTool: 'lookup',
  }
}

function hook(event: 'PreToolUse' | 'PermissionRequest'): HookDefinition {
  return {
    event,
    source: 'user',
    type: 'mcp_tool',
    command: '',
    mcpServer: 'docs',
    mcpTool: 'lookup',
    timeoutSeconds: 5,
    matcher: { kind: 'exact', names: new Set(['mcp__docs__lookup']) },
    isAsync: false,
  }
}

function setupHost(hooks: readonly HookDefinition[]) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, ROOT)
  const mcp = fakeMcpSource([{ server: 'docs', tool: 'lookup' }])
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client: fakeModelApiClient(api, log), workspaceRoot: ROOT, io, log }),
    mcpServers: mcp,
    loadHooks: () => Promise.resolve(hooks),
    isHooksEnabled: () => true,
  })
  return { api, host, mcp }
}

async function start(
  t: ReturnType<typeof setupHost>,
  approvalMode: 'promptUnmatched' | 'allowAll',
) {
  const session = await t.host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode,
  })
  const watched = watchSessionTurns(session)
  t.api.script(
    { calls: [{ name: 'mcp__docs__lookup', arguments: '{"q":"x"}', callId: 'c1' }] },
    { text: 'done' },
  )
  await session.sendTurn([{ type: 'text', text: 'look it up' }])
  return { session, ...watched }
}

async function approvalRequest(
  events: readonly AgentEvent[],
  index: number,
): Promise<Extract<AgentEvent, { type: 'approvalRequested' }>> {
  return await vi.waitFor(() => {
    const request = events.filter((event) => event.type === 'approvalRequested')[index]
    if (request === undefined) throw new Error('MCP approval is still pending')
    return request
  })
}

const parse = (_event: string, exit: number | null, stdout: string, _stderr: string) =>
  exit === 0 && stdout !== 'bad input'
    ? { status: 'completed' as const, context: stdout === '{}' ? undefined : stdout }
    : { status: 'failed' as const }

const throwing: HookMcpCall = () => {
  return Promise.reject(new Error('down'))
}

describe('mcp_tool handler runs (M91 D70)', () => {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/ws' })

  it('calls the tool with the event payload and parses its answer', async () => {
    const call = vi.fn<HookMcpCall>(() =>
      Promise.resolve({
        kind: 'called',
        text: '{"decision":"block","reason":"no"}',
        isError: false,
      }),
    )
    const warn = vi.fn()
    const answer = await runMcpToolHandler(
      config(),
      payload,
      call,
      new AbortController().signal,
      warn,
      (_event, _exit, stdout) => parseAnswer(stdout),
    )
    expect(call).toHaveBeenCalledWith('docs', 'lookup', payload, expect.any(AbortSignal))
    expect(answer).toMatchObject({ status: 'blocked', reason: 'no' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails a tool error like a nonzero exit, and refuses missing or denied tools', async () => {
    const warn = vi.fn()
    const signal = new AbortController().signal
    const errored = await runMcpToolHandler(
      config(),
      payload,
      () => Promise.resolve({ kind: 'called', text: 'bad input', isError: true }),
      signal,
      warn,
      parse,
    )
    expect(errored.status).toBe('failed')

    const missing = await runMcpToolHandler(
      config(),
      payload,
      () => Promise.resolve({ kind: 'missing' }),
      signal,
      warn,
      parse,
    )
    expect(missing.status).toBe('failed')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('docs/lookup'))
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(UI_TEXT.hookMcpToolMissing.slice(0, 20)),
    )

    const denied = await runMcpToolHandler(
      config(),
      payload,
      () => Promise.resolve({ kind: 'denied' }),
      signal,
      warn,
      parse,
    )
    expect(denied.status).toBe('failed')

    expect(await runMcpToolHandler(config(), payload, throwing, signal, warn, parse)).toMatchObject(
      { status: 'failed' },
    )

    const controller = new AbortController()
    controller.abort()
    await expect(
      runMcpToolHandler(config(), payload, throwing, controller.signal, warn, parse),
    ).rejects.toThrow('down')
  })
})

describe('mcp_tool through the tool approval path (M91 D70)', () => {
  it('denial on the helper card dispatches no helper tool', async () => {
    const t = setupHost([hook('PreToolUse')])
    const { session, events, turnDone } = await start(t, 'promptUnmatched')

    const request = await approvalRequest(events, 0)
    await session.decideApproval({
      approvalId: request.approvalId,
      choiceId: 'abort',
      requirementId: request.requirementId,
    })
    expect(t.mcp.calls).toEqual([])
    const original = await approvalRequest(events, 1)
    await session.decideApproval({
      approvalId: original.approvalId,
      choiceId: 'abort',
      requirementId: original.requirementId,
    })
    await turnDone()
    expect(t.mcp.calls).toEqual([])
  })

  it('asks on the tool card for the helper call and the model call, then runs both', async () => {
    const t = setupHost([hook('PreToolUse'), hook('PermissionRequest')])
    const { session, events, turnDone } = await start(t, 'promptUnmatched')

    // The helper calls ask first (one per hook), then the model's own call:
    // three cards for the same tool, and no hook fires for a helper call,
    // so the run terminates instead of recursing.
    for (let index = 0; index < 3; index += 1) {
      const request = await approvalRequest(events, index)
      expect(request).toMatchObject({
        toolName: 'mcp__docs__lookup',
        subject: { kind: 'tool', toolName: 'mcp__docs__lookup' },
      })
      await session.decideApproval({
        approvalId: request.approvalId,
        choiceId: 'allow_once',
        requirementId: request.requirementId,
      })
    }
    await turnDone()
    expect(t.mcp.calls).toHaveLength(3)
    expect(events.filter((event) => event.type === 'approvalRequested')).toHaveLength(3)
    const completed = events.filter(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' &&
        event.item.kind === 'toolCall' &&
        event.item.tool === 'mcp__docs__lookup',
    )
    expect(completed).toHaveLength(1)
    expect(completed[0]?.item.status).toBe('completed')
  })

  it('runs a read-only tool with no card where the mode allows it', async () => {
    const mcp = fakeMcpSource([{ server: 'docs', tool: 'lookup', isReadOnly: true }])
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, ROOT)
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({
        client: fakeModelApiClient(api, log),
        workspaceRoot: ROOT,
        io,
        log,
      }),
      mcpServers: mcp,
      loadHooks: () => Promise.resolve([hook('PreToolUse')]),
      isHooksEnabled: () => true,
    })
    const session = await host.startSession({
      workspaceRoot: ROOT,
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const watched = watchSessionTurns(session)
    api.script(
      { calls: [{ name: 'mcp__docs__lookup', arguments: '{"q":"x"}', callId: 'c1' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'look it up' }])
    await watched.turnDone()
    expect(mcp.calls).toHaveLength(2)
    expect(watched.events.some((event) => event.type === 'approvalRequested')).toBe(false)
  })
})
