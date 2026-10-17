import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AttachmentStore } from '../../src/core/attachments'
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'
import { pdfFixture } from './helpers/pdfFixture'
import { resolveModelCapabilities } from '../../src/core/providers/capabilities'

const dimension = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

function png(width: number, height: number, padding = 0): Uint8Array {
  const header = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  ]
  return Uint8Array.from([
    ...header,
    ...dimension(width),
    ...dimension(height),
    ...Array.from({ length: padding }, () => 0),
  ])
}

function store(maxEncodedMediaChars?: number) {
  let next = 0
  return new AttachmentStore(() => {
    next += 1
    return `att-${String(next)}`
  }, maxEncodedMediaChars)
}

describe('AttachmentStore', () => {
  it('admits images only within the selected record MIME, bytes and count policy', () => {
    const source = { kind: 'user' as const }
    const identity = { provider: 'custom', nativeModel: 'model', format: 'chat' as const }
    const image = png(2, 2)
    const record = resolveModelCapabilities(identity, [
      {
        source,
        fields: {
          modalities: {
            image: {
              state: 'yes',
              value: { mimes: ['image/png'], maxBytes: image.byteLength, maxCount: 1 },
            },
          },
        },
      },
    ])
    const attachments = store()
    expect(attachments.add('one.png', image, true, false, record).ok).toBe(true)
    expect(attachments.add('two.png', image, true, false, record).ok).toBe(false)
    expect(store().add('large.png', png(2, 2, 1), true, false, record).ok).toBe(false)
    const jpegOnly = resolveModelCapabilities(identity, [
      {
        source,
        fields: { modalities: { image: { state: 'yes', value: { mimes: ['image/jpeg'] } } } },
      },
    ])
    expect(store().add('png.png', image, true, false, jpegOnly).ok).toBe(false)
    expect(
      store().add('unknown.png', image, true, false, resolveModelCapabilities(identity)).ok,
    ).toBe(false)
    expect(
      store().add('unknown.pdf', pdfFixture(1), true, false, resolveModelCapabilities(identity)).ok,
    ).toBe(false)
  })
  it('accepts a supported image and reports its size', () => {
    const attachments = store()
    const result = attachments.add('shot.png', png(686, 695))
    expect(result).toEqual({
      ok: true,
      attachment: {
        id: 'att-1',
        name: 'shot.png',
        mediaType: 'image/png',
        width: 686,
        height: 695,
        sizeBytes: 24,
      },
    })
    expect(attachments.size).toBe(1)
    expect(attachments.list()).toHaveLength(1)
  })

  it('refuses unsupported bytes, oversized images and too many images', () => {
    const attachments = store()
    expect(attachments.add('doc.pdf', Uint8Array.from([1, 2, 3]))).toMatchObject({
      ok: false,
      reason: UI_TEXT.invalidPdf,
    })
    expect(attachments.add('huge.png', png(1, 1, MAX_IMAGE_BYTES))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('10 MB'),
    })
    for (let index = 0; index < MAX_ATTACHMENTS_PER_MESSAGE; index += 1) {
      expect(attachments.add(`${String(index)}.png`, png(1, 1)).ok).toBe(true)
    }
    expect(attachments.add('one-too-many.png', png(1, 1))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('At most'),
    })
  })

  it('accepts a PDF on Model API, preserves its name and bytes, and refuses it on Muse Code', () => {
    const bytes = pdfFixture(3)
    const attachments = store()
    expect(attachments.add('report.pdf', bytes)).toEqual({
      ok: false,
      reason: UI_TEXT.pdfNeedsModelApi,
    })
    expect(attachments.add('report.pdf', bytes, true)).toEqual({
      ok: true,
      attachment: {
        id: 'att-1',
        name: 'report.pdf',
        mediaType: 'application/pdf',
        sizeBytes: bytes.length,
        pageCount: 3,
      },
    })
    expect(attachments.partsFor(['att-1'])).toEqual([
      {
        type: 'file',
        name: 'report.pdf',
        mediaType: 'application/pdf',
        base64Data: Buffer.from(bytes).toString('base64'),
        sizeBytes: bytes.length,
        pageCount: 3,
      },
    ])
  })

  it('counts PDF pages with images and refuses an oversized or uncountable second PDF', () => {
    const attachments = store()
    expect(attachments.add('first.pdf', pdfFixture(49), true).ok).toBe(true)
    expect(attachments.add('a.png', png(1, 1), true).ok).toBe(true)
    expect(attachments.add('b.png', png(1, 1), true)).toEqual({
      ok: false,
      reason: UI_TEXT.documentsOverBudget,
    })
    const oversized = new Uint8Array(MAX_DOCUMENT_BYTES + 1)
    oversized.set(new TextEncoder().encode('%PDF-1.4'))
    expect(attachments.add('big.pdf', oversized, true)).toEqual({
      ok: false,
      reason: UI_TEXT.documentTooLarge,
    })
    attachments.clear()
    expect(attachments.add('unknown.pdf', new TextEncoder().encode('%PDF-1.4'), true).ok).toBe(true)
    expect(attachments.add('another.png', png(1, 1), true)).toEqual({
      ok: false,
      reason: UI_TEXT.documentsOverBudget,
    })
  })

  it('does not under-reserve image slots from a nested PDF dictionary count', () => {
    const attachments = store()
    expect(
      attachments.add('nested.pdf', pdfFixture(50, '/Custom << /Count 1 >>'), true),
    ).toMatchObject({
      ok: true,
      attachment: { pageCount: 50 },
    })
    expect(attachments.add('extra.png', png(1, 1), true)).toEqual({
      ok: false,
      reason: UI_TEXT.documentsOverBudget,
    })
  })

  it.each([
    ['indirect-count-decoy.pdf', 'indirect Count'],
    ['indirect-type-decoy.pdf', 'indirect Type'],
    ['plus-indirect-type-decoy.pdf', 'signed indirect Type'],
  ])('reserves all page slots for %s (%s)', (fixture) => {
    const attachments = store()
    const bytes = readFileSync(new URL(`../fixtures/${fixture}`, import.meta.url))
    expect(attachments.add(fixture, bytes, true).ok).toBe(true)
    expect(attachments.list()[0]?.pageCount).toBeUndefined()
    expect(attachments.add('extra.png', png(1, 1), true)).toEqual({
      ok: false,
      reason: UI_TEXT.documentsOverBudget,
    })
  })

  it('refuses combined encoded media above the message cap before retaining it', () => {
    const bytes = pdfFixture(1)
    const encodedLength = `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`
      .length
    const attachments = store(encodedLength + 1)
    expect(attachments.add('first.pdf', bytes, true).ok).toBe(true)
    expect(attachments.add('second.pdf', bytes, true)).toEqual({
      ok: false,
      reason: UI_TEXT.mediaTotalTooLarge,
    })
    expect(attachments.list()).toHaveLength(1)
    attachments.clear()
    expect(attachments.add('second.pdf', bytes, true).ok).toBe(true)
  })

  it('accepts bounded UTF-8 text as a named part, not as a guessed binary file', () => {
    const attachments = store()
    const bytes = new TextEncoder().encode('first line\nsecond line')
    expect(attachments.add('notes.md', bytes, false, true)).toMatchObject({
      ok: true,
      attachment: { name: 'notes.md', mediaType: 'text/plain' },
    })
    expect(attachments.partsFor(['att-1'])).toEqual([
      {
        type: 'textFile',
        name: 'notes.md',
        mediaType: 'text/plain',
        sizeBytes: bytes.length,
        text: 'first line\nsecond line',
      },
    ])
    expect(attachments.add('invalid.txt', Uint8Array.from([0xff]), false, true)).toEqual({
      ok: false,
      reason: UI_TEXT.textFileInvalid,
    })
    expect(attachments.add('binary.json', Uint8Array.from([0]), false, true)).toEqual({
      ok: false,
      reason: UI_TEXT.textFileInvalid,
    })
    expect(
      attachments.add('huge.txt', new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES + 1), false, true),
    ).toEqual({ ok: false, reason: UI_TEXT.textFileTooLarge })
  })

  it('refuses aggregate Muse text before ten valid files overflow an MSP frame', () => {
    const attachments = store()
    const bytes = new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES).fill(0x61)
    const outcomes = Array.from({ length: 10 }, (_, index) =>
      attachments.add(`note-${String(index)}.txt`, bytes, false, true),
    )
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: UI_TEXT.textFilesOverBudget })
    expect(outcomes.some((outcome) => !outcome.ok)).toBe(true)
    expect(attachments.list().length).toBeLessThan(10)
  })

  it('refuses Model API text combinations that can exceed the context by themselves', () => {
    const attachments = store()
    const bytes = new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES).fill(0x78)
    const outcomes = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, index) =>
      attachments.add(`source-${String(index)}.txt`, bytes, true, true),
    )
    expect(outcomes.every((outcome) => !outcome.ok)).toBe(true)
    expect(outcomes[0]).toEqual({ ok: false, reason: UI_TEXT.textFilesOverModelApiBudget })
    expect(attachments.list()).toHaveLength(0)
  })

  it('budgets dense Model API text together and restores room after removal', () => {
    const attachments = store()
    const dense = new TextEncoder().encode('"\\\n'.repeat(200 * 1024))
    const first = attachments.add('source.ts', dense, true, true)
    expect(first.ok).toBe(true)
    const later = new TextEncoder().encode('[]{}"'.repeat(40 * 1024))
    expect(attachments.add('second.ts', later, true, true)).toEqual({
      ok: false,
      reason: UI_TEXT.textFilesOverModelApiBudget,
    })
    if (first.ok) {
      expect(attachments.remove(first.attachment.id)).toBe(true)
    }
    expect(attachments.add('second.ts', later, true, true).ok).toBe(true)
  })

  it('counts JSON escaping and frees the Muse frame budget when an attachment is removed', () => {
    const attachments = store()
    const escaped = new TextEncoder().encode(
      '"\\\n'.repeat(Math.floor(MAX_TEXT_ATTACHMENT_BYTES / 3)),
    )
    const first = attachments.add('first.txt', escaped, false, true)
    expect(first.ok).toBe(true)
    expect(attachments.add('second.txt', escaped, false, true).ok).toBe(true)
    expect(attachments.add('third.txt', escaped, false, true).ok).toBe(true)
    expect(attachments.add('fourth.txt', escaped, false, true)).toEqual({
      ok: false,
      reason: UI_TEXT.textFilesOverBudget,
    })
    if (first.ok) {
      expect(attachments.remove(first.attachment.id)).toBe(true)
    }
    expect(attachments.add('fourth.txt', escaped, false, true).ok).toBe(true)
  })

  it('counts existing image parts when admitting Muse text', () => {
    const attachments = store()
    const image = png(1, 1, MAX_IMAGE_BYTES / 2)
    expect(attachments.add('first.png', image, false, true).ok).toBe(true)
    const text = new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES).fill(0x61)
    expect(attachments.add('first.txt', text, false, true).ok).toBe(true)
    expect(attachments.add('second.txt', text, false, true)).toEqual({
      ok: false,
      reason: UI_TEXT.textFilesOverBudget,
    })
  })

  it('builds base64 image parts for the requested ids and drops them once released', () => {
    const attachments = store()
    attachments.add('a.png', png(2, 3))
    attachments.add('b.png', png(4, 5))
    attachments.add('c.png', png(6, 7))
    const parts = attachments.partsFor(['att-3', 'missing', 'att-1'])
    // Kept until the message is accepted (D26): a refused send tries again with them.
    expect(attachments.size).toBe(3)
    attachments.release(['att-3', 'missing', 'att-1'])
    expect(parts).toEqual([
      {
        type: 'image',
        base64Data: Buffer.from(png(6, 7)).toString('base64'),
        mediaType: 'image/png',
        width: 6,
        height: 7,
      },
      {
        type: 'image',
        base64Data: Buffer.from(png(2, 3)).toString('base64'),
        mediaType: 'image/png',
        width: 2,
        height: 3,
      },
    ])
    expect(attachments.list().map((entry) => entry.id)).toEqual(['att-2'])
  })

  it('removes and clears', () => {
    const attachments = store()
    attachments.add('a.png', png(1, 1))
    attachments.add('b.png', png(1, 1))
    expect(attachments.remove('att-1')).toBe(true)
    expect(attachments.remove('att-1')).toBe(false)
    attachments.clear()
    expect(attachments.size).toBe(0)
  })
})
