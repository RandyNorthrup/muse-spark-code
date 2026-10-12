// A connected ACP agent over the Model API test backend (unit suites share
// one harness instead of copying it): extra deps ride along, the client
// records session updates, and `run` opens a session for one operation.
import * as acp from '@agentclientprotocol/sdk'
import { vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../../src/acp/agent'
import { AcpPaidUse } from '../../../src/acp/paid'
import { FakeAgentHost } from './fakeAgent'
import { memoryPaidGrants } from './paidGrants'

export function connectedAgent(input: {
  readonly editor: string
  readonly version: string
  readonly extra?: Partial<AcpAgentDeps>
  /** Answers the editor's permission requests; absent requests fail as denied. */
  readonly answerPermission?: (
    params: acp.RequestPermissionRequest,
  ) => acp.RequestPermissionResponse | Promise<acp.RequestPermissionResponse>
}) {
  const host = new FakeAgentHost()
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: AcpAgentDeps = {
    ...input.extra,
    // M112 made the question binding required; these rigs never ask one.
    questions: 'decline',
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: input.version,
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'account-key',
      name: 'Account key',
      description: 'Test auth',
      args: [],
      command: 'test-auth',
    },
    defaultCwd: process.cwd(),
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
  }
  const agent = createAcpAgent(deps)
  const client = acp
    .client({ name: input.editor })
    .onNotification('session/update', ({ params }) => {
      updates.push(params.update)
    })
    .onRequest('session/request_permission', async (context) => {
      if (input.answerPermission === undefined) throw new Error('permission not handled')
      return await input.answerPermission(context.params)
    })
  const run = async (op: (client: acp.ClientContext, id: string) => Promise<void>) => {
    await client.connectWith(agent, async (connection) => {
      await connection.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const session = await connection.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })
      await op(connection, session.sessionId)
    })
  }
  return { host, updates, run, log }
}
