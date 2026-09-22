import { describe, expect, it } from 'vitest'
import { readImageInfo } from '../../src/core/imageDimensions'

const GIF_HEADER_LENGTH = 10

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0)
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff]
}

function u24le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
}

function png(width: number, height: number): Uint8Array {
  return bytes(
    0x89,
    ...ascii('PNG'),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(width),
    ...u32be(height),
  )
}

function jpeg(width: number, height: number, ...leadingSegments: number[][]): Uint8Array {
  const sof = [0xff, 0xc0, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3]
  return bytes(0xff, 0xd8, ...leadingSegments.flat(), ...sof)
}

describe('readImageInfo', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(readImageInfo(png(686, 695))).toEqual({
      mediaType: 'image/png',
      width: 686,
      height: 695,
    })
  })

  it('reads GIF dimensions from the logical screen descriptor', () => {
    const gif = bytes(...ascii('GIF89a'), ...u16le(320), ...u16le(200))
    expect(gif).toHaveLength(GIF_HEADER_LENGTH)
    expect(readImageInfo(gif)).toEqual({ mediaType: 'image/gif', width: 320, height: 200 })
  })

  it('reads JPEG dimensions from the first start-of-frame segment', () => {
    const app0 = [0xff, 0xe0, ...u16be(4), 0, 0]
    const dht = [0xff, 0xc4, ...u16be(3), 0]
    const restart = [0xff, 0xd0]
    const padding = [0xff]
    expect(readImageInfo(jpeg(1920, 1080, app0, dht, restart, padding))).toEqual({
      mediaType: 'image/jpeg',
      width: 1920,
      height: 1080,
    })
  })

  it('reads progressive JPEG (SOF2) frames too', () => {
    const sof2 = bytes(0xff, 0xd8, 0xff, 0xc2, ...u16be(17), 8, ...u16be(10), ...u16be(20), 3)
    expect(readImageInfo(sof2)).toMatchObject({ width: 20, height: 10 })
  })

  it('gives up on a JPEG with no frame or a corrupt segment', () => {
    expect(readImageInfo(bytes(0xff, 0xd8, 0xff, 0xe0, ...u16be(4), 0, 0))).toBeUndefined()
    expect(readImageInfo(bytes(0xff, 0xd8, 0x00, 0x00))).toBeUndefined()
    expect(readImageInfo(bytes(0xff, 0xd8, 0xff, 0xe0, ...u16be(1)))).toBeUndefined()
    expect(readImageInfo(bytes(0xff, 0xd8, 0xff, 0xc0, ...u16be(17), 8))).toBeUndefined()
  })

  it('reads lossy WebP (VP8) dimensions', () => {
    const webp = bytes(
      ...ascii('RIFF'),
      ...u32be(0),
      ...ascii('WEBP'),
      ...ascii('VP8 '),
      ...u32be(0),
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      ...u16le(0x40_00 | 640),
      ...u16le(480),
    )
    expect(readImageInfo(webp)).toEqual({ mediaType: 'image/webp', width: 640, height: 480 })
  })

  it('reads lossless WebP (VP8L) dimensions', () => {
    // width-1 = 299 (0x12B), height-1 = 199 (0xC7), packed 14 bits each.
    const packed = 299 | (199 << 14)
    const webp = bytes(
      ...ascii('RIFF'),
      ...u32be(0),
      ...ascii('WEBP'),
      ...ascii('VP8L'),
      ...u32be(0),
      0x2f,
      packed & 0xff,
      (packed >>> 8) & 0xff,
      (packed >>> 16) & 0xff,
      (packed >>> 24) & 0xff,
    )
    expect(readImageInfo(webp)).toEqual({ mediaType: 'image/webp', width: 300, height: 200 })
  })

  it('reads extended WebP (VP8X) dimensions', () => {
    const webp = bytes(
      ...ascii('RIFF'),
      ...u32be(0),
      ...ascii('WEBP'),
      ...ascii('VP8X'),
      ...u32be(10),
      0,
      0,
      0,
      0,
      ...u24le(1023),
      ...u24le(767),
    )
    expect(readImageInfo(webp)).toEqual({ mediaType: 'image/webp', width: 1024, height: 768 })
  })

  it('rejects unknown WebP chunks and truncated files', () => {
    const unknown = bytes(...ascii('RIFF'), ...u32be(0), ...ascii('WEBP'), ...ascii('ALPH'))
    expect(readImageInfo(unknown)).toBeUndefined()
    expect(readImageInfo(png(1, 1).subarray(0, 20))).toBeUndefined()
    expect(readImageInfo(bytes(...ascii('GIF89a'), 1))).toBeUndefined()
    const shortVp8 = bytes(...ascii('RIFF'), ...u32be(0), ...ascii('WEBP'), ...ascii('VP8 '))
    expect(readImageInfo(shortVp8)).toBeUndefined()
  })

  it('returns undefined for anything that is not an image', () => {
    expect(readImageInfo(bytes(...ascii('%PDF-1.7')))).toBeUndefined()
    expect(readImageInfo(bytes())).toBeUndefined()
    expect(readImageInfo(bytes(...ascii('RIFF'), ...u32be(0), ...ascii('WAVE')))).toBeUndefined()
  })
})
