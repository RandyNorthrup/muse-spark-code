// M105 lane V, seam 2: the transcription POST is its own narrow transport
// method. It reaches only U18's captured route, sends once, never follows a
// redirect and hands the adapter the raw (bounded, redacted) refusal body
// instead of throwing, so the captured 400 reaches the user verbatim.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  createRuntimeDailyBudget,
  withRuntimeAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { createTranscriptionPorts } from '../../src/core/voice/transcribeBatchHttp'
import { mediaInfoSchema } from '../../src/shared/media'
import { FAKE_MODEL_API_BASE_URL, fakeModelApiClientSettings } from './helpers/fakeModelApi'

const KEY = 'fixture-transcription-key'
const ROUTE = '/asr/transcribe?sessionId=0f8fad5b-d9cb-469f-a165-70867728950e'
// Round 3's captured refusal for a container sent as is (U18 T4).
const REFUSAL = {
  error: {
    message: "The 'audio' part must be a mono 16-bit PCM WAV at 16 or 24 kHz",
    type: 'invalid_request_error',
    param: 'audio',
  },
}

function client(
  fetcher: typeof fetch,
  apiKey: () => Promise<string | undefined> = () => Promise.resolve(KEY),
): ModelApiClient {
  return new ModelApiClient({
    ...fakeModelApiClientSettings({ info: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() }),
    fetch: fetcher,
    apiKey,
  })
}

function multipart() {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('--b\r\n'))
        controller.close()
      },
    }),
    contentType: 'multipart/form-data; boundary=b',
  }
}

/** A 16 kHz mono 16-bit PCM WAV of `samples` samples: the batch contract. */
function contractWav(samples: number): Uint8Array {
  const data = samples * 2
  const bytes = new Uint8Array(44 + data)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    bytes.set(new TextEncoder().encode(text), offset)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + data, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, data, true)
  return bytes
}

describe('the transcription transport (seam 2)', () => {
  it('posts once to the captured route and returns the captured 400 body unthrown', async () => {
    const sent = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(REFUSAL, { status: 400, statusText: 'Bad Request' })),
    )
    const body = multipart()
    const response = await client(sent).requestTranscription(
      ROUTE,
      new AbortController().signal,
      body,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(REFUSAL)
    expect(sent).toHaveBeenCalledOnce()
    expect(sent.mock.calls[0]?.[0]).toBe(`${FAKE_MODEL_API_BASE_URL}${ROUTE}`)
    const init = sent.mock.calls[0]?.[1]
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', duplex: 'half' })
    expect(init?.body).toBe(body.body)
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${KEY}`)
    expect(new Headers(init?.headers).get('Content-Type')).toBe(body.contentType)
  })

  it('never retries a failed charged POST', async () => {
    const sent = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 503 })))
    const response = await client(sent).requestTranscription(
      ROUTE,
      new AbortController().signal,
      multipart(),
    )
    expect(response.status).toBe(503)
    expect(sent).toHaveBeenCalledOnce()
  })

  it.each([
    '/files',
    '/responses',
    '/asr/transcribe',
    '/asr/transcribe?sessionId=capture',
    `${ROUTE}&model=x`,
    `/asr/transcribe/../responses?sessionId=0f8fad5b-d9cb-469f-a165-70867728950e`,
    ROUTE.toUpperCase(),
  ])('refuses %s before reading the key or sending', async (route) => {
    const sent = vi.fn<typeof fetch>()
    const apiKey = vi.fn(() => Promise.resolve(KEY))
    const transport = client(sent, apiKey)
    await expect(
      transport.requestTranscription(route, new AbortController().signal, multipart()),
    ).rejects.toThrow('Invalid transcription route')
    expect(apiKey).not.toHaveBeenCalled()
    expect(sent).not.toHaveBeenCalled()
  })

  it('refuses a body that is not the adapter multipart', async () => {
    const sent = vi.fn<typeof fetch>()
    await expect(
      client(sent).requestTranscription(ROUTE, new AbortController().signal, {
        ...multipart(),
        contentType: 'application/json',
      }),
    ).rejects.toThrow('Invalid transcription route')
    expect(sent).not.toHaveBeenCalled()
  })

  it('redacts the key from any body it hands back', async () => {
    const sent = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ error: { message: `bad key ${KEY}` } }, { status: 401 })),
    )
    const response = await client(sent).requestTranscription(
      ROUTE,
      new AbortController().signal,
      multipart(),
    )
    expect(await response.text()).not.toContain(KEY)
  })

  it('checks the account digest after reading the key and before dispatch', async () => {
    const sent = vi.fn<typeof fetch>()
    await expect(
      client(sent).requestTranscription(
        ROUTE,
        new AbortController().signal,
        multipart(),
        'another-account',
      ),
    ).rejects.toThrow()
    expect(sent).not.toHaveBeenCalled()
  })

  it('rides through runtime accounting when the inner client carries it', async () => {
    const sent = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(REFUSAL, { status: 400 })))
    const daily = createRuntimeDailyBudget({
      dataFolder: mkdtempSync(path.join(tmpdir(), 'muse-transcription-')),
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })
    const wrapped = withRuntimeAccounting(client(sent), daily)
    const response = await wrapped.requestTranscription?.(
      ROUTE,
      new AbortController().signal,
      multipart(),
    )
    expect(response?.status).toBe(400)
  })

  it('carries the captured refusal through the adapter to the user verbatim', async () => {
    const sent = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(REFUSAL, { status: 400 })))
    const transport = client(sent)
    const wav = contractWav(16_000)
    const ports = createTranscriptionPorts({
      postTranscription: ({ route, body, contentType, signal }) =>
        transport.requestTranscription(route, signal, { body, contentType }),
      readAudioBytes: () => Promise.resolve(wav),
      resolveSourcePath: () => Promise.resolve('/fixture/clip.wav'),
    })
    const info = mediaInfoSchema.parse({
      kind: 'audio',
      mediaType: 'audio/wav',
      sizeBytes: wav.length,
      durationSeconds: 1,
    })
    if (info.kind !== 'audio') throw new Error('fixture')
    await expect(
      ports.batch.transcribe(
        { name: 'clip.wav', pathToken: 'token', info },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow(REFUSAL.error.message)
    expect(sent).toHaveBeenCalledOnce()
    expect(sent.mock.calls[0]?.[0] as string).toMatch(
      /\/asr\/transcribe\?sessionId=[0-9a-f-]{36}$/u,
    )
  })
})
