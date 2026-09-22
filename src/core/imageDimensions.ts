// Reads the pixel size and media type of an image from its leading bytes, for
// the `name W×H` attachment chip and the MSP image part. Supports exactly the
// formats the Model API accepts (PNG, JPEG, GIF, WebP); anything else returns
// undefined so the caller can refuse it with a reason.

import type { ImageMediaType } from '../shared/constants'

export interface ImageInfo {
  readonly mediaType: ImageMediaType
  readonly width: number
  readonly height: number
}

const BITS_PER_BYTE = 8
const BYTES_PER_U16 = 2
const BYTES_PER_U24 = 3
const BYTES_PER_U32 = 4
const FOURCC_LENGTH = 4

// PNG: 8-byte signature, then the IHDR chunk whose data starts at byte 16
// with big-endian width and height.
const PNG_SIGNATURE = '\u{89}PNG\r\n\u{1A}\n'
const PNG_WIDTH_OFFSET = 16
const PNG_HEIGHT_OFFSET = 20

// GIF: "GIF87a"/"GIF89a", then little-endian logical screen width/height.
const GIF_SIGNATURE = 'GIF8'
const GIF_WIDTH_OFFSET = 6
const GIF_HEIGHT_OFFSET = 8

// JPEG: SOI (FF D8) then marker segments; a start-of-frame segment carries
// the dimensions after the marker (2), the length (2) and the precision (1).
const JPEG_SOI = '\u{FF}\u{D8}'
const JPEG_MARKER_PREFIX = 0xff
const JPEG_SOF_LOW = 0xc0
const JPEG_SOF_HIGH = 0xcf
// DHT, the JPG extension and DAC sit in the SOF range but are not frames.
const JPEG_DHT = 0xc4
const JPEG_JPG_EXTENSION = 0xc8
const JPEG_DAC = 0xcc
const JPEG_NON_SOF = new Set([JPEG_DHT, JPEG_JPG_EXTENSION, JPEG_DAC])
// RSTn (D0–D7), TEM (01) and fill FF bytes have no length field.
const JPEG_STANDALONE_LOW = 0xd0
const JPEG_STANDALONE_HIGH = 0xd7
const JPEG_TEM = 0x01
const JPEG_MARKER_LENGTH = 2
const JPEG_SOF_HEIGHT_OFFSET = 5
const JPEG_SOF_WIDTH_OFFSET = 7

// WebP: RIFF container, "WEBP" at 8, first chunk FourCC at 12.
const RIFF = 'RIFF'
const WEBP = 'WEBP'
const WEBP_FORMAT_OFFSET = 8
const WEBP_CHUNK_OFFSET = 12
// VP8 (lossy): 14-bit little-endian width/height at 26 and 28.
const WEBP_VP8_WIDTH_OFFSET = 26
const WEBP_VP8_HEIGHT_OFFSET = 28
const WEBP_VP8_DIMENSION_MASK = 0x3f_ff
// VP8L (lossless): 14-bit width-1 and height-1 packed into bytes 21–24.
const WEBP_VP8L_BITS_OFFSET = 21
const VP8L_WIDTH_HIGH_MASK = 0x3f
const VP8L_HEIGHT_LOW_SHIFT = 6
const VP8L_HEIGHT_MID_SHIFT = 2
const VP8L_HEIGHT_HIGH_SHIFT = 10
const VP8L_HEIGHT_HIGH_MASK = 0x0f
// VP8X (extended): 24-bit little-endian width-1 at 24 and height-1 at 27.
const WEBP_VP8X_WIDTH_OFFSET = 24
const WEBP_VP8X_HEIGHT_OFFSET = 27

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCodePoint(...bytes.subarray(start, start + length))
}

function hasSignature(bytes: Uint8Array, signature: string, offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    ascii(bytes, offset, signature.length) === signature
  )
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << BITS_PER_BYTE) | (bytes[offset + 1] ?? 0)
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << BITS_PER_BYTE)
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (
    u16le(bytes, offset) | ((bytes[offset + BYTES_PER_U16] ?? 0) << (BITS_PER_BYTE * BYTES_PER_U16))
  )
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    u16be(bytes, offset) * 2 ** (BITS_PER_BYTE * BYTES_PER_U16) +
    u16be(bytes, offset + BYTES_PER_U16)
  )
}

function readPng(bytes: Uint8Array): ImageInfo | undefined {
  if (!hasSignature(bytes, PNG_SIGNATURE) || bytes.length < PNG_HEIGHT_OFFSET + BYTES_PER_U32) {
    return undefined
  }
  return {
    mediaType: 'image/png',
    width: u32be(bytes, PNG_WIDTH_OFFSET),
    height: u32be(bytes, PNG_HEIGHT_OFFSET),
  }
}

function readGif(bytes: Uint8Array): ImageInfo | undefined {
  if (!hasSignature(bytes, GIF_SIGNATURE) || bytes.length < GIF_HEIGHT_OFFSET + BYTES_PER_U16) {
    return undefined
  }
  return {
    mediaType: 'image/gif',
    width: u16le(bytes, GIF_WIDTH_OFFSET),
    height: u16le(bytes, GIF_HEIGHT_OFFSET),
  }
}

function isJpegSof(marker: number): boolean {
  return marker >= JPEG_SOF_LOW && marker <= JPEG_SOF_HIGH && !JPEG_NON_SOF.has(marker)
}

function isJpegStandalone(marker: number): boolean {
  return (
    (marker >= JPEG_STANDALONE_LOW && marker <= JPEG_STANDALONE_HIGH) ||
    marker === JPEG_TEM ||
    marker === JPEG_MARKER_PREFIX
  )
}

function readJpeg(bytes: Uint8Array): ImageInfo | undefined {
  if (!hasSignature(bytes, JPEG_SOI)) {
    return undefined
  }
  let offset = JPEG_SOI.length
  while (offset + JPEG_MARKER_LENGTH <= bytes.length) {
    if (bytes[offset] !== JPEG_MARKER_PREFIX) {
      return undefined
    }
    const marker = bytes[offset + 1] ?? 0
    if (isJpegStandalone(marker)) {
      offset += marker === JPEG_MARKER_PREFIX ? 1 : JPEG_MARKER_LENGTH
      continue
    }
    if (isJpegSof(marker)) {
      if (offset + JPEG_SOF_WIDTH_OFFSET + BYTES_PER_U16 > bytes.length) {
        return undefined
      }
      return {
        mediaType: 'image/jpeg',
        height: u16be(bytes, offset + JPEG_SOF_HEIGHT_OFFSET),
        width: u16be(bytes, offset + JPEG_SOF_WIDTH_OFFSET),
      }
    }
    const length = u16be(bytes, offset + JPEG_MARKER_LENGTH)
    if (length < JPEG_MARKER_LENGTH) {
      return undefined
    }
    offset += JPEG_MARKER_LENGTH + length
  }
  return undefined
}

function readWebpChunk(bytes: Uint8Array, chunk: string): ImageInfo | undefined {
  switch (chunk) {
    case 'VP8 ': {
      if (bytes.length < WEBP_VP8_HEIGHT_OFFSET + BYTES_PER_U16) {
        return undefined
      }
      return {
        mediaType: 'image/webp',
        width: u16le(bytes, WEBP_VP8_WIDTH_OFFSET) & WEBP_VP8_DIMENSION_MASK,
        height: u16le(bytes, WEBP_VP8_HEIGHT_OFFSET) & WEBP_VP8_DIMENSION_MASK,
      }
    }
    case 'VP8L': {
      if (bytes.length < WEBP_VP8L_BITS_OFFSET + BYTES_PER_U32) {
        return undefined
      }
      const [b0, b1, b2, b3] = bytes.subarray(
        WEBP_VP8L_BITS_OFFSET,
        WEBP_VP8L_BITS_OFFSET + BYTES_PER_U32,
      )
      const width = 1 + ((b0 ?? 0) | (((b1 ?? 0) & VP8L_WIDTH_HIGH_MASK) << BITS_PER_BYTE))
      const height =
        1 +
        (((b1 ?? 0) >> VP8L_HEIGHT_LOW_SHIFT) |
          ((b2 ?? 0) << VP8L_HEIGHT_MID_SHIFT) |
          (((b3 ?? 0) & VP8L_HEIGHT_HIGH_MASK) << VP8L_HEIGHT_HIGH_SHIFT))
      return { mediaType: 'image/webp', width, height }
    }
    case 'VP8X': {
      if (bytes.length < WEBP_VP8X_HEIGHT_OFFSET + BYTES_PER_U24) {
        return undefined
      }
      return {
        mediaType: 'image/webp',
        width: 1 + u24le(bytes, WEBP_VP8X_WIDTH_OFFSET),
        height: 1 + u24le(bytes, WEBP_VP8X_HEIGHT_OFFSET),
      }
    }
    default: {
      return undefined
    }
  }
}

function readWebp(bytes: Uint8Array): ImageInfo | undefined {
  const isWebp =
    hasSignature(bytes, RIFF) &&
    hasSignature(bytes, WEBP, WEBP_FORMAT_OFFSET) &&
    bytes.length >= WEBP_CHUNK_OFFSET + FOURCC_LENGTH
  return isWebp ? readWebpChunk(bytes, ascii(bytes, WEBP_CHUNK_OFFSET, FOURCC_LENGTH)) : undefined
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  return readPng(bytes) ?? readGif(bytes) ?? readJpeg(bytes) ?? readWebp(bytes)
}
