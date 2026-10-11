// M95 lane K (PLAN.md D74, M95 step 8.1): Scan this computer reports what
// answered on the local servers' loopback ports, and nothing else.

import { describe, expect, it } from 'vitest'
import { probeLocalServers } from '../../src/host/providers/localProbe'
import type { LocalProbeTarget } from '../../src/host/providers/providerPorts'

const TARGETS: readonly LocalProbeTarget[] = [
  { host: '127.0.0.1', port: 11_434, path: '/' },
  { host: '127.0.0.1', port: 1234, path: '/v1/models' },
  { host: '127.0.0.1', port: 8080, path: '/health' },
]

function fakeFetch(
  answers: Readonly<Record<string, { readonly status: number; readonly body: string }>>,
): typeof fetch {
  return ((url: unknown) => {
    const answer = answers[String(url)]
    return answer === undefined
      ? Promise.reject(new Error('connection refused'))
      : Promise.resolve({ status: answer.status, text: () => Promise.resolve(answer.body) })
  }) as typeof fetch
}

describe('probeLocalServers', () => {
  it('reports what answered and what did not', async () => {
    const results = await probeLocalServers(
      TARGETS,
      fakeFetch({
        'http://127.0.0.1:11434/': { status: 200, body: 'Ollama is running' },
        'http://127.0.0.1:8080/health': { status: 500, body: 'bad' },
      }),
    )
    expect(results).toEqual([
      {
        host: '127.0.0.1',
        port: 11_434,
        path: '/',
        answered: true,
        status: 200,
        snippet: 'Ollama is running',
      },
      {
        host: '127.0.0.1',
        port: 1234,
        path: '/v1/models',
        answered: false,
        status: undefined,
        snippet: '',
      },
      {
        host: '127.0.0.1',
        port: 8080,
        path: '/health',
        answered: false,
        status: 500,
        snippet: '',
      },
    ])
  })

  it('caps the shown answer and gives up at the timeout', async () => {
    const hanging = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted === true) {
        throw new Error('aborted')
      }
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
      throw new Error('unreachable')
    }) as unknown as typeof fetch
    const results = await probeLocalServers(
      [{ host: '127.0.0.1', port: 11_434, path: '/' }],
      hanging,
      20,
    )
    expect(results[0]).toMatchObject({ answered: false, status: undefined })
    const long = await probeLocalServers(
      [{ host: '127.0.0.1', port: 11_434, path: '/' }],
      fakeFetch({ 'http://127.0.0.1:11434/': { status: 200, body: 'x'.repeat(2000) } }),
    )
    expect(long[0]?.snippet).toHaveLength(500)
  })
})
