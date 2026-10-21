// M95 step 1 (PLAN.md D74): Scan this computer probes loopback over plain
// `node:http`, never through a proxy. Over real loopback sockets: the fetch
// reaches the target, ignores every proxy variable (a recording proxy sees
// nothing), refuses anything that is not an `http:` URL on 127.0.0.1 or ::1
// before any lookup or connection, honors abort, and refuses oversized
// bodies rather than reading them.
//
// Nothing served here is hand-written: every served byte replays the
// committed live captures in `docs/certification/m95-captures/`
// (recorded per docs/certification/m95-captures.md; llama.cpp b11541 and
// LM Studio llmster 0.0.25-1), the way the repository's other
// capture-based suites replay them. The models-list captures keep a
// `bodySummary` sample rather than raw bytes, so those cases serve the
// sample re-serialized — captured content, not invented content.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchLoopback } from '../../src/host/providers/loopbackFetch'
import { LOOPBACK_FETCH_MAX_BODY_BYTES } from '../../src/shared/constants'

const CAPTURES = fileURLToPath(new URL('../../docs/certification/m95-captures/', import.meta.url))

interface CaptureFrame {
  readonly response: {
    readonly status: number
    readonly body?: unknown
    readonly bodySummary?: { readonly sample: unknown }
  }
}

function captureFrame(provider: string, file: string): CaptureFrame {
  return JSON.parse(readFileSync(`${CAPTURES}${provider}/${file}`, 'utf8')) as CaptureFrame
}

/** Captured content re-serialized: the models-list samples and error bodies. */
function capturedText(frame: CaptureFrame): string {
  const content = frame.response.body ?? frame.response.bodySummary?.sample
  if (content === undefined) throw new Error('capture holds no replayable body')
  return JSON.stringify(content)
}

// llama.cpp b11541 `01-models-list.json`: a 200 answer listing one model.
const LLAMACPP_MODELS = captureFrame('llamacpp', '01-models-list.json')
const LLAMACPP_MODELS_TEXT = capturedText(LLAMACPP_MODELS)
// llama.cpp b11541 `15-overflow-long-prompt.json`: a 400 context-overflow error body.
const LLAMACPP_OVERFLOW = captureFrame('llamacpp', '15-overflow-long-prompt.json')
const LLAMACPP_OVERFLOW_TEXT = capturedText(LLAMACPP_OVERFLOW)
// LM Studio llmster 0.0.25-1 `01-models-list.json`: a 200 answer listing two models.
const LMSTUDIO_MODELS_TEXT = capturedText(captureFrame('lmstudio', '01-models-list.json'))

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
})

async function listen(
  onRequest: (request: IncomingMessage, reply: (status: number, body: string) => void) => void,
): Promise<{ port: number; requests: string[] }> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`)
    onRequest(request, (status, body) => {
      response.writeHead(status, { 'content-type': 'text/plain' })
      response.end(body)
    })
  })
  servers.push(server)
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address !== null) {
        resolve(address.port)
      } else {
        reject(new Error('loopback server did not bind'))
      }
    })
  })
  return { port, requests }
}

const PROXY_VARIABLES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

async function withRecordingProxy<T>(run: (proxyRequests: string[]) => Promise<T>): Promise<T> {
  const proxy = await listen((_request, reply) => {
    reply(200, LLAMACPP_OVERFLOW_TEXT)
  })
  const saved = new Map<string, string | undefined>()
  for (const variable of PROXY_VARIABLES) {
    saved.set(variable, process.env[variable])
    process.env[variable] = `http://127.0.0.1:${String(proxy.port)}`
  }
  try {
    return await run(proxy.requests)
  } finally {
    for (const variable of PROXY_VARIABLES) {
      const previous = saved.get(variable)
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, variable)
      } else {
        process.env[variable] = previous
      }
    }
  }
}

describe('fetchLoopback (M95 step 1)', () => {
  it('GETs a loopback target and returns its status and body', async () => {
    // Serves the captured llama.cpp models-list content with its captured
    // 200 status; the byte-exact round trip is the proof.
    const target = await listen((_request, reply) => {
      reply(LLAMACPP_MODELS.response.status, LLAMACPP_MODELS_TEXT)
    })
    const response = await fetchLoopback(`http://127.0.0.1:${String(target.port)}/`)
    expect(response.status).toBe(LLAMACPP_MODELS.response.status)
    expect(await response.text()).toBe(LLAMACPP_MODELS_TEXT)
    expect(target.requests).toEqual(['GET /'])
  })

  it('passes non-2xx answers through with their status', async () => {
    // Serves the captured llama.cpp 400 overflow body with its captured
    // status; the probe passes both through untouched.
    const target = await listen((_request, reply) => {
      reply(LLAMACPP_OVERFLOW.response.status, LLAMACPP_OVERFLOW_TEXT)
    })
    const response = await fetchLoopback(`http://127.0.0.1:${String(target.port)}/health`)
    expect(response.status).toBe(LLAMACPP_OVERFLOW.response.status)
    expect(await response.text()).toBe(LLAMACPP_OVERFLOW_TEXT)
  })

  it('ignores every proxy variable: a recording proxy sees nothing', async () => {
    // The target serves the captured LM Studio models-list content (the
    // second runtime's bytes); the recording proxy serves captured bytes
    // too, and sees nothing because it is never reached.
    const target = await listen((_request, reply) => {
      reply(200, LMSTUDIO_MODELS_TEXT)
    })
    const outcome = await withRecordingProxy(async (proxyRequests) => {
      const response = await fetchLoopback(`http://127.0.0.1:${String(target.port)}/v1/models`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(LMSTUDIO_MODELS_TEXT)
      return proxyRequests
    })
    expect(outcome).toEqual([])
    expect(target.requests).toEqual(['GET /v1/models'])
  })

  it('refuses a non-loopback host before any connection', async () => {
    // No bytes served: a pure pre-connect refusal.
    await expect(fetchLoopback('http://203.0.113.7:8080/')).rejects.toThrow(
      'loopback fetch refuses a non-loopback host (203.0.113.7)',
    )
  })

  it('refuses localhost without resolving it', async () => {
    // No bytes served: a pure pre-connect refusal.
    await expect(fetchLoopback('http://localhost:1234/v1/models')).rejects.toThrow(
      'loopback fetch refuses a non-loopback host (localhost)',
    )
  })

  it('refuses https, credentials and non-GET requests', async () => {
    // No bytes served: pure pre-connect refusals.
    await expect(fetchLoopback('https://127.0.0.1:1234/')).rejects.toThrow(
      'loopback fetch refuses a https: URL',
    )
    await expect(fetchLoopback('http://user:pass@127.0.0.1:1234/')).rejects.toThrow(
      'loopback fetch refuses a URL carrying credentials',
    )
    await expect(fetchLoopback('http://127.0.0.1:1234/', { method: 'POST' })).rejects.toThrow(
      'loopback fetch refuses a POST request',
    )
  })

  it('reports a refused connection instead of answering', async () => {
    // The handler serves captured bytes, but the server closes before any
    // request, so nothing is ever served: the proof is the refused
    // connection itself.
    const closed = await listen((_request, reply) => {
      reply(200, LLAMACPP_MODELS_TEXT)
    })
    const port = closed.port
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve()
            })
          }),
      ),
    )
    await expect(fetchLoopback(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow()
  })

  it('honors an aborted signal', async () => {
    // Serves captured bytes the aborted signal never lets the probe read.
    const target = await listen((_request, reply) => {
      reply(200, LLAMACPP_MODELS_TEXT)
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchLoopback(`http://127.0.0.1:${String(target.port)}/`, { signal: controller.signal }),
    ).rejects.toThrow()
  })

  it('refuses a body past the cap rather than reading it', async () => {
    // Every byte is captured: the models-list content repeated past the
    // cap (repetition is size mechanics, not content). The probe refuses
    // rather than reading it whole.
    const oversized = LLAMACPP_MODELS_TEXT.repeat(
      Math.floor(LOOPBACK_FETCH_MAX_BODY_BYTES / LLAMACPP_MODELS_TEXT.length) + 1,
    )
    expect(oversized.length).toBeGreaterThan(LOOPBACK_FETCH_MAX_BODY_BYTES)
    const target = await listen((_request, reply) => {
      reply(200, oversized)
    })
    await expect(fetchLoopback(`http://127.0.0.1:${String(target.port)}/`)).rejects.toThrow(
      'loopback fetch refuses a body past',
    )
  })

  // C-M95-4 R2: a 204/304 answer settles with its status and no body. The
  // probe used to throw building a `Response` with an (empty) body past
  // `isSettled = true`, so the promise never settled and the scan timed
  // out reporting the port unanswered. No capture backs a 204/304 from
  // these servers; the server sends zero content bytes, so nothing is
  // hand-written — the status is plain input exercising the real
  // null-body branch over a real socket.
  for (const status of [204, 304]) {
    it(`settles a null-body ${String(status)} answer instead of hanging`, async () => {
      const target = await listen((_request, reply) => {
        reply(status, '')
      })
      const response = await fetchLoopback(`http://127.0.0.1:${String(target.port)}/v1/models`)
      expect(response.status).toBe(status)
      expect(await response.text()).toBe('')
    })
  }

  // C-M95-4 R2: Node keeps the brackets in an IPv6 URL hostname (`[::1]`),
  // which used to miss the allowlist. This asserts past the allowlist only:
  // port 9 is closed, so the failure is a refused connection (or a sandbox
  // proxy answer), never the pre-connect refusal. No bytes served.
  it('accepts bracketed ::1 past the allowlist', async () => {
    let outcome: string
    try {
      const response = await fetchLoopback('http://[::1]:9/v1/models')
      outcome = `status ${String(response.status)}`
    } catch (error: unknown) {
      outcome = error instanceof Error ? error.message : String(error)
    }
    expect(outcome).not.toContain('non-loopback host')
  })
})
