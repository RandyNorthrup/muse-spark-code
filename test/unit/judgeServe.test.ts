import { receiveHttpResponse } from './helpers/httpResponse'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JudgeRuntime } from '../../src/core/judge/engine'
import {
  judgeResultSchema,
  type JudgeOutcome,
  type JudgeRequest,
} from '../../src/core/judge/schema'
import { startJudgeServer } from '../../src/runtime/judge/serve'
import { JUDGE_MAX_BODY_BYTES, JUDGE_REQUEST_TIMEOUT_MS } from '../../src/shared/constants'
import windowsReceipt from '../fixtures/judge/acl/windows-owner-only.json'

const input: JudgeRequest = {
  state: 'synthetic state',
  questions: { risk: { type: 'noul', instructions: 'Synthetic question?' } },
}
const result = judgeResultSchema.parse({
  model: 'fake',
  answers: {
    risk: {
      type: 'noul',
      noul: 0.8,
      probabilities: { true: 0.8, false: 0.2 },
      addition: 'preserved',
    },
  },
  muse: {
    risk: {
      source: 'same',
      technique: 'stated',
      model: 'fake',
      label: 'uncalibrated',
      confidence: 0.2,
      partial: false,
    },
  },
  usage: { input_tokens: 1, output_tokens: 1 },
})
const folders: string[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of closers.splice(0)) await close()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
async function folder() {
  const value = await mkdtemp(path.join(process.cwd(), '.judge-test-'))
  folders.push(value)
  return value
}
async function start(providedRuntime?: JudgeRuntime, host = '127.0.0.1', port = 0) {
  const runtime = providedRuntime ?? {
    judge: vi.fn<JudgeRuntime['judge']>(() => Promise.resolve({ outcome: 'answered', result })),
  }
  const service = await startJudgeServer({ runtime, tokenDirectory: await folder(), host, port })
  closers.push(() => service.close())
  const token = await readFile(service.tokenPath, 'utf8')
  return { service, token, runtime }
}
async function getStatus(url: string, token: string, options: Parameters<typeof send>[2] = {}) {
  const response = await send(url, token, options)
  return response.status
}
async function send(
  url: string,
  token: string,
  options: {
    headers?: Record<string, string | string[]>
    body?: string | Buffer
    method?: string
    route?: string
    omitAuthorization?: boolean
    omitHost?: boolean
    unfinished?: boolean
    chunks?: string[]
  } = {},
) {
  const address = new URL(url)
  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    let fallback: ReturnType<typeof setTimeout> | undefined
    const request = httpRequest(
      {
        hostname: address.hostname.replaceAll(/^\[|\]$/g, ''),
        port: address.port,
        path: options.route ?? address.pathname,
        method: options.method ?? 'POST',
        setHost: options.omitHost !== true,
        headers: {
          ...(!options.omitAuthorization && { authorization: `Bearer ${token}` }),
          ...options.headers,
        },
      },
      receiveHttpResponse(resolve, reject),
    )
    request.on('error', (error) => {
      clearTimeout(fallback)
      reject(error)
    })
    if (options.chunks) for (const chunk of options.chunks) request.write(chunk)
    if (options.unfinished)
      fallback = setTimeout(() => {
        request.end()
      }, 1000)
    else request.end(options.body ?? (options.chunks ? undefined : JSON.stringify(input)))
  })
}
describe('judge serve security over real sockets', () => {
  it('answers the captured contract with native answers and sibling muse unchanged', async () => {
    const { service, token, runtime } = await start()
    const response = await send(service.url, token)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual(result)
    expect(runtime.judge).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal))
    const own = await stat(service.tokenPath)
    if (process.platform !== 'win32') expect(own.mode & 0o777).toBe(0o600)
    expect(service.aclReceipt.ownerOnly).toBe(true)
  })
  it.each(['localhost', '0.0.0.0', '::', '127.0.0.2', '192.0.2.1', '[::1]'])(
    'rejects nonapproved bind %s before creating a token',
    async (host) => {
      const tokenDirectory = await folder()
      await expect(
        startJudgeServer({ host, tokenDirectory, runtime: { judge: vi.fn() } }),
      ).rejects.toThrow('EJUDGE_BIND')
      expect(await readdir(tokenDirectory)).toEqual([])
    },
  )
  it('binds IPv6 literally and requires brackets in its Host', async () => {
    const { service, token, runtime } = await start(undefined, '::1')
    expect(service.url).toMatch(/^http:\/\/\[::1\]:\d+\/v1\/systemone$/)
    expect(await getStatus(service.url, token)).toBe(200)
    expect(
      await getStatus(service.url, token, {
        headers: { host: `::1:${new URL(service.url).port}` },
      }),
    ).toBe(403)
    expect(runtime.judge).toHaveBeenCalledTimes(1)
  })
  it.each(['attacker.example:1234', 'localhost:1234', '127.0.0.1', '127.0.0.1:1'])(
    'refuses foreign or incomplete Host %s',
    async (host) => {
      const { service, token, runtime } = await start()
      expect(await getStatus(service.url, token, { headers: { host } })).toBe(403)
      expect(runtime.judge).not.toHaveBeenCalled()
    },
  )
  it.each(['https://attacker.example', 'null', ''])(
    'refuses any Origin including %s',
    async (origin) => {
      const { service, token, runtime } = await start()
      expect(await getStatus(service.url, token, { headers: { origin } })).toBe(403)
      expect(runtime.judge).not.toHaveBeenCalled()
    },
  )
  it.each(['', 'wrong', 'Basic wrong'])(
    'requires the bearer token with no Origin (%s)',
    async (authorization) => {
      const { service, token, runtime } = await start()
      expect(await getStatus(service.url, token, { headers: { authorization } })).toBe(401)
      expect(runtime.judge).not.toHaveBeenCalled()
    },
  )
  it.each([
    { method: 'GET', status: 405 },
    { route: '/v1/systemone?extra=1', status: 404 },
    { route: '/other', status: 404 },
    { body: '{', status: 400 },
    { body: '{}', status: 400 },
  ])(
    'rejects invalid method/path/body before inference ($status)',
    async ({ status, ...options }) => {
      const { service, token, runtime } = await start()
      expect(await getStatus(service.url, token, options)).toBe(status)
      expect(runtime.judge).not.toHaveBeenCalled()
    },
  )
  it('refuses missing and repeated security headers before inference', async () => {
    const { service, token, runtime } = await start()
    expect(await getStatus(service.url, token, { omitAuthorization: true })).toBe(401)
    expect(await getStatus(service.url, token, { omitHost: true })).toBe(400)
    expect(
      await getStatus(service.url, token, {
        headers: { authorization: [`Bearer ${token}`, `Bearer ${token}`] },
      }),
    ).toBe(401)
    const address = new URL(service.url)
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: Number(address.port) })
      const chunks: Buffer[] = []
      socket.on('error', reject)
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      socket.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      socket.once('connect', () => {
        socket.write(
          `POST /v1/systemone HTTP/1.1\r\nHost: ${address.host}\r\nHost: ${address.host}\r\nAuthorization: Bearer ${token}\r\nContent-Length: ${String(Buffer.byteLength(JSON.stringify(input)))}\r\nConnection: close\r\n\r\n${JSON.stringify(input)}`,
        )
      })
    })
    expect(raw.startsWith('HTTP/1.1 403')).toBe(true)
    expect(runtime.judge).not.toHaveBeenCalled()
  })
  it('refuses an unverifiable token ACL before listening', async () => {
    const tokenDirectory = await folder()
    const judge = vi.fn<JudgeRuntime['judge']>()
    await expect(
      startJudgeServer({
        tokenDirectory,
        runtime: { judge },
        windowsAcl: { secure: () => Promise.resolve({}) },
      }),
    ).rejects.toThrow('EJUDGE_TOKEN_ACL')
    expect(await readdir(tokenDirectory)).toEqual([])
    expect(judge).not.toHaveBeenCalled()
  })
  it('cancels startup before any credential is created', async () => {
    const tokenDirectory = await folder()
    const controller = new AbortController()
    controller.abort()
    const secure = vi.fn(() => Promise.resolve({}))
    await expect(
      startJudgeServer({
        tokenDirectory,
        runtime: { judge: vi.fn() },
        windowsAcl: { secure },
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(await readdir(tokenDirectory)).toEqual([])
    expect(secure).not.toHaveBeenCalled()
  })
  it('cleans up when cancellation occurs during startup ACL waits', async () => {
    const tokenDirectory = await folder()
    const controller = new AbortController()
    const secure = (_file: string, isDirectory: boolean) => {
      if (!isDirectory) controller.abort()
      return Promise.resolve(windowsReceipt)
    }
    const starting = (async () => {
      const service = await startJudgeServer({
        tokenDirectory,
        runtime: { judge: vi.fn() },
        windowsAcl: { secure },
        signal: controller.signal,
      })
      closers.push(() => service.close())
      return service
    })()
    await expect(starting).rejects.toThrow()
    expect(await readdir(tokenDirectory)).toEqual([])
  })
  it('closes its listener and deletes its bearer when the caller lifecycle aborts', async () => {
    const tokenDirectory = await folder()
    const controller = new AbortController()
    const service = await startJudgeServer({
      tokenDirectory,
      runtime: { judge: vi.fn() },
      signal: controller.signal,
    })
    closers.push(() => service.close())
    controller.abort()
    await vi.waitFor(async () => {
      await expect(stat(service.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' })
    })
    await service.close()
    expect(await readdir(tokenDirectory)).toEqual([])
  })
  it('aborts an inference at the hard request deadline without trusting late output', async () => {
    const called = Promise.withResolvers<undefined>()
    const late = Promise.withResolvers<JudgeOutcome>()
    let signal: AbortSignal | undefined
    const runtime: JudgeRuntime = {
      judge: vi.fn<JudgeRuntime['judge']>((_request, value) => {
        signal = value
        called.resolve(undefined)
        return late.promise
      }),
    }
    const { service, token } = await start(runtime)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const response = (async () => {
      try {
        return await send(service.url, token)
      } catch {
        return undefined
      }
    })()
    await called.promise
    try {
      vi.advanceTimersByTime(JUDGE_REQUEST_TIMEOUT_MS)
      expect(signal?.aborted).toBe(true)
    } finally {
      late.resolve({ outcome: 'answered', result })
      vi.useRealTimers()
      await service.close()
      await response
    }
  })
  it('caps actual streamed bytes without Content-Length and includes discarded unknown fields', async () => {
    const { service, token, runtime } = await start()
    const oversized = JSON.stringify({ ...input, unknown: 'x'.repeat(JUDGE_MAX_BODY_BYTES) })
    expect(
      await getStatus(service.url, token, {
        chunks: [oversized.slice(0, 1024), oversized.slice(1024)],
        unfinished: true,
      }),
    ).toBe(400)
    expect(runtime.judge).not.toHaveBeenCalled()
    const multibyte = JSON.stringify({ ...input, state: 'é'.repeat(JUDGE_MAX_BODY_BYTES / 2) })
    expect(await getStatus(service.url, token, { chunks: [multibyte], unfinished: true })).toBe(400)
    const exact = JSON.stringify(input).padEnd(JUDGE_MAX_BODY_BYTES, ' ')
    expect(await getStatus(service.url, token, { body: exact })).toBe(200)
  })
  it('refuses malformed UTF-8 instead of charging for replacement characters', async () => {
    const { service, token, runtime } = await start()
    const body = Buffer.from(JSON.stringify(input))
    body[body.indexOf('synthetic')] = 0xff
    expect(await getStatus(service.url, token, { body })).toBe(400)
    expect(runtime.judge).not.toHaveBeenCalled()
  })
  it('creates distinct per-request claims before dispatch for concurrent clients and retries', async () => {
    const claims = new Set<number>()
    const dispatches: number[] = []
    let balance = 1
    let next = 0
    const runtime: JudgeRuntime = {
      judge: vi.fn<JudgeRuntime['judge']>(async () => {
        if (balance === 0) return { outcome: 'no-answer', reason: 'over-budget' }
        const claim = ++next
        balance -= 1
        claims.add(claim)
        await Promise.resolve()
        expect(claims.has(claim)).toBe(true)
        dispatches.push(claim)
        return { outcome: 'answered', result }
      }),
    }
    const { service, token } = await start(runtime)
    const responses = await Promise.all([send(service.url, token), send(service.url, token)])
    expect(responses.map((value) => value.status).toSorted((left, right) => left - right)).toEqual([
      200, 403,
    ])
    expect(runtime.judge).toHaveBeenCalledTimes(2)
    expect(dispatches).toEqual([1])
    expect(await getStatus(service.url, token)).toBe(403)
    expect(runtime.judge).toHaveBeenCalledTimes(3)
  })
  it('rejects malformed or misaligned runtime output and never reflects thrown content', async () => {
    const judge = vi.fn<JudgeRuntime['judge']>()
    judge.mockResolvedValueOnce({
      outcome: 'answered',
      result: { ...result, usage: { input_tokens: -1, output_tokens: 1 } },
    })
    judge.mockResolvedValueOnce({
      outcome: 'answered',
      result: {
        ...result,
        answers: { other: result.answers['risk']! },
        muse: { other: result.muse['risk']! },
      },
    })
    judge.mockResolvedValueOnce({
      outcome: 'answered',
      result: {
        ...result,
        answers: { ...result.answers, extra: result.answers['risk']! },
        muse: { ...result.muse, extra: result.muse['risk']! },
      },
    })
    judge.mockResolvedValueOnce({
      outcome: 'answered',
      result: {
        ...result,
        answers: { risk: { type: 'choice', choice: 'A', confidence: 1, probabilities: { A: 1 } } },
      },
    })
    judge.mockRejectedValueOnce(new Error('synthetic private content'))
    judge.mockResolvedValueOnce({ outcome: 'no-answer', reason: 'source-unavailable' })
    const { service, token } = await start({ judge })
    for (let index = 0; index < 5; index += 1) {
      const response = await send(service.url, token)
      expect(response.status).toBe(500)
      expect(response.body).not.toContain('synthetic private content')
      expect(response.body.includes(token)).toBe(false)
    }
    const refusal = await send(service.url, token)
    expect(refusal.status).toBe(403)
    expect(JSON.parse(refusal.body)).toEqual({ outcome: 'no-answer', reason: 'source-unavailable' })
  })
  it('rotates credentials across restarts and deletes the old file and listener', async () => {
    const first = await start()
    await first.service.close()
    await first.service.close()
    await expect(stat(first.service.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(send(first.service.url, first.token)).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    })
    const second = await start(undefined, '127.0.0.1', Number(new URL(first.service.url).port))
    expect(first.token === second.token).toBe(false)
    expect(await getStatus(second.service.url, first.token)).toBe(401)
    expect(await getStatus(second.service.url, second.token)).toBe(200)
  })
  it('cleans up its token when a chosen port cannot listen', async () => {
    const busy = createServer()
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve))
    closers.push(async () => {
      await new Promise<void>((resolve) => {
        busy.close(() => {
          resolve()
        })
      })
    })
    const address = busy.address()
    if (address === null || typeof address === 'string') throw new Error('no test port')
    const tokenDirectory = await folder()
    await expect(
      startJudgeServer({ tokenDirectory, port: address.port, runtime: { judge: vi.fn() } }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(await readdir(tokenDirectory)).toEqual([])
  })
  it('publishes one close promise before synchronous owner cancellation reentry', async () => {
    const tokenDirectory = await folder()
    const owner = new AbortController()
    const called = Promise.withResolvers<undefined>()
    let reentered: Promise<void> | undefined
    const runtime: JudgeRuntime = {
      judge: (_request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              owner.abort()
              reentered = service.close()
              resolve({ outcome: 'no-answer', reason: 'cancelled' })
            },
            { once: true },
          )
          called.resolve(undefined)
        }),
    }
    const service = await startJudgeServer({ runtime, tokenDirectory, signal: owner.signal })
    closers.push(() => service.close())
    const token = await readFile(service.tokenPath, 'utf8')
    const response = (async () => {
      try {
        return await send(service.url, token)
      } catch {
        return undefined
      }
    })()
    await called.promise
    const stopping = service.close()
    const outcomes = await Promise.allSettled([stopping, reentered])
    await response
    expect(reentered).toBe(stopping)
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    expect(service.close()).toBe(stopping)
    expect(await readdir(tokenDirectory)).toEqual([])
  })
  it('aborts active inference and closes incomplete sockets on shutdown', async () => {
    const { promise: called, resolve: started } = Promise.withResolvers<undefined>()
    let signal: AbortSignal | undefined
    const runtime: JudgeRuntime = {
      judge: vi.fn<JudgeRuntime['judge']>((_request, value) => {
        signal = value
        started(undefined)
        return new Promise<JudgeOutcome>((resolve) => {
          value.addEventListener(
            'abort',
            () => {
              resolve({ outcome: 'no-answer', reason: 'cancelled' })
            },
            { once: true },
          )
        })
      }),
    }
    const { service, token } = await start(runtime)
    const response = (async () => {
      try {
        return await send(service.url, token)
      } catch {
        return undefined
      }
    })()
    await called
    const idle = connect({ host: '127.0.0.1', port: Number(new URL(service.url).port) })
    let socketError: Error | undefined
    idle.on('error', (error) => {
      socketError = error
    })
    await new Promise<void>((resolve) => idle.once('connect', resolve))
    const closed = new Promise<void>((resolve) =>
      idle.once('close', () => {
        resolve()
      }),
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('shutdown did not close its sockets'))
      }, 1000)
    })
    const stopping = service.close()
    try {
      expect(signal?.aborted).toBe(true)
      await Promise.race([stopping, deadline])
    } finally {
      clearTimeout(timer)
      idle.destroy()
    }
    await response
    await closed
    if (socketError !== undefined) expect(socketError).toMatchObject({ code: 'ECONNRESET' })
    expect(signal?.aborted).toBe(true)
    await expect(stat(service.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
