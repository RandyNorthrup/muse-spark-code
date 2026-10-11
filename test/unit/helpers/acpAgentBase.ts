import type { AcpAgentDeps, AcpAgentOptions } from '../../../src/acp/agent'
import type { FakeAgentHost } from './fakeAgent'

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
