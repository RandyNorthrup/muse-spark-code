import type { AcpAgentDeps, AcpAgentOptions } from '../../../src/acp/agent'
import { FakeAgentHost } from './fakeAgent'
import type * as acp from '@agentclientprotocol/sdk'
import { vi } from 'vitest'

type TestAgentBase = Pick<AcpAgentDeps, 'backend' | 'version' | 'options'>

/** The ready Muse Code test backend the ACP suites drive, with stock options. */
export function testAgentBase(host: FakeAgentHost, options?: AcpAgentOptions): TestAgentBase {
  return {
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'test',
    options: options ?? { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
  }
}

export function testAgentState() {
  const updates: acp.SessionUpdate[] = []
  return {
    host: new FakeAgentHost(),
    updates,
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}
