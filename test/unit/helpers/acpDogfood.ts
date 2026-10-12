import * as acp from '@agentclientprotocol/sdk'
import { AcpPaidUse } from '../../../src/acp/paid'
import type { AcpAgentDeps } from '../../../src/acp/agent'
import type { AgentHost } from '../../../src/core/agent/agentBackend'
import { memoryPaidGrants } from './paidGrants'

export function dogfoodAgentDeps(
  host: AgentHost,
  log: AcpAgentDeps['log'],
): Omit<AcpAgentDeps, 'defaultCwd'> {
  const backend: AcpAgentDeps['backend'] = {
    kind: 'modelApi',
    readiness: () => Promise.resolve({ state: 'ready' }),
    hostFor: () => Promise.resolve(host),
  }
  return {
    backend,
    version: 'test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: { id: 'auth', name: 'Auth', description: 'Auth', args: [], command: 'auth' },
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    questions: 'decline',
    log,
  }
}

export async function dogfoodSession(client: acp.ClientContext, cwd: string) {
  await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
  return await client.request('session/new', { cwd, mcpServers: [] })
}

export function dogfoodPrompt(client: acp.ClientContext, sessionId: string, text: string) {
  return client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
}
