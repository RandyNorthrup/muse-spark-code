import type { TransportDeps } from '../../../src/core/backends/modelapi/transport'

/**
Null-logged transport deps over real time: the production clock and
jitter, and the transport's own abortable sleep (absent `sleep`, lane
PR225W1). Each test names only its fetch; sleeps and randomness on a
tested path are the real ones.
*/
export function transportTestDeps(
  overrides: Partial<TransportDeps> & Pick<TransportDeps, 'fetch'>,
): TransportDeps {
  return {
    baseUrl: 'https://model.test',
    now: () => Date.now(),
    random: () => Math.random(),
    log: {
      trace: (_message: string) => undefined,
      info: (_message: string) => undefined,
      warn: (_message: string) => undefined,
      error: (_message: string) => undefined,
    },
    ...overrides,
  }
}
