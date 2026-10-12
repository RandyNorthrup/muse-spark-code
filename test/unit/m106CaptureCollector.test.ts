// All service responses below are synthetic, never live-capture evidence.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_PLAN,
  checkCapture,
  parseCaptureSse,
  runMetaCapture,
  scrubCapture,
} from '../../scripts/capture-m106-meta.mjs'

const SECRET = 'synthetic-credential-never-live'
const script = path.resolve(import.meta.dirname, '../../scripts/capture-m106-meta.mjs')
const roots: string[] = []
function outputDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cm1061-collector-test-'))
  roots.push(root)
  return path.join(root, 'capture')
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const status = {
  is_alive: true,
  service_status: 'operational',
  service_message: '',
  updated_at: '',
  model_statuses: [],
}
const deltas = [
  {
    type: 'response.function_call_arguments.delta',
    item_id: 'fake-item',
    output_index: 0,
    delta: '{"city":"Oslo",',
  },
  {
    type: 'response.function_call_arguments.delta',
    item_id: 'fake-item',
    output_index: 0,
    delta: '"unit":"celsius"}',
  },
  {
    type: 'response.function_call_arguments.done',
    item_id: 'fake-item',
    output_index: 0,
    arguments: '{"city":"Oslo","unit":"celsius"}',
  },
  { type: 'response.completed', response: { status: 'completed', output: [] } },
]
const structured = {
  status: 'completed',
  max_output_tokens: 131_072,
  output: [
    {
      type: 'message',
      content: [{ type: 'output_text', text: '{"country":"France","capital":"Paris"}' }],
    },
  ],
}
const incomplete = {
  status: 'incomplete',
  incomplete_details: { reason: 'max_output_tokens' },
  output: [],
}
const refusal = {
  error: {
    type: 'invalid_request_error',
    param: 'parameters',
    message: "'additionalProperties' is required to be supplied and to be false.",
  },
}
function sse(frames = deltas): string {
  return frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')
}
function responseFor(index: number): Response {
  switch (index) {
    case 0:
    case 1: {
      return Response.json(status)
    }
    case 2: {
      return new Response(sse(), {
        headers: {
          'content-type': 'text/event-stream',
          'x-ratelimit-limit-requests': '150',
          'set-cookie': SECRET,
          'x-account-id': SECRET,
        },
      })
    }
    case 3: {
      return Response.json(refusal, { status: 400 })
    }
    case 4: {
      return Response.json(structured)
    }
    case 5: {
      return Response.json(incomplete)
    }
    default: {
      throw new Error('Unexpected capture retry')
    }
  }
}
function receipts(dir: string): string {
  return readdirSync(dir)
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('\n')
}
function fakeFetch(): typeof fetch {
  let index = 0
  return vi.fn(() => Promise.resolve(responseFor(index++)))
}

describe('M106 key-dependent capture collector (fake only)', () => {
  it.each(['--help', '--plan'])('keeps %s offline', (flag) => {
    const env = { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] }
    const result = spawnSync(process.execPath, [script, flag], {
      env,
      encoding: 'utf8',
      timeout: 4000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(flag === '--help' ? 'billing applies' : 'u9-raw-strict-stream')
    expect(CAPTURE_PLAN).toHaveLength(6)
  })
  it('probes the output limit at the documented 16-token minimum', () => {
    // RVCM1062B external blocker: Meta refused max_output_tokens: 1
    // (HTTP 400, test/fixtures/m106/output-incomplete.json), so the next
    // live run probes the server's own minimum with a prompt that needs
    // far more, observing a genuine incomplete stop instead of a refusal.
    const probe = CAPTURE_PLAN.find((step) => step.name === 'output-incomplete')
    expect(probe?.method).toBe('POST')
    expect(probe?.body).toMatchObject({ max_output_tokens: 16 })
    expect(JSON.stringify(probe?.body)).toContain('1 through 100')
  })
  it('refuses a live run without explicit opt-in', () => {
    const env = { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] }
    const refused = spawnSync(process.execPath, [script, 'some-directory'], {
      env,
      input: '',
      encoding: 'utf8',
      timeout: 4000,
    })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('Use --help')
  })
  it.each([
    ['empty', ''],
    ['whitespace', 'fake key'],
    ['oversized', 'x'.repeat(8193)],
  ])('clears a refused %s stdin key before any request or file write', async (_name, key) => {
    const dir = outputDir()
    const fetchImpl = fakeFetch()
    const options = { key, outputDir: dir, fetchImpl }
    await expect(runMetaCapture(options)).rejects.toThrow()
    expect(options.key).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(readdirSync(path.dirname(dir))).toEqual([])
  })

  it('collects six counted receipts with exact delta split points, safe headers and hashes', async () => {
    const dir = outputDir()
    const fetchImpl = fakeFetch()
    const options = { key: SECRET, outputDir: dir, fetchImpl }
    const manifest = await runMetaCapture(options)
    expect(options.key).toBe('')
    expect(manifest).toMatchObject({
      state: 'complete',
      postResponseAttempts: 4,
      nonInferenceAttempts: 2,
      refusedPostAttempts: 1,
    })
    expect(manifest.captures.every((capture) => capture.checked)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(6)
    for (const row of manifest.captures) {
      expect(
        createHash('sha256')
          .update(readFileSync(path.join(dir, row.file)))
          .digest('hex'),
      ).toBe(row.sha256)
    }
    const streamText = readFileSync(path.join(dir, 'u9-raw-strict-stream.json'), 'utf8')
    expect(streamText).toContain('x-ratelimit-limit-requests')
    expect(streamText).not.toContain('set-cookie')
    expect(streamText).not.toContain('x-account-id')
    expect(streamText).toContain('fake-item')
    expect(receipts(dir)).not.toContain(SECRET)
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.meta.ai/v1/status',
      expect.objectContaining({ headers: {}, redirect: 'error' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.meta.ai/v1/status',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${SECRET}` },
        redirect: 'error',
      }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://api.meta.ai/v1/responses',
      expect.objectContaining({ signal: expect.any(AbortSignal), redirect: 'error' }),
    )
  })

  it('scrubs literal key echoes from values and property names, and removes opaque reasoning', () => {
    expect(
      scrubCapture(
        { [SECRET]: [SECRET, { encrypted_content: 'opaque', unknown: 'retained' }] },
        SECRET,
      ),
    ).toEqual({ '<redacted-key>': ['<redacted-key>', { unknown: 'retained' }] })
  })

  it('scrubs echoed credentials before persisting a refused capture', async () => {
    const dir = outputDir()
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json(
          {
            ...status,
            service_message: SECRET,
            nested: { [SECRET]: SECRET, encrypted_content: SECRET },
          },
          { status: 503 },
        ),
      ),
    )
    const options = { key: SECRET, outputDir: dir, fetchImpl }
    await expect(runMetaCapture(options)).rejects.toThrow('inspect the scrubbed receipt')
    expect(options.key).toBe('')
    expect(receipts(dir)).not.toContain(SECRET)
    expect(receipts(dir)).not.toContain('encrypted_content":')
    expect(receipts(dir)).toContain('"state": "failed"')
    expect(receipts(dir)).toContain('"checked": false')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('counts a transport failure before dispatch and never retries or reports completion', async () => {
    const dir = outputDir()
    const fetchImpl = vi.fn(() => Promise.reject(new Error(SECRET)))
    const options = { key: SECRET, outputDir: dir, fetchImpl }
    await expect(runMetaCapture(options)).rejects.toThrow('M106 capture failed')
    expect(options.key).toBe('')
    expect(receipts(dir)).toContain('"nonInferenceAttempts": 1')
    expect(receipts(dir)).toContain('"state": "failed"')
    expect(receipts(dir)).not.toContain(SECRET)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses to overwrite an existing capture directory before any request', async () => {
    const dir = outputDir()
    const fetchImpl = fakeFetch()
    const options = { key: SECRET, outputDir: dir, fetchImpl }
    await runMetaCapture(options)
    writeFileSync(path.join(dir, 'sentinel'), 'preserve')
    await expect(runMetaCapture({ key: SECRET, outputDir: dir, fetchImpl })).rejects.toThrow()
    expect(readFileSync(path.join(dir, 'sentinel'), 'utf8')).toBe('preserve')
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })

  it('cancels an oversized response and preserves an honest failed manifest', async () => {
    const dir = outputDir()
    const canceled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1))
        controller.enqueue(new Uint8Array(1))
        controller.close()
      },
      cancel: canceled,
    })
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(body)))
    await expect(runMetaCapture({ key: SECRET, outputDir: dir, fetchImpl })).rejects.toThrow(
      'M106 capture failed',
    )
    expect(canceled).toHaveBeenCalledOnce()
    expect(receipts(dir)).toContain('"state": "failed"')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('parses CRLF, multiline data and the SSE terminator without losing unknown fields', () => {
    expect(
      parseCaptureSse(
        ': keepalive\r\n\r\nevent: future\r\ndata: {"type":"future",\r\ndata: "extra":true}\r\n\r\ndata: [DONE]\r\n\r\n',
      ),
    ).toEqual([{ event: 'future', data: { type: 'future', extra: true } }])
    expect(() => parseCaptureSse(sse().slice(0, -1))).toThrow('complete final block')
    expect(() => parseCaptureSse('data: invalid\n\n')).toThrow()
  })

  it.each([
    ['missing deltas', deltas.slice(2)],
    [
      'missing done',
      deltas.filter((frame) => frame.type !== 'response.function_call_arguments.done'),
    ],
    ['missing completion', deltas.slice(0, -1)],
    [
      'changed identity',
      deltas.map((frame, index) => (index === 0 ? { ...frame, item_id: 'other' } : frame)),
    ],
    ['missing identity', deltas.map((frame) => ({ ...frame, item_id: undefined }))],
    [
      'different done arguments',
      deltas.map((frame) =>
        frame.type === 'response.function_call_arguments.done'
          ? { ...frame, arguments: '{"city": "Oslo","unit":"celsius"}' }
          : frame,
      ),
    ],
  ])('refuses unsupported U9 evidence: %s', (_name, frames) => {
    expect(() => {
      checkCapture(
        'u9-raw-strict-stream',
        200,
        frames.map((data) => ({ data })),
      )
    }).toThrow()
  })

  it('refuses status schema errors, a missing strict 400, wrong structured answers and unobserved output limits', () => {
    expect(() => {
      checkCapture('status-public', 200, { ...status, is_alive: 'yes' })
    }).toThrow()
    expect(() => {
      checkCapture('u9-strict-refusal', 200, refusal)
    }).toThrow('refusal was not observed')
    expect(() => {
      checkCapture('u10-structured-cap', 200, { ...structured, max_output_tokens: 128_000 })
    }).toThrow('cap was not accepted')
    expect(() => {
      checkCapture('u10-structured-cap', 200, { ...structured, output: [] })
    }).toThrow()
    expect(() => {
      checkCapture('output-incomplete', 200, { ...incomplete, status: 'completed' })
    }).toThrow('incomplete response was not observed')
    expect(() => {
      checkCapture('unknown', 200, {})
    }).toThrow('Unknown capture check')
  })
})
