// Pull-request discovery stops on Cancel (Codex on PR #227): the real REST
// client against a real loopback stand-in for GitHub's API. An aborted
// operation sends nothing (pre-aborted) or drops its in-flight request
// instead of waiting out the deadline.
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { GitHubClient, GitHubError } from '../../src/core/git/github'
import type { CoreLogger } from '../../src/core/logging'

const silent = (): undefined => undefined
const log: CoreLogger = { trace: silent, info: silent, warn: silent, error: silent }

interface Loopback {
  readonly baseUrl: string
  readonly hits: () => number
  readonly closes: () => number
  readonly close: () => Promise<void>
}

/** GitHub's API as loopback: counts calls and closed requests, never answers. */
async function loopback(): Promise<Loopback> {
  let hits = 0
  let closes = 0
  const server = createServer((request, response) => {
    hits += 1
    // Hold the response open: only the client's abort ends it.
    request.on('close', () => {
      closes += 1
      try {
        response.destroy()
      } catch {
        // Already gone with the aborted request.
      }
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('loopback never bound')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    hits: () => hits,
    closes: () => closes,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    },
  }
}

function clientFor(baseUrl: string): GitHubClient {
  return new GitHubClient({
    fetch: globalThis.fetch.bind(globalThis),
    userAgent: 'muse-spark-code/test',
    baseUrl,
    log,
  })
}

const repository = { owner: 'octo', name: 'hello' }

describe('GitHub REST cancellation', () => {
  it('sends nothing when the operation is already stopped', async () => {
    const api = await loopback()
    try {
      const stopped = new AbortController()
      stopped.abort()
      await expect(
        clientFor(api.baseUrl).repositoryFacts('test-bearer', repository, stopped.signal),
      ).rejects.toBeInstanceOf(GitHubError)
      expect(api.hits()).toBe(0)
    } finally {
      await api.close()
    }
  })

  it('drops the in-flight discovery instead of waiting out the deadline', async () => {
    const api = await loopback()
    try {
      const stopping = new AbortController()
      const started = Date.now()
      const pending = clientFor(api.baseUrl).repositoryFacts(
        'test-bearer',
        repository,
        stopping.signal,
      )
      // Stop only once the request is provably in flight: a fixed sleep
      // loses to dispatch on a loaded rig and proves nothing.
      const seen = Date.now() + 3000
      while (api.hits() < 1 && Date.now() < seen) await sleep(10)
      expect(api.hits()).toBe(1)
      stopping.abort()
      await expect(pending).rejects.toBeInstanceOf(GitHubError)
      // The 20 s request deadline never owns a stopped operation: this
      // answers in a fraction of it on any machine.
      expect(Date.now() - started).toBeLessThan(5000)
      const deadline = Date.now() + 3000
      while (api.closes() < 1 && Date.now() < deadline) await sleep(25)
      expect(api.closes()).toBe(1)
    } finally {
      await api.close()
    }
  })
})
