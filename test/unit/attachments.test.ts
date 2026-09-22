import { describe, expect, it } from 'vitest'
import { AttachmentStore } from '../../src/core/attachments'
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_IMAGE_BYTES } from '../../src/shared/constants'

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

function store() {
  let next = 0
  return new AttachmentStore(() => {
    next += 1
    return `att-${String(next)}`
  })
}

describe('AttachmentStore', () => {
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
    expect(attachments.add('doc.pdf', Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('PNG, JPEG, GIF and WebP'),
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

  it('builds base64 image parts for the requested ids and drops them', () => {
    const attachments = store()
    attachments.add('a.png', png(2, 3))
    attachments.add('b.png', png(4, 5))
    attachments.add('c.png', png(6, 7))
    const parts = attachments.take(['att-3', 'missing', 'att-1'])
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
