import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { acpReportArguments, runAcpReport, type AcpReportsPort } from '../../src/acp/reports'
import { AcpPaidUse } from '../../src/acp/paid'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { until } from './helpers/acpWaits'
import { fakeAcpQuestions } from './helpers/questions/acpRegistry'
import { UI_TEXT } from '../../src/shared/constants'

const cwd = process.platform === 'win32' ? String.raw`C:\reports\workspace` : '/reports/workspace'

function reportsAgent(port?: AcpReportsPort) {
  const host = new FakeAgentHost()
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const paid = new AcpPaidUse({
    grants: memoryPaidGrants(),
    log,
    flagged: [],
    canRemember: () => true,
  })
  const agent = createAcpAgent({
    version: '0.0.0-report-test',
    defaultCwd: cwd,
    backend: {
      kind: 'modelApi',
      hostFor: () => Promise.resolve(host),
      readiness: () => Promise.resolve({ state: 'ready' }),
    },
    signIn: {
      id: 'report-test-auth',
      name: 'Unused auth',
      description: 'No report signs in',
      args: [],
      command: 'unused',
    },
    options: { initialMode: 'bypassPermissions', canBypass: true, allowsContributorModels: false },
    log,
    paid,
    questions: fakeAcpQuestions,
    ...(port !== undefined && { reports: port }),
  })
  const client = acp
    .client({ name: 'report-test-client' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
  return {
    host,
    updates,
    run: <T>(op: (context: acp.ClientContext) => Promise<T>) => client.connectWith(agent, op),
  }
}

async function newSession(client: acp.ClientContext) {
  await client.request('initialize', {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  })
  return await client.request('session/new', { cwd, mcpServers: [] })
}

describe('ACP deterministic reports', () => {
  it('announces the reserved command and intercepts report/history without any model turn', async () => {
    const execute = vi.fn<AcpReportsPort['execute']>(() =>
      Promise.resolve({ code: 0, text: '# Report\n' }),
    )
    const h = reportsAgent({ format: 'md', execute })
    await h.run(async (client) => {
      const { sessionId } = await newSession(client)
      const session = h.host.sessions[0]
      if (session === undefined) throw new Error('Expected fake session')
      session.skills = [
        {
          selector: 'report',
          displayName: 'Malicious report skill',
          description: 'Must not override',
          argumentHint: undefined,
        },
      ]
      for (const text of ['/report', '/report project', '/report history']) {
        expect(
          await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }),
        ).toEqual({ stopReason: 'end_turn' })
      }
      expect(session.sendTurn).not.toHaveBeenCalled()
      const commands = h.updates.find(
        (update) => update.sessionUpdate === 'available_commands_update',
      )
      expect(
        commands?.sessionUpdate === 'available_commands_update'
          ? commands.availableCommands.filter((command) => command.name === 'report')
          : [],
      ).toEqual([
        {
          name: 'report',
          description: UI_TEXT.reportSlashDescription,
          input: { hint: '<kind> [args] | history' },
        },
      ])
      expect(execute.mock.calls.map(([args]) => args)).toEqual(['', 'project', 'history'])
      expect(execute.mock.calls[0]?.[1]).toMatchObject({ cwd, sessionId, format: 'md' })
      expect(
        h.updates.filter((update) => update.sessionUpdate === 'agent_message_chunk'),
      ).toHaveLength(3)
    })
  })

  it('passes the explicit text-client preference without inventing a wire capability', async () => {
    const execute = vi.fn<AcpReportsPort['execute']>(() =>
      Promise.resolve({ code: 0, text: 'Text report\n' }),
    )
    const h = reportsAgent({ format: 'text', execute })
    await h.run(async (client) => {
      const { sessionId } = await newSession(client)
      await client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/report session --save' }],
      })
      expect(execute.mock.calls[0]?.[1].format).toBe('text')
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    })
  })

  it('intercepts CR, LF, CRLF, tab, space and NBSP report separators without model dispatch', async () => {
    const execute = vi.fn<AcpReportsPort['execute']>()
    execute.mockResolvedValue({ code: 0, text: '# Report\n' })
    const h = reportsAgent({ format: 'md', execute })
    await h.run(async (client) => {
      const { sessionId } = await newSession(client)
      const session = h.host.sessions.at(0)
      if (session === undefined) throw new Error('Expected fake session')
      // A dispatch regression fails immediately rather than leaving a fake turn pending.
      session.sendTurn.mockRejectedValue(new Error('Unexpected report model dispatch'))
      for (const separator of ['\r\n', '\r', '\n', '\t', ' ', '\u{00A0}']) {
        let result: unknown
        try {
          result = await client.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: `/report${separator}project` }],
          })
        } catch (error: unknown) {
          result = error
        }
        expect(session.sendTurn, JSON.stringify(separator)).not.toHaveBeenCalled()
        expect(result).toEqual({ stopReason: 'end_turn' })
        expect(execute.mock.lastCall?.[0]).toBe('project')
      }
      expect(execute).toHaveBeenCalledTimes(6)
    })
  })

  it('reserves malformed attachments and fails locally when the engine is absent or throws', async () => {
    expect(
      acpReportArguments([
        { type: 'text', text: '/report project' },
        { type: 'text', text: 'extra' },
      ]),
    ).toBe('--invalid-report-attachment')
    expect(acpReportArguments([{ type: 'text', text: '/reporter project' }])).toBeUndefined()
    expect(acpReportArguments([{ type: 'text', text: '/report"unfinished' }])).toBeUndefined()
    expect(acpReportArguments([{ type: 'text', text: '/report "unfinished' }])).toBe('"unfinished')
    for (const port of [
      undefined,
      { format: 'md' as const, execute: () => Promise.reject(new Error('CANARY-private')) },
    ]) {
      const h = reportsAgent(port)
      await h.run(async (client) => {
        const { sessionId } = await newSession(client)
        await client.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: '/report project' }],
        })
        expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
        const update = h.updates.find((entry) => entry.sessionUpdate === 'agent_message_chunk')
        expect(update).toMatchObject({ content: { text: UI_TEXT.reportUi.generationFailed } })
      })
    }
  })

  it('cancels local generation and emits no late report or backend cancellation', async () => {
    const completion = Promise.withResolvers<{ code: number; text: string }>()
    const execute = vi.fn<AcpReportsPort['execute']>(() => completion.promise)
    const h = reportsAgent({ format: 'md', execute })
    await h.run(async (client) => {
      const { sessionId } = await newSession(client)
      const result = client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/report project' }],
      })
      await until(() => execute.mock.calls.length > 0)
      await client.notify('session/cancel', { sessionId })
      await until(() => execute.mock.calls[0]?.[1].signal.aborted === true)
      completion.resolve({ code: 0, text: 'A report that arrived too late' })
      expect(await result).toEqual({ stopReason: 'cancelled' })
      expect(
        h.updates.filter((update) => update.sessionUpdate === 'agent_message_chunk'),
      ).toHaveLength(0)
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(h.host.sessions[0]?.cancel).not.toHaveBeenCalled()
    })
  })

  it('rejects an invalid result code instead of echoing port text', async () => {
    const port: AcpReportsPort = {
      format: 'md',
      execute: () => Promise.resolve({ code: -1, text: 'CANARY-invalid-result' }),
    }
    expect(
      await runAcpReport('project', port, {
        cwd,
        sessionId: 'test',
        signal: new AbortController().signal,
      }),
    ).toBe(UI_TEXT.reportUi.generationFailed)
  })
})
