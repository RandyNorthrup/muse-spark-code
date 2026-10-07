import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFetch } from '../../src/runtime/exec/execFetch'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { MODEL_API_BASE_URL, SECRET_KEYS } from '../../src/shared/constants'
import type { ExecEventBody, LastResponse } from '../../src/runtime/exec/execProtocol'
import {
  fakeModelApi,
  FAKE_MODEL_API_KEY,
  streamFor,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { memorySecrets } from './helpers/fakes'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

const model = 'muse-spark-1.3-contributor'
const body = JSON.stringify({ model, stream: true, max_output_tokens: 32_768, input: [] })
const headers = { Authorization: `Bearer ${FAKE_MODEL_API_KEY}` }
const post = { method: 'POST', body, headers }
function ignoreSignals() {
  return undefined
}
function noSignals() {
  return ignoreSignals
}
const folders: string[] = []
function folder() {
  const f = mkdtempSync(path.join(tmpdir(), 'm80-fetch-'))
  folders.push(f)
  return f
}
const dist = folder()
beforeAll(async () => {
  await buildModelApiBundle(dist)
})
afterAll(async () => {
  await Promise.all(folders.map((created) => removeFolder(created)))
})

function harness(capUsd = 1, fetcher?: typeof fetch) {
  const api = fakeModelApi()
  const ledger = createRunLedger({ capUsd, maxRequests: 30 })
  const events: ExecEventBody[] = []
  const outcomes: LastResponse[] = []
  const starts: number[] = []
  const life = createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: 10_000,
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms)
      return () => {
        clearTimeout(t)
      }
    },
    onSignal: noSignals,
    forceFinish: vi.fn(),
    exit: (): never => {
      throw new Error('exit')
    },
  })
  const forwarded = vi.fn(fetcher ?? api.fetch)
  const transport = execFetch({
    fetch: forwarded,
    ledger,
    selectedModel: model,
    imageGeneration: true,
    lifecycle: life,
    onLatch: (cause) => {
      life.latch(cause)
    },
    emit: (event) => {
      events.push(event)
    },
    onResponseStart: (n) => {
      starts.push(n)
    },
    onResponseSettled: (outcome) => {
      outcomes.push(outcome)
    },
  })
  return {
    api,
    ledger,
    life,
    forwarded,
    transport,
    events,
    outcomes,
    starts,
    close: () => {
      transport.close()
      life.dispose()
    },
  }
}
async function checkOversize(h: ReturnType<typeof harness>): Promise<void> {
  try {
    const response = await h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, post)
    await expect(response.text()).rejects.toThrow()
    await h.transport.whenSettled()
    expect(h.outcomes).toHaveLength(1)
    expect(h.outcomes[0]?.transportError).toBe('tooLarge')
    expect(h.ledger.totals().uncertainUsd).toBe(0.108135)
  } finally {
    h.close()
  }
}

describe('M80 streaming transport boundary', () => {
  it('L7 immutable byte body and returned headers reach client before EOF', async () => {
    const h = harness()
    const gate = Promise.withResolvers<undefined>()
    h.api.script({ text: 'steady', holdEof: gate.promise })
    try {
      const response = await h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, post)
      expect(response.status).toBe(200)
      expect(h.outcomes).toHaveLength(0)
      expect(h.forwarded.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', body })
      const consumed = response.text()
      gate.resolve(undefined)
      await consumed
      await h.transport.whenSettled()
      expect(h.outcomes).toHaveLength(1)
      expect(h.outcomes[0]).toMatchObject({
        terminal: 'completed',
        usage: 'valid',
        settlement: 'priced',
      })
    } finally {
      h.close()
    }
  })
  it('SSE UTF8/CRLF/multiline/comments/DONE/final EOF preserve exact bytes', async () => {
    const raw = `${streamFor({ text: '𓀀完成', doneSentinel: true }, 'r', model).replaceAll('\n', '\r\n')}:comment\r\ndata: {"type":\r\ndata: "unknown_future"}`
    const bytes = new TextEncoder().encode(raw)
    const h = harness(1, () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              for (const byte of bytes) c.enqueue(new Uint8Array([byte]))
              c.close()
            },
          }),
        ),
      ),
    )
    try {
      const response = await h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, post)
      expect(await response.text()).toBe(raw)
      expect(h.outcomes[0]?.terminal).toBe('completed')
    } finally {
      h.close()
    }
  })
  it.each([
    'https://api.meta.ai.evil/v1/responses',
    'https://user@api.meta.ai/v1/responses',
    ['http:', '//api.meta.ai/v1/responses'].join(''),
    'https://api.meta.ai/v1/responses?x=1',
    'https://api.meta.ai/v1/responses#x',
    'https://api.meta.ai/v1/responses/input_tokens',
    'https://api.meta.ai/v1/files',
  ])('D19 refuses URL %s without dispatch', async (url) => {
    const h = harness()
    try {
      await expect(h.transport.fetch(url, post)).rejects.toThrow()
      expect(h.forwarded).not.toHaveBeenCalled()
      expect(h.ledger.totals().requests).toBe(0)
    } finally {
      h.close()
    }
  })
  it.each([
    new Request(`${MODEL_API_BASE_URL}/responses`, post),
    new URL(`${MODEL_API_BASE_URL}/responses`),
  ])('D19 refuses non-string URL', async (url) => {
    const h = harness()
    try {
      await expect(h.transport.fetch(url, post)).rejects.toThrow()
      expect(h.forwarded).not.toHaveBeenCalled()
    } finally {
      h.close()
    }
  })
  it.each([
    { model, stream: true },
    { model, stream: true, max_output_tokens: 15 },
    { model, stream: true, max_output_tokens: 32_769 },
    { model, stream: true, max_output_tokens: 16, tools: [{ type: 'web_search' }] },
    { model, stream: true, max_output_tokens: 16, background: false },
    { model, stream: true, max_output_tokens: 16, previous_response_id: 'r' },
    { model: 'muse-unpriced', stream: true, max_output_tokens: 16 },
    { model, stream: false, max_output_tokens: 16 },
  ])('L5/P10 shape refusal before reservation %j', async (data) => {
    const h = harness()
    try {
      await expect(
        h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, {
          ...post,
          body: JSON.stringify(data),
        }),
      ).rejects.toThrow()
      expect(h.forwarded).not.toHaveBeenCalled()
      expect(h.life.cause).toEqual({ kind: 'request_shape' })
    } finally {
      h.close()
    }
  })
  it('D19 models catalogue only, unsupported method/body and image n=2 refuse', async () => {
    const h = harness()
    try {
      await h.transport.fetch(`${MODEL_API_BASE_URL}/models`, { headers })
      expect(h.ledger.totals().requests).toBe(0)
      await expect(
        h.transport.fetch(`${MODEL_API_BASE_URL}/images/generations`, {
          ...post,
          body: '{"n":2,"model":"muse-image-1.0"}',
        }),
      ).rejects.toThrow()
      expect(h.forwarded).toHaveBeenCalledTimes(1)
    } finally {
      h.close()
    }
    for (const options of [
      { ...post, method: 'PUT' },
      { ...post, body: new Uint8Array([1]) },
      { ...post, body: '{bad' },
    ]) {
      const separate = harness()
      try {
        await expect(
          separate.transport.fetch(`${MODEL_API_BASE_URL}/responses`, options),
        ).rejects.toThrow()
        expect(separate.forwarded).not.toHaveBeenCalled()
      } finally {
        separate.close()
      }
    }
  })
  it('L3 response and image serialize through settlement, not headers', async () => {
    const h = harness()
    const gate = Promise.withResolvers<undefined>()
    h.api.script({ holdEof: gate.promise, text: 'first' })
    try {
      const first = await h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, post)
      const second = h.transport.fetch(`${MODEL_API_BASE_URL}/images/generations`, {
        ...post,
        body: '{"n":1,"model":"muse-image-1.0"}',
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(h.forwarded).toHaveBeenCalledTimes(1)
      const consuming = first.text()
      gate.resolve(undefined)
      await consuming
      const imageResponse = await second
      await imageResponse.text()
      expect(h.forwarded).toHaveBeenCalledTimes(2)
      expect(h.ledger.totals().requests).toBe(2)
    } finally {
      h.close()
    }
  })
  it('P8 two images with one reservation allow only one uncertain attempt', async () => {
    const h = harness(0.01)
    const gate = Promise.withResolvers<undefined>()
    h.api.images.push({ hold: gate.promise })
    try {
      const first = h.transport.fetch(`${MODEL_API_BASE_URL}/images/generations`, {
        ...post,
        body: '{"n":1,"model":"muse-image-1.0"}',
      })
      const second = (async () => {
        try {
          return await h.transport.fetch(`${MODEL_API_BASE_URL}/images/generations`, {
            ...post,
            body: '{"n":1,"model":"muse-image-1.0"}',
          })
        } catch {
          return undefined
        }
      })()
      await vi.waitFor(() => {
        expect(h.forwarded).toHaveBeenCalledTimes(1)
      })
      // A successful return consumes the entire image cost. It cannot give
      // the second image another unit of headroom.
      gate.resolve(undefined)
      await first
      expect(await second).toBeUndefined()
      expect(h.ledger.totals().requests).toBe(1)
    } finally {
      h.close()
    }
  })
  it('L4 HTTP 429 retains prior R and fresh retry counts independently', async () => {
    const h = harness()
    h.api.script({ httpError: { status: 429 } }, { text: 'retry' })
    try {
      await h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, post)
      const reply = await h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, post)
      await reply.text()
      expect(h.ledger.totals()).toMatchObject({
        requests: 2,
        uncertainUsd: 0.108135,
        settledUsd: 0.000002,
      })
    } finally {
      h.close()
    }
  })
  it('F2/L12 terminal-before-EOF cancel preserves metadata but not credit; repeated close settles once', async () => {
    const h = harness()
    const settled = vi.spyOn(h.ledger, 'settleResponse')
    h.api.script({ text: 'partial', holdEof: new Promise(() => undefined) })
    try {
      const response = await h.transport.fetch(`${MODEL_API_BASE_URL}/responses`, post)
      const read = (async () => {
        try {
          return await response.text()
        } catch {
          return undefined
        }
      })()
      await vi.waitFor(() => {
        expect(h.api.responseBodies()).toHaveLength(1)
      })
      await new Promise((resolve) => setTimeout(resolve, 30))
      h.life.latch({ kind: 'signal', signal: 'SIGINT' })
      h.transport.close()
      h.transport.close()
      await read
      await h.transport.whenSettled()
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(settled).toHaveBeenCalledOnce()
      expect(h.outcomes).toHaveLength(1)
      expect(h.outcomes[0]).toMatchObject({
        terminal: 'completed',
        usage: 'valid',
        settlement: 'full-reservation',
        transportError: 'aborted',
      })
      expect(h.ledger.totals().uncertainUsd).toBe(0.108135)
    } finally {
      h.close()
    }
  })
  it.each([false, true])('L8 bounded total/frame/observer bytes; large-frame=%s', async (frame) => {
    const chunk = new TextEncoder().encode(
      frame ? `data: ${'x'.repeat(16_777_216)}` : `:${'x'.repeat(4_000_000)}\n\n`,
    )
    const h = harness(1, () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(chunk)
              if (!frame) for (let i = 0; i < 8; i += 1) c.enqueue(chunk)
              c.close()
            },
          }),
        ),
      ),
    )
    await checkOversize(h)
  })
  it.each(['frame', 'feed'])(
    'L8 independently enforces %s cap below total response cap',
    async (kind) => {
      const encoder = new TextEncoder()
      const chunks =
        kind === 'frame'
          ? Array.from({ length: 5 }, () => encoder.encode(`:${'x'.repeat(4_000_000)}\n`))
          : [encoder.encode(`:${'x'.repeat(8_388_608)}\n\n:${'y'.repeat(8_388_608)}\n\n`)]
      const h = harness(1, () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                for (const chunk of chunks) c.enqueue(chunk)
                c.close()
              },
            }),
          ),
        ),
      )
      await checkOversize(h)
    },
  )
  it.each([
    { dataOverride: [{ b64_json: '' }] },
    { dataOverride: [{ b64_json: 'not-base64' }] },
    { dataOverride: [{ b64_json: 'iVBORw0KGgo=' }] },
    { dataOverride: [{ url: 'https://invalid' }] },
  ])('P6 malformed image body stays uncertain', async (image) => {
    const h = harness()
    h.api.images.push(image)
    try {
      await expect(
        h.transport.fetch(`${MODEL_API_BASE_URL}/images/generations`, {
          ...post,
          body: '{"n":1,"model":"muse-image-1.0"}',
        }),
      ).rejects.toThrow()
      expect(h.ledger.totals().paid).toMatchObject({
        imageAttempts: 1,
        imagesUncertain: 1,
        uncertainUsd: 0.01,
      })
    } finally {
      h.close()
    }
  })
})

async function engine(reply: ScriptedReply, idle: number, isCancelled = false) {
  const h = harness()
  h.api.script(reply)
  const secrets = memorySecrets()
  await secrets.store(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  const cwd = folder()
  const runtime = createRuntimeBackend({
    options: {
      backend: 'modelApi',
      trustWorkspace: false,
      canBypass: false,
      allowsContributorModels: true,
      museBinary: '',
      shellSandbox: 'auto',
      paidFeatures: [],
      isVerbose: false,
    },
    version: 'test',
    distDir: dist,
    platform: process.platform,
    env: {},
    homeDir: folder(),
    secrets,
    runGit: vi.fn(() => Promise.resolve('')),
    fetch: h.transport.fetch,
    sleep: () => Promise.resolve(),
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    exec: { isEphemeral: true, headlessPaid: () => Promise.resolve(false), streamIdleMs: idle },
  })
  try {
    const host = await runtime.backend.hostFor(cwd)
    const session = await host.startSession({
      workspaceRoot: cwd,
      modelId: model,
      approvalMode: 'denyUnmatched',
    })
    const events: AgentEvent[] = []
    const end = Promise.withResolvers<undefined>()
    session.onEvent((event) => {
      events.push(event)
      if (event.type === 'turnCompleted') end.resolve(undefined)
    })
    await session.sendTurn([{ type: 'text', text: 'task' }])
    if (isCancelled) {
      await vi.waitFor(() => {
        expect(
          events.some(
            (event) => event.type === 'itemCompleted' && event.item.kind === 'agentMessage',
          ),
        ).toBe(true)
      })
      await session.cancel()
    }
    await end.promise
    await h.transport.whenSettled()
    return { events, totals: h.ledger.totals(), outcomes: [...h.outcomes] }
  } finally {
    h.close()
    await runtime.close()
  }
}
describe('M80 real manager/client idle seam', () => {
  it('L10 steady frame progress lasts longer than shortened idle interval and completes', async () => {
    const r = await engine({ text: 'steady '.repeat(20), frameDelayMs: 5 }, 50)
    expect(r.events.some((e) => e.type === 'turnCompleted' && e.terminal === 'completed')).toBe(
      true,
    )
    expect(r.totals.uncertainUsd).toBe(0)
    expect(r.outcomes).toHaveLength(1)
  })
  it('L11 truly idle stream after terminal aborts and retains full R once', async () => {
    const r = await engine({ text: 'partial', holdEof: new Promise(() => undefined) }, 50)
    expect(r.events.some((e) => e.type === 'turnCompleted' && e.terminal === 'failed')).toBe(true)
    expect(r.outcomes).toHaveLength(1)
    expect(r.outcomes[0]).toMatchObject({
      terminal: 'completed',
      usage: 'valid',
      settlement: 'full-reservation',
    })
    expect(r.totals.uncertainUsd).toBe(0.108135)
  })
  it('L12 real session midstream cancellation settles once and keeps observed terminal', async () => {
    const r = await engine({ text: 'partial', holdEof: new Promise(() => undefined) }, 1000, true)
    expect(r.outcomes).toHaveLength(1)
    expect(r.outcomes[0]).toMatchObject({
      terminal: 'completed',
      transportError: 'aborted',
      settlement: 'full-reservation',
    })
    expect(r.totals.uncertainUsd).toBe(0.108135)
  })
})
