// RLF-PROVLIMITS: the provider-documented limits RLM95 named and left
// unencoded, proven over the real pacer and the real Anthropic codec.
// DeepSeek's concurrency table paces it because its captured answers carry
// no limit headers at all
// (`docs/certification/m95-captures/deepseek/02-tool-call-stream.json`,
// recorded 2026-10-04 per docs/certification/m95-captures.md); Azure has
// no capture yet, so the quota doc's own 600-RPM example is the oracle;
// Anthropic's vision and overview docs are the image and size oracles.
// No provider answers anything here.
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  azureBurstShare,
  deepseekConcurrencyLimit,
  ModelApiPacing,
  openaiPacingLimits,
  type PacingWaitLimit,
} from '../../src/core/backends/modelapi/pacing'
import { pacingWaitReason, releaseSlotOnSettled } from '../../src/core/backends/modelapi/transport'
import {
  encodeAnthropicRequest,
  type AnthropicEncodeOptions,
} from '../../src/core/backends/modelapi/codecs/anthropic'
import type { CreateResponseBody, InputItem } from '../../src/core/backends/modelapi/schemas'
import {
  ANTHROPIC_MANY_IMAGES_MAX_DIMENSION_PX,
  ANTHROPIC_MANY_IMAGES_THRESHOLD,
  ANTHROPIC_MAX_REQUEST_BYTES,
  AZURE_BURST_WINDOW_LONG_MS,
  AZURE_BURST_WINDOW_SHORT_MS,
  DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH,
  DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill, formatBytes, formatNumber } from '../../src/shared/l10n/text'

const deepseekFrame = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/certification/m95-captures/deepseek/02-tool-call-stream.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { response: { headers: Record<string, string> } }
const deepseekHeaders = new Headers(deepseekFrame.response.headers)

/** A pacer over controllable time that records every wait and wait reason. */
function recordingPacer(): {
  readonly pacing: ModelApiPacing
  readonly waits: number[]
  readonly notices: { readonly delayMs: number; readonly limit: PacingWaitLimit | undefined }[]
} {
  let now = 1_800_000_000_000
  const waits: number[] = []
  const notices: { readonly delayMs: number; readonly limit: PacingWaitLimit | undefined }[] = []
  const pacing = new ModelApiPacing({
    now: () => now,
    wait: (ms) => {
      waits.push(ms)
      now += ms
      return Promise.resolve()
    },
  })
  return { pacing, waits, notices }
}

function noticeOf(
  notices: { readonly delayMs: number; readonly limit: PacingWaitLimit | undefined }[],
) {
  return (delayMs: number, limit?: PacingWaitLimit): void => {
    notices.push({ delayMs, limit })
  }
}

const signal = (): AbortSignal => AbortSignal.timeout(5000)

describe('deepseekConcurrencyLimit', () => {
  it('carries the documented per-model ceilings and nothing else', () => {
    // api-docs.deepseek.com/quick_start/rate_limit, "Concurrency Limit",
    // read 2026-10-23: 2500 for deepseek-flash, 500 for deepseek-v4-pro.
    expect(deepseekConcurrencyLimit('deepseek-flash')).toBe(DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH)
    expect(DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH).toBe(2500)
    expect(deepseekConcurrencyLimit('deepseek-v4-pro')).toBe(DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO)
    expect(DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO).toBe(500)
    // Models the table does not name stay unpaced: only the live 429
    // pause applies to them.
    expect(deepseekConcurrencyLimit(undefined)).toBeUndefined()
    expect(deepseekConcurrencyLimit('deepseek-v4-flash')).toBeUndefined()
    expect(deepseekConcurrencyLimit('deepseek-chat')).toBeUndefined()
  })

  it('paces DeepSeek from the documented table because its answers carry no limit headers', () => {
    // The recorded DeepSeek answer has no rate-limit headers for any
    // header reader to interpret; the concurrency table above is the
    // only documented pacing input.
    for (const name of deepseekHeaders.keys()) {
      expect(name.startsWith('x-ratelimit')).toBe(false)
      expect(name.startsWith('anthropic-ratelimit')).toBe(false)
    }
    expect(openaiPacingLimits(deepseekHeaders)).toBeUndefined()
    expect(deepseekConcurrencyLimit('deepseek-flash')).toBe(2500)
  })
})

describe('DeepSeek concurrency admission', () => {
  const options = { model: 'deepseek-v4-pro', provider: 'deepseek' }

  it('holds a slot per admission and waits past the documented 500', async () => {
    const { pacing, notices } = recordingPacer()
    const leases: (() => void)[] = []
    for (let held = 0; held < 500; held += 1) {
      const lease = await pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), options)
      if (lease === undefined) throw new Error('a ceiling admission must hold a slot')
      leases.push(lease)
    }
    expect(notices).toEqual([])
    let hasSettled = false
    const waiting = pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), options)
    const track = (async (): Promise<void> => {
      await waiting
      hasSettled = true
    })()
    // The 501st admission cannot proceed: the notice names DeepSeek's
    // account concurrency ceiling instead of generic headroom.
    expect(hasSettled).toBe(false)
    expect(notices).toEqual([{ delayMs: 0, limit: { kind: 'concurrency', limit: 500 } }])
    const first = leases.at(0)
    if (first === undefined) throw new Error('leases must be held')
    first()
    const freed = await waiting
    await track
    expect(hasSettled).toBe(true)
    expect(freed).not.toBeUndefined()
    freed?.()
    for (const lease of leases.slice(1)) lease()
  })

  it('lets the foreground hold a slot without waiting past the ceiling', async () => {
    const { pacing, notices } = recordingPacer()
    const leases: (() => void)[] = []
    for (let held = 0; held < 500; held += 1) {
      const lease = await pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), options)
      if (lease === undefined) throw new Error('a ceiling admission must hold a slot')
      leases.push(lease)
    }
    // The user's turn never waits on siblings: it holds its slot past
    // the ceiling and its own retry loop answers the provider's 429.
    const foreground = await pacing.acquire(
      'ds',
      'foreground',
      0,
      signal(),
      noticeOf(notices),
      options,
    )
    expect(notices).toEqual([])
    expect(foreground).not.toBeUndefined()
    foreground?.()
    for (const lease of leases) lease()
  })

  it('counts each documented model against its own ceiling', async () => {
    const { pacing, notices } = recordingPacer()
    const leases: (() => void)[] = []
    for (let held = 0; held < 500; held += 1) {
      const lease = await pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), options)
      if (lease === undefined) throw new Error('a ceiling admission must hold a slot')
      leases.push(lease)
    }
    // deepseek-v4-pro is full, but deepseek-flash has its own 2500 and
    // admits at once on the same account.
    const flash = await pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), {
      model: 'deepseek-flash',
      provider: 'deepseek',
    })
    expect(notices).toEqual([])
    expect(flash).not.toBeUndefined()
    flash?.()
    for (const lease of leases) lease()
  })

  it('holds no slot where no documented ceiling applies', async () => {
    const { pacing, notices } = recordingPacer()
    // An undocumented DeepSeek model ...
    expect(
      await pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), {
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
      }),
    ).toBeUndefined()
    // ... and any other provider stay lease-free: only the live 429
    // pause paces them.
    expect(
      await pacing.acquire('other', 'subagent', 0, signal(), noticeOf(notices), {
        model: 'gpt-4.1',
        provider: 'openai',
      }),
    ).toBeUndefined()
    expect(notices).toEqual([])
  })

  it('ends a concurrency wait at Stop and leaves the bucket clean', async () => {
    const { pacing, notices } = recordingPacer()
    const leases: (() => void)[] = []
    for (let held = 0; held < 500; held += 1) {
      const lease = await pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), options)
      if (lease === undefined) throw new Error('a ceiling admission must hold a slot')
      leases.push(lease)
    }
    const stop = new AbortController()
    const waiting = pacing.acquire('ds', 'subagent', 0, stop.signal, noticeOf(notices), options)
    stop.abort()
    await expect(waiting).rejects.toThrow()
    // The stopped waiter left no registration behind: freeing the
    // ceiling admits again at once.
    for (const lease of leases) lease()
    const lease = await pacing.acquire('ds', 'subagent', 0, signal(), noticeOf(notices), options)
    expect(lease).not.toBeUndefined()
    lease?.()
  })
})

describe('azureBurstShare', () => {
  it('shares the quota doc’s 600-RPM example across both sub-windows', () => {
    // learn.microsoft.com/azure/foundry/openai/how-to/quota, read
    // 2026-10-23: 600 RPM over 1-second windows allows 10 per window.
    expect(azureBurstShare(600, 60_000, 1000)).toBe(10)
    expect(azureBurstShare(600, 60_000, 10_000)).toBe(100)
    expect(AZURE_BURST_WINDOW_SHORT_MS).toBe(1000)
    expect(AZURE_BURST_WINDOW_LONG_MS).toBe(10_000)
  })

  it('floors fractional shares and never strands a lone request', () => {
    // Past the expected share answers 429, so shares floor; a lone
    // request is never a burst, so a share is never zero.
    expect(azureBurstShare(100, 60_000, 1000)).toBe(1)
    expect(azureBurstShare(30, 60_000, 1000)).toBe(1)
    expect(azureBurstShare(30, 60_000, 10_000)).toBe(5)
  })
})

describe('Azure burst admission', () => {
  const options = { model: 'any-deployment', provider: 'azure' }
  const rpm600 = {
    requests: 600,
    remainingRequests: 600,
    tokens: 1_000_000,
    remainingTokens: 1_000_000,
    requestWindowMs: 60_000,
    tokenWindowMs: 60_000,
  }

  it('spreads a burst across the 1-second share of an observed 600-RPM deployment', async () => {
    const { pacing, waits, notices } = recordingPacer()
    pacing.observe('az', rpm600)
    for (let sent = 0; sent < 10; sent += 1) {
      await pacing.acquire('az', 'subagent', 0, signal(), noticeOf(notices), options)
    }
    expect(waits).toEqual([])
    // The 11th request inside the same second waits out the sub-window,
    // naming Azure's small-window evaluation instead of generic headroom.
    await pacing.acquire('az', 'subagent', 0, signal(), noticeOf(notices), options)
    expect(waits).toEqual([1000])
    expect(notices).toEqual([{ delayMs: 1000, limit: { kind: 'burst', windowMs: 1000 } }])
  })

  it('binds the 10-second sub-window past a foreground burst', async () => {
    const { pacing, waits, notices } = recordingPacer()
    pacing.observe('az', rpm600)
    // A hundred foreground admissions at once: the foreground never
    // waits, but every one counts toward Azure's evaluation windows.
    for (let sent = 0; sent < 100; sent += 1) {
      await pacing.acquire('az', 'foreground', 0, signal(), noticeOf(notices), options)
    }
    expect(waits).toEqual([])
    // The trailing ten seconds hold the full hundred-share, so the next
    // background admission waits for the window to age out — the longer
    // wait binds over the 1-second one — and names the 10-second window.
    await pacing.acquire('az', 'subagent', 0, signal(), noticeOf(notices), options)
    expect(waits).toEqual([10_000])
    expect(notices).toEqual([{ delayMs: 10_000, limit: { kind: 'burst', windowMs: 10_000 } }])
  })

  it('counts foreground admissions while the foreground never waits', async () => {
    const { pacing, waits, notices } = recordingPacer()
    pacing.observe('az', rpm600)
    for (let sent = 0; sent < 10; sent += 1) {
      await pacing.acquire('az', 'foreground', 0, signal(), noticeOf(notices), options)
    }
    expect(waits).toEqual([])
    // Azure evaluates requests received, whoever sent them: the ten
    // foreground admissions fill the 1-second share for background work.
    await pacing.acquire('az', 'subagent', 0, signal(), noticeOf(notices), options)
    expect(waits).toEqual([1000])
    expect(notices).toEqual([{ delayMs: 1000, limit: { kind: 'burst', windowMs: 1000 } }])
  })

  it('leaves unobserved Azure buckets unshaped: no per-minute limit, no shares', async () => {
    const { pacing, waits, notices } = recordingPacer()
    for (let sent = 0; sent < 20; sent += 1) {
      await pacing.acquire('az', 'subagent', 0, signal(), noticeOf(notices), options)
    }
    expect(waits).toEqual([])
    expect(notices).toEqual([])
  })

  it('still admits a lone request per window on a small deployment', async () => {
    const { pacing, waits } = recordingPacer()
    pacing.observe('az', { ...rpm600, requests: 30, remainingRequests: 30 })
    // A 30-RPM deployment shares one request per second: three rapid
    // admissions serialize instead of deadlocking.
    await pacing.acquire('az', 'subagent', 0, signal(), undefined, options)
    await pacing.acquire('az', 'subagent', 0, signal(), undefined, options)
    await pacing.acquire('az', 'subagent', 0, signal(), undefined, options)
    expect(waits).toEqual([1000, 1000])
  })
})

describe('pacingWaitReason', () => {
  it('names the binding provider-documented limit in words', () => {
    expect(pacingWaitReason({ kind: 'concurrency', limit: 500 })).toBe(
      fill(UI_TEXT.modelApiPacingConcurrencyWaiting, { limit: formatNumber(500) }),
    )
    expect(pacingWaitReason({ kind: 'burst', windowMs: 1000 })).toBe(
      UI_TEXT.modelApiPacingBurstWaiting,
    )
  })

  it('ships sentences that name the provider and its limit', () => {
    expect(EN.modelApiPacingConcurrencyWaiting).toContain('DeepSeek')
    expect(EN.modelApiPacingConcurrencyWaiting).toContain('concurrency')
    expect(EN.modelApiPacingBurstWaiting).toContain('Azure')
    expect(EN.modelApiPacingBurstWaiting).toContain('evenly')
  })
})

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const bytes = chunks.map((chunk) => new TextEncoder().encode(chunk))
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of bytes) controller.enqueue(part)
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const parts: number[][] = []
  for (;;) {
    const next = await reader.read()
    if (next.done) return Buffer.from(parts.flat()).toString('utf8')
    parts.push([...next.value])
  }
}

describe('releaseSlotOnSettled', () => {
  it('passes the bytes through and frees the slot when the body completes', async () => {
    // Our bytes through our wrapper: nothing here plays a provider.
    let released = 0
    const wrapped = releaseSlotOnSettled(streamOf(['ab', 'cd']), () => {
      released += 1
    })
    expect(await readAll(wrapped)).toBe('abcd')
    expect(released).toBe(1)
  })

  it('frees the slot exactly once when the consumer goes away', async () => {
    let released = 0
    const wrapped = releaseSlotOnSettled(streamOf(['ab', 'cd']), () => {
      released += 1
    })
    const reader = wrapped.getReader()
    await reader.cancel('stop')
    await reader.cancel('stop')
    expect(released).toBe(1)
  })

  it('frees the slot with the source’s own error, never a replacement', async () => {
    let released = 0
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('source failed'))
      },
    })
    const wrapped = releaseSlotOnSettled(failing, () => {
      released += 1
    })
    await expect(readAll(wrapped)).rejects.toThrow('source failed')
    expect(released).toBe(1)
  })
})

const ANTHROPIC_OPTIONS: AnthropicEncodeOptions = {
  model: 'claude-sonnet-5-5',
  maxTokens: 256,
  effort: 'high',
}

/** A PNG data URL with the given IHDR dimensions and optional raw-byte padding. */
function pngDataUrl(width: number, height: number, padBytes = 0): string {
  const header = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ])
  return `data:image/png;base64,${Buffer.concat([header, Buffer.alloc(padBytes, 0x41)]).toString('base64')}`
}

function anthropicBody(input: InputItem[]): CreateResponseBody {
  return {
    model: 'muse-spark-1.3',
    input,
    instructions: '',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'high', summary: 'auto' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: 256,
    prompt_cache_key: 'test-key',
    prompt_cache_retention: 'in_memory',
  }
}

function imageMessage(count: number, width: number, height = 10): InputItem {
  return {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'What is in these pictures?' },
      ...Array.from({ length: count }, () => ({
        type: 'input_image' as const,
        image_url: pngDataUrl(width, height),
        detail: 'auto' as const,
      })),
    ],
  }
}

function nativeImageCount(body: CreateResponseBody): number {
  const encoded = encodeAnthropicRequest(body, ANTHROPIC_OPTIONS)
  let images = 0
  for (const message of encoded.body.messages) {
    if (typeof message.content === 'string') continue
    for (const block of message.content) {
      if (block.type === 'image') images += 1
      else if (block.type === 'tool_result' && typeof block.content !== 'string') {
        for (const nested of block.content) if (nested.type === 'image') images += 1
      }
    }
  }
  return images
}

describe('Anthropic many-image dimensions', () => {
  it('admits 21 small images: every side fits the stricter limit', () => {
    // platform.claude.com/docs/en/build-with-claude/vision, "Request
    // limits", read 2026-10-23: past 20 images neither side may exceed
    // 2000 px. 21 fitting images encode untouched.
    expect(ANTHROPIC_MANY_IMAGES_THRESHOLD).toBe(20)
    expect(ANTHROPIC_MANY_IMAGES_MAX_DIMENSION_PX).toBe(2000)
    expect(nativeImageCount(anthropicBody([imageMessage(21, 10)]))).toBe(21)
  })

  it('refuses an over-2000px image past 20 images, naming the limit', () => {
    const body = anthropicBody([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is in these pictures?' },
          ...Array.from({ length: 20 }, () => ({
            type: 'input_image' as const,
            image_url: pngDataUrl(10, 10),
            detail: 'auto' as const,
          })),
          { type: 'input_image', image_url: pngDataUrl(2001, 10), detail: 'auto' as const },
        ],
      },
    ])
    expect(() => encodeAnthropicRequest(body, ANTHROPIC_OPTIONS)).toThrow(
      fill(EN.anthropicCodecManyImagesDimensions, {
        maxPixels: formatNumber(2000),
        maxImages: formatNumber(20),
        count: formatNumber(21),
        pixels: formatNumber(2001),
      }),
    )
  })

  it('leaves 20 images unmeasured: the tightening starts past 20', () => {
    expect(nativeImageCount(anthropicBody([imageMessage(20, 5000, 5000)]))).toBe(20)
  })

  it('counts file-id images while the provider judges their size', () => {
    // Twenty bytes plus one file reference plus one wide image: the
    // file counts toward the 20, so the wide image is measured and the
    // request is refused; the file itself is never measured locally.
    const body = anthropicBody([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is in these pictures?' },
          ...Array.from({ length: 19 }, () => ({
            type: 'input_image' as const,
            image_url: pngDataUrl(10, 10),
            detail: 'auto' as const,
          })),
          { type: 'input_image', file_id: 'file-abc123', detail: 'auto' as const },
          { type: 'input_image', image_url: pngDataUrl(2001, 10), detail: 'auto' as const },
        ],
      },
    ])
    expect(() => encodeAnthropicRequest(body, ANTHROPIC_OPTIONS)).toThrow(
      fill(EN.anthropicCodecManyImagesDimensions, {
        maxPixels: formatNumber(2000),
        maxImages: formatNumber(20),
        count: formatNumber(21),
        pixels: formatNumber(2001),
      }),
    )
  })

  it('counts images nested in tool results toward the 20', () => {
    // Twenty top-level images plus one wide image inside a tool result:
    // the nested image counts, so the request is refused.
    const body = anthropicBody([
      imageMessage(20, 10),
      {
        type: 'function_call',
        id: 'toolu_01nested',
        call_id: 'toolu_01nested',
        name: 'get_time',
        arguments: '{"timezone":"UTC"}',
      },
      {
        type: 'function_call_output',
        call_id: 'toolu_01nested',
        output: [{ type: 'input_image', image_url: pngDataUrl(10, 2001), detail: 'auto' as const }],
      },
    ])
    expect(() => encodeAnthropicRequest(body, ANTHROPIC_OPTIONS)).toThrow(
      fill(EN.anthropicCodecManyImagesDimensions, {
        maxPixels: formatNumber(2000),
        maxImages: formatNumber(20),
        count: formatNumber(21),
        pixels: formatNumber(2001),
      }),
    )
  })

  it('leaves undecodable image bytes to the provider instead of refusing', () => {
    // A well-formed data URL whose bytes are no readable image: the
    // codec cannot measure it, so the provider judges it.
    const garbage = `data:image/png;base64,${Buffer.from('not-an-image-at-all').toString('base64')}`
    const body = anthropicBody([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is in these pictures?' },
          ...Array.from({ length: 20 }, () => ({
            type: 'input_image' as const,
            image_url: pngDataUrl(10, 10),
            detail: 'auto' as const,
          })),
          { type: 'input_image', image_url: garbage, detail: 'auto' as const },
        ],
      },
    ])
    expect(nativeImageCount(body)).toBe(21)
  })

  it('ships a sentence that names the dimension rule', () => {
    expect(EN.anthropicCodecManyImagesDimensions).toContain('per image side')
    expect(EN.anthropicCodecManyImagesDimensions).toContain('more than')
  })
})

describe('Anthropic request size', () => {
  it('refuses a request past the documented 32 MB, naming the cap', () => {
    // platform.claude.com/docs/en/api/overview, "Request size limits",
    // read 2026-10-23: the Messages endpoint allows 32 MB; past it
    // answers 413 request_too_large. Twenty 1.7 MB images stay at the
    // dimension threshold, isolating the size refusal.
    expect(ANTHROPIC_MAX_REQUEST_BYTES).toBe(32_000_000)
    const body = anthropicBody([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is in these pictures?' },
          ...Array.from({ length: 20 }, () => ({
            type: 'input_image' as const,
            image_url: pngDataUrl(10, 10, 1_700_000),
            detail: 'auto' as const,
          })),
        ],
      },
    ])
    expect(() => encodeAnthropicRequest(body, ANTHROPIC_OPTIONS)).toThrow(
      `up to ${formatBytes(ANTHROPIC_MAX_REQUEST_BYTES)}`,
    )
  })

  it('admits a request under the cap', () => {
    const body = anthropicBody([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is in these pictures?' },
          ...Array.from({ length: 10 }, () => ({
            type: 'input_image' as const,
            image_url: pngDataUrl(10, 10, 1_700_000),
            detail: 'auto' as const,
          })),
        ],
      },
    ])
    expect(nativeImageCount(body)).toBe(10)
  })

  it('ships a sentence that names the request cap', () => {
    expect(EN.anthropicCodecRequestTooLarge).toContain('Anthropic allows requests up to')
  })
})
