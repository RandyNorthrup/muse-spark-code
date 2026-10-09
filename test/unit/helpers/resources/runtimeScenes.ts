// Shared ACP-agent and headless-run scenes for the runtime resource suites
// (M107 H and H–C1): one fake Muse Code host, no network, key store or model.
import { PassThrough } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { vi } from 'vitest'
import { createAcpAgent } from '../../../../src/acp/agent'
import { AcpPaidUse } from '../../../../src/acp/paid'
import type { AgentSession } from '../../../../src/core/agent/agentBackend'
import * as runtimeBackends from '../../../../src/runtime/backends'
import type { ExecDeps } from '../../../../src/runtime/exec/runExec'
import type { RuntimeResources } from '../../../../src/runtime/resources/port'
import { FakeAgentHost, type FakeAgentSession } from '../fakeAgent'
import { memorySecrets } from '../fakes'
import { memoryPaidGrants } from '../paidGrants'

/** An ACP agent over `backend` whose resource port is `resources`. */
export function resourceAcpAgent(backend: FakeAgentHost, resources: RuntimeResources) {
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return createAcpAgent({
    backend: {
      kind: 'museCode',
      hostFor: () => Promise.resolve(backend),
      readiness: () => Promise.resolve({ state: 'ready' }),
    },
    resources,
    questions: 'decline',
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
    version: 'test',
    defaultCwd: process.cwd(),
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: { id: 'test', name: 'test', description: 'test', args: [], command: 'test' },
  })
}

/** Initializes the connection and opens one session in the current folder. */
export async function openAcpSession(connection: acp.ClientContext): Promise<string> {
  await connection.request('initialize', {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  })
  const { sessionId } = await connection.request('session/new', {
    cwd: process.cwd(),
    mcpServers: [],
  })
  return sessionId
}

/** A fake host whose every new session answers its turns with `turn`. */
export function turnHost(
  turn: (session: FakeAgentSession, sessionId: string) => ReturnType<AgentSession['sendTurn']>,
): FakeAgentHost {
  const backend = new FakeAgentHost()
  const start = backend.startSession.getMockImplementation()
  if (start === undefined) throw new Error('missing fake start')
  backend.startSession.mockImplementation(async (options) => {
    const session = await start(options)
    const fake = backend.sessions.at(-1)
    if (fake === undefined) throw new Error('missing fake session')
    fake.sendTurn.mockImplementation(() => turn(fake, session.sessionId))
    return session
  })
  return backend
}

/** runExec reaches `backend` through the real runtime factory; `close` runs at shutdown. */
export function useRuntimeHost(backend: FakeAgentHost, close = () => Promise.resolve()): void {
  const realRuntime = runtimeBackends.createRuntimeBackend
  vi.spyOn(runtimeBackends, 'createRuntimeBackend').mockImplementation((options) => ({
    ...realRuntime(options),
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(backend),
    },
    close,
  }))
}

/** runExec's dependencies for a fake run: no network, key store, Git or model. */
export function fakeExecDeps(
  run: Pick<
    ExecDeps,
    'options' | 'stdout' | 'stderr' | 'now' | 'createResources' | 'resourceOverrides'
  >,
): ExecDeps {
  return {
    ...run,
    version: 'test',
    distDir: '/unused',
    platform: process.platform,
    env: {},
    homeDir: '/unused',
    processCwd: process.cwd(),
    stdin: new PassThrough(),
    storeSecrets: memorySecrets(),
    runGit: () => Promise.resolve(''),
    fetch: vi.fn(() => Promise.reject(new Error('network forbidden'))),
    sleep: () => Promise.resolve(),
    readFile: () => Promise.reject(new Error('unused')),
    randomHex: () => 'fixed',
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}
