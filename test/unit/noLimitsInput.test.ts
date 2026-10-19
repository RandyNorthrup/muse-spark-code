// D121 (lane NOLIMITSINPUT): what a person attaches or fetches reaches the
// model whole. No count or size of ours stops it: only the selected model's
// capability record (with the provider's documented numbers), the transports'
// own frame validity, and the model's real context window (with a spill file
// the model pages through). Each test below fails on the code before the
// change and passes after it.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AttachmentStore } from '../../src/core/attachments'
import { resolveModelCapabilities } from '../../src/core/providers/capabilities'
import { metaCapabilityRecord } from '../../src/core/providers/capabilityRecord'
import {
  editImageLimit,
  prepareImageCall,
  type ImageWorkspace,
} from '../../src/core/backends/modelapi/imageGeneration'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { MODEL_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { AttachedMedia, type AttachedSource } from '../../src/core/media/attachedMedia'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { convertHtmlJob } from '../../src/core/web/htmlToMarkdown'
import type { HtmlConversion } from '../../src/core/web/htmlConversion'
import {
  fetchWebPage,
  type Nat64Discovery,
  type PinnedResponse,
  type WebFetchDeps,
} from '../../src/core/web/webFetch'
import { wavFixture } from './helpers/media/fixtures'

const dimension = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

function png(width: number, height: number, padding = 0): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...dimension(width),
    ...dimension(height),
    ...Array.from({ length: padding }, () => 0),
  ])
}

function store() {
  let next = 0
  return new AttachmentStore(() => {
    next += 1
    return `att-${String(next)}`
  })
}

function wavRecord(bytes: Uint8Array) {
  const info = sniffMediaBytes(bytes)
  if (info?.kind !== 'audio') throw new Error('fixture must sniff as audio')
  return { name: 'clip.wav', info, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function fixedSource(bytes: Uint8Array): AttachedSource {
  const chunk = Promise.resolve(bytes)
  return {
    read: async function* () {
      yield await chunk
    },
  }
}

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'webfetch',
)

function loadCapture(name: string) {
  const capture = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as {
    readonly finalUrl: string
    readonly responseHeaders: Record<string, string>
    readonly wireFile: string
    readonly wireSha256: string
    readonly decompressedBytes: number
  }
  const body = readFileSync(path.join(FIXTURES, capture.wireFile))
  expect(createHash('sha256').update(body).digest('hex')).toBe(capture.wireSha256)
  return { body, capture }
}

const noNat64: Nat64Discovery = { isKnown: true, prefixes: [] }

function fetchDeps(
  body: Buffer,
  headers: Record<string, string>,
  onClose?: () => void,
): WebFetchDeps {
  const response: PinnedResponse = {
    status: 200,
    headers,
    body: (async function* () {
      const piece = 64 * 1024
      for (let at = 0; at < body.length; at += piece) {
        await Promise.resolve()
        yield body.subarray(at, Math.min(at + piece, body.length))
      }
    })(),
    close() {
      onClose?.()
    },
  }
  return {
    resolve: () => Promise.resolve(['8.8.8.8']),
    nat64: () => Promise.resolve(noNat64),
    request: () => Promise.resolve(response),
    convertHtml: (job): Promise<HtmlConversion> =>
      Promise.resolve({ ok: true, page: convertHtmlJob(job) }),
    newMarker: () => 'marker',
  }
}

describe('no input limits: attachments reach the model whole', () => {
  it('attaches past twenty files: no count of ours stops the message', () => {
    const attachments = store()
    for (let index = 0; index < 21; index += 1) {
      expect(attachments.add(`${String(index)}.png`, png(1, 1)).ok).toBe(true)
    }
    expect(attachments.size).toBe(21)
  })

  it('admits an image past our old 10 MiB bound when no record states one', () => {
    // The Model API path: the Muse Code path still answers to its own 8 MiB
    // frame budget (transport validity, kept).
    expect(store().add('big.png', png(1, 1, 12 * 1024 * 1024), true).ok).toBe(true)
  })

  it('admits a document past our old 32 MB bound when no record states one', () => {
    const bytes = new Uint8Array(33 * 1024 * 1024)
    bytes.set(new TextEncoder().encode('%PDF-1.4'))
    expect(store().add('big.pdf', bytes, true).ok).toBe(true)
  })

  it('admits text past our old 1 MiB ceiling on the Muse Code path', () => {
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(0x61)
    expect(store().add('notes.md', bytes, false, true).ok).toBe(true)
  })

  it('carries Meta-documented image and document bytes in the capability record', () => {
    const record = metaCapabilityRecord('muse-spark-1.3')
    expect(record.modalities.image.state).toBe('yes')
    if (record.modalities.image.state !== 'yes') throw new Error('expected image support')
    expect(record.modalities.image.value.maxBytes).toBe(50_000_000)
    expect(record.modalities.image.value.maxCount).toBe(50)
    expect(record.modalities.image.source.ref).toContain('dev.meta.ai')
    expect(record.modalities.pdf.state).toBe('yes')
    if (record.modalities.pdf.state !== 'yes') throw new Error('expected pdf support')
    expect(record.modalities.pdf.value.maxBytes).toBe(50_000_000)
    expect(record.modalities.pdf.source.ref).toContain('dev.meta.ai')
  })
})

describe('no input limits: the attached registry never refuses', () => {
  it('keeps every idle registration: the 65th attach still resolves the first', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const parts = Array.from({ length: 65 }, (_, index) =>
      registry.register(`token-${String(index)}`, wavRecord(bytes), fixedSource(bytes)),
    )
    for (const part of parts) expect(registry.resolve(part)).toBeDefined()
  })

  it('admits while every registration is held, instead of refusing', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const held = Array.from({ length: 64 }, (_, index) =>
      registry.register(`held-${String(index)}`, wavRecord(bytes), fixedSource(bytes)),
    )
    const claims = held.map((part) => registry.claim([part]))
    try {
      const part = registry.register('late', wavRecord(bytes), fixedSource(bytes))
      expect(registry.resolve(part)).toBeDefined()
    } finally {
      for (const claim of claims) claim.release()
    }
  })
})

describe('no input limits: a fetched page reaches the model whole', () => {
  it('hands a recorded 290,810-char page to the model with no slice and no notice', async () => {
    const { body, capture } = loadCapture('wiki-internet')
    expect(capture.decompressedBytes).toBeGreaterThan(100_000)
    let closed = 0
    const result = await fetchWebPage(
      capture.finalUrl,
      fetchDeps(body, capture.responseHeaders, () => {
        closed += 1
      }),
      new AbortController().signal,
    )
    if (result.kind !== 'page') throw new Error('expected the page to read')
    expect(result.page.bytes).toBe(capture.decompressedBytes)
    // Past both removed bounds: the old 50,000-char page slice and the old
    // 100,000-char converter stop. Fails before either is removed.
    expect(result.text).toContain('National Science Foundation')
    expect(result.text).not.toContain('the page has more')
    expect(closed).toBeGreaterThan(0)
  })

  it('converts a page whole when the job names no char bound', () => {
    const { body } = loadCapture('wiki-internet')
    const page = convertHtmlJob({
      bytes: body,
      charset: 'utf8',
      url: 'https://en.wikipedia.org/wiki/History_of_the_Internet',
    })
    expect(page.isTruncated).toBe(false)
    expect(page.markdown).toContain('National Science Foundation')
    expect(page.markdown.length).toBeGreaterThan(100_000)
  })

  it('Stop still ends a fetch: an aborted turn rejects instead of hanging', async () => {
    const { body, capture } = loadCapture('example')
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchWebPage(capture.finalUrl, fetchDeps(body, capture.responseHeaders), controller.signal),
    ).rejects.toThrow()
  })
})

// A workspace port stub: only realPath/pathExists/readBytes run in
// prepare, and reads are counted to prove a refusal reads nothing.
function unusedIo(): Promise<never> {
  return Promise.reject(new Error('unused in prepare'))
}

function imageWorkspace(onRead: () => void): ImageWorkspace {
  const io: ToolIo = {
    readFile: () => Promise.resolve(undefined),
    readBytes: () => {
      onRead()
      return Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    },
    writeFile: () => Promise.resolve(),
    writeFileIfUnchanged: () => unusedIo(),
    pathExists: () => Promise.resolve(false),
    reserveFile: () => unusedIo(),
    hasUnsavedChanges: () => false,
    unsavedFiles: () => [],
    listFiles: () => Promise.resolve([]),
    searchFiles: () => unusedIo(),
    runShell: () => unusedIo(),
    realPath: (absolutePath) => Promise.resolve(absolutePath),
  }
  return { workspaceRoot: '/work', platform: 'linux', io }
}

describe("no input limits: the edit count is the provider's record", () => {
  const eleven = Array.from({ length: 11 }, (_, index) => `s${String(index)}.png`)

  it('reads ten edit sources from the Meta record, with its documentation URL', () => {
    const record = metaCapabilityRecord('muse-spark-1.3')
    expect(editImageLimit(record)).toBe(10)
  })

  it('honours a record that states its own edit count', () => {
    const record = resolveModelCapabilities(
      { provider: 'custom', nativeModel: 'model', format: 'chat' },
      [
        {
          source: { kind: 'user' },
          fields: {
            modalities: {
              image: { state: 'yes', value: { mimes: ['image/png'], maxEditSources: 3 } },
            },
          },
        },
      ],
    )
    expect(editImageLimit(record)).toBe(3)
  })

  it('states no edit count when no record reached the call', () => {
    expect(editImageLimit(undefined)).toBeUndefined()
  })

  it('refuses eleven sources from the record before reading any of them', async () => {
    let reads = 0
    const result = await prepareImageCall(
      'edit',
      { prompt: 'mix', images: eleven, path: 'o.png' },
      imageWorkspace(() => {
        reads += 1
      }),
    )
    expect(result).toEqual({
      ok: false,
      reason: fill(MODEL_TEXT.imageEditTooManySources, { max: '10' }),
    })
    expect(reads).toBe(0)
  })

  it('prepares three sources whole, reading each of them once', async () => {
    let reads = 0
    const result = await prepareImageCall(
      'edit',
      { prompt: 'mix', images: eleven.slice(0, 3), path: 'o.png' },
      imageWorkspace(() => {
        reads += 1
      }),
    )
    expect(result.ok).toBe(true)
    expect(reads).toBe(3)
  })

  it('prepares eleven sources when the record states no count', async () => {
    const record = resolveModelCapabilities(
      { provider: 'custom', nativeModel: 'model', format: 'chat' },
      [
        {
          source: { kind: 'user' },
          fields: {
            modalities: { image: { state: 'yes', value: { mimes: ['image/png'] } } },
          },
        },
      ],
    )
    let reads = 0
    const result = await prepareImageCall(
      'edit',
      { prompt: 'mix', images: eleven, path: 'o.png' },
      imageWorkspace(() => {
        reads += 1
      }),
      record,
    )
    expect(result.ok).toBe(true)
    expect(reads).toBe(11)
  })
})
