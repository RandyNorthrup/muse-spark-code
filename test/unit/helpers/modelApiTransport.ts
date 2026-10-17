import type { TransportDeps } from '../../../src/core/backends/modelapi/transport'

/** Null-logged transport deps; each test names its fetch, sleep and any clock it needs. */
export function transportTestDeps(
  overrides: Partial<TransportDeps> & Pick<TransportDeps, 'fetch' | 'sleep' | 'random'>,
): TransportDeps {
  return {
    baseUrl: 'https://model.test',
    now: () => Date.now(),
    log: {
      trace: (_message: string) => undefined,
      info: (_message: string) => undefined,
      warn: (_message: string) => undefined,
      error: (_message: string) => undefined,
    },
    ...overrides,
  }
}

/** A body that never yields: the read waits until it is stopped. */
export function hangingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>()
}
