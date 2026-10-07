import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { checkMediaLimits, sniffMedia, sniffMediaBytes } from '../../src/core/media/limits'
import { MEDIA_SNIFF_MAX_BYTES } from '../../src/shared/constants'
import { ebmlFixture, mp3Fixture, videoFixture, wavFixture } from './helpers/media/fixtures'

function box(type: string, body: Uint8Array, isLarge = false): Buffer {
  const header = Buffer.alloc(isLarge ? 16 : 8)
  header.writeUInt32BE(isLarge ? 1 : header.length + body.length)
  header.write(type, 4)
  if (isLarge) header.writeBigUInt64BE(BigInt(header.length + body.length), 8)
  return Buffer.concat([header, body])
}

function splitVideo(bytes: Uint8Array = videoFixture()) {
  const buffer = Buffer.from(bytes)
  const moov = buffer.indexOf('moov') - 4
  const end = moov + buffer.readUInt32BE(moov)
  return { ftyp: buffer.subarray(0, moov), moov: buffer.subarray(moov, end) }
}

function source(bytes: Uint8Array) {
  return {
    sizeBytes: bytes.length,
    read: vi.fn((offset: number, length: number) =>
      Promise.resolve(bytes.subarray(offset, offset + length)),
    ),
  }
}

describe('M105 bounded media sniffing', () => {
  it.each(['isom', 'mp42', 'avc1', 'qt  '] as const)(
    'reads %s metadata with moov first/last, sound and fragmentation',
    (brand) => {
      for (const isMoovLast of [false, true])
        for (const isSoundtrack of [false, true])
          for (const isFragmented of [false, true]) {
            const bytes = videoFixture({
              brand,
              moovLast: isMoovLast,
              soundtrack: isSoundtrack,
              fragmented: isFragmented,
              durationSeconds: 134,
              width: 1920,
              height: 1080,
            })
            expect(sniffMediaBytes(bytes)).toEqual({
              kind: 'video',
              mediaType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4',
              durationSeconds: 134,
              width: 1920,
              height: 1080,
              hasSoundtrack: isSoundtrack,
              sizeBytes: bytes.length,
            })
          }
    },
  )

  it('finds a tail moov by skipping a large mdat while total reads stay bounded', async () => {
    const { ftyp, moov } = splitVideo()
    const bytes = Buffer.concat([ftyp, box('mdat', Buffer.alloc(MEDIA_SNIFF_MAX_BYTES * 2)), moov])
    const reader = source(bytes)
    expect(await sniffMedia(reader)).toMatchObject({
      ok: true,
      info: {
        durationSeconds: 10,
        hasSoundtrack: true,
        width: 640,
        height: 480,
        sizeBytes: bytes.length,
      },
    })
    expect(reader.read.mock.calls).toEqual([
      [0, MEDIA_SNIFF_MAX_BYTES / 2],
      [bytes.length - MEDIA_SNIFF_MAX_BYTES / 2, MEDIA_SNIFF_MAX_BYTES / 2],
    ])
    expect(reader.read.mock.calls.reduce((sum, call) => sum + call[1], 0)).toBeLessThanOrEqual(
      MEDIA_SNIFF_MAX_BYTES,
    )
  })

  it('refuses unknown track kind when moov is outside both windows and ignores payload decoys', async () => {
    const { ftyp, moov } = splitVideo()
    const mdat = box('mdat', Buffer.alloc(MEDIA_SNIFF_MAX_BYTES * 2))
    const bytes = Buffer.concat([ftyp, mdat, moov, mdat])
    moov.copy(bytes, bytes.length - moov.length)
    expect(await sniffMedia(source(bytes))).toMatchObject({ ok: false })
  })

  it('reads version-one headers, extended boxes and compatible brands', () => {
    const mvhd = Buffer.alloc(112)
    mvhd[0] = 1
    mvhd.writeUInt32BE(1000, 20)
    mvhd.writeBigUInt64BE(134_500n, 24)
    const tkhd = Buffer.alloc(96)
    tkhd[0] = 1
    tkhd.writeUInt32BE(1920 * 65_536, 88)
    tkhd.writeUInt32BE(1080 * 65_536, 92)
    const hdlr = Buffer.alloc(24)
    hdlr.write('vide', 8)
    const ftyp = box(
      'ftyp',
      Buffer.concat([Buffer.from('zzzz'), Buffer.alloc(4), Buffer.from('isom')]),
      true,
    )
    const moov = box(
      'moov',
      Buffer.concat([
        box('mvhd', mvhd),
        box('trak', Buffer.concat([box('tkhd', tkhd), box('mdia', box('hdlr', hdlr))])),
      ]),
      true,
    )
    expect(sniffMediaBytes(Buffer.concat([ftyp, moov]))).toMatchObject({
      mediaType: 'video/mp4',
      durationSeconds: 134.5,
      width: 1920,
      height: 1080,
      hasSoundtrack: false,
    })
    mvhd.writeBigUInt64BE(0xff_ff_ff_ff_ff_ff_ff_ffn, 24)
    const tracks = Buffer.from(videoFixture()).subarray(136, -24)
    expect(
      sniffMediaBytes(
        Buffer.concat([ftyp, box('moov', Buffer.concat([box('mvhd', mvhd), tracks]))]),
      ),
    ).toMatchObject({
      durationSeconds: null,
    })
  })

  it('keeps zero, unknown and invalid metadata unknown instead of inventing values', () => {
    const bytes = Buffer.from(videoFixture())
    const duration = bytes.indexOf('mvhd') + 20
    for (const value of [0, 0xff_ff_ff_ff]) {
      bytes.writeUInt32BE(value, duration)
      expect(sniffMediaBytes(bytes)).toMatchObject({ durationSeconds: null })
    }
    const tkhd = bytes.indexOf('tkhd') + 80
    bytes.writeUInt32BE(0, tkhd)
    expect(sniffMediaBytes(bytes)).not.toHaveProperty('width')
    bytes[bytes.indexOf('mvhd') + 4] = 2
    expect(sniffMediaBytes(bytes)).toMatchObject({ durationSeconds: null })
    bytes.writeUInt32BE(0, bytes.indexOf('mvhd') + 16)
    expect(sniffMediaBytes(bytes)).toMatchObject({ durationSeconds: null })
  })

  it('rejects truncated files, huge/unsafe boxes and malformed nested boxes', () => {
    const bytes = Buffer.from(videoFixture())
    const badTrack = Buffer.from(bytes)
    badTrack.writeUInt32BE(7, badTrack.indexOf('trak') - 4)
    const unsafe = Buffer.from(box('ftyp', Buffer.alloc(12), true))
    unsafe.writeBigUInt64BE(0xff_ff_ff_ff_ff_ff_ff_ffn, 8)
    for (const malformed of [
      bytes.subarray(0, 7),
      bytes.subarray(0, -1),
      videoFixture({ oversizedMoov: true }),
      badTrack,
      unsafe,
      Buffer.concat([bytes, Buffer.from([1])]),
    ])
      expect(sniffMediaBytes(malformed)).toBeUndefined()
  })

  it('distinguishes WebM, Matroska and m4a by bytes, independent of filenames', () => {
    expect(sniffMediaBytes(ebmlFixture())).toMatchObject({
      kind: 'video',
      mediaType: 'video/webm',
      durationSeconds: null,
      hasSoundtrack: null,
    })
    expect(sniffMediaBytes(ebmlFixture('matroska'))).toMatchObject({
      mediaType: 'video/x-matroska',
    })
    for (const bytes of [
      ebmlFixture().subarray(0, 5),
      Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0xff]),
      Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0]),
    ])
      expect(sniffMediaBytes(bytes)).toBeUndefined()
  })

  it('classifies M4A and audio-only MP4 from tracks and blocks video-only admission', () => {
    for (const brand of ['M4A ', 'isom', 'qt  '] as const) {
      const bytes = Buffer.from(videoFixture({ brand }))
      bytes.write('free', bytes.indexOf('trak'))
      const info = sniffMediaBytes(bytes)!
      expect(info).toEqual({
        kind: 'audio',
        mediaType: 'audio/mp4',
        durationSeconds: 10,
        sizeBytes: bytes.length,
      })
      expect(checkMediaLimits(info, { acceptedMediaTypes: ['video/mp4'] }).ok).toBe(false)
      expect(checkMediaLimits(info, { acceptedMediaTypes: ['audio/mp4'] }).ok).toBe(true)
    }
    expect(sniffMediaBytes(videoFixture({ brand: 'M4A ' }))).toMatchObject({
      kind: 'video',
      mediaType: 'video/mp4',
    })
    const malformed = Buffer.from(videoFixture())
    malformed.writeUInt32BE(7, malformed.indexOf('hdlr') - 4)
    expect(sniffMediaBytes(malformed)).toBeUndefined()
  })

  it('reads wav duration from fmt/data, skips padded chunks, refuses truncation', () => {
    expect(sniffMediaBytes(wavFixture(2))).toMatchObject({
      kind: 'audio',
      mediaType: 'audio/wav',
      durationSeconds: 2,
    })
    const wav = Buffer.from(wavFixture())
    const padded = Buffer.concat([
      wav.subarray(0, 36),
      Buffer.from('JUNK'),
      Buffer.from([1, 0, 0, 0, 1, 0]),
      wav.subarray(36),
    ])
    padded.writeUInt32LE(padded.length - 8, 4)
    expect(sniffMediaBytes(padded)).toMatchObject({ durationSeconds: 1 })
    wav.writeUInt16LE(6, 20)
    expect(sniffMediaBytes(wav)).toMatchObject({ durationSeconds: null })
    wav.writeUInt32LE(0, 28)
    expect(sniffMediaBytes(wav)).toBeUndefined()
    expect(sniffMediaBytes(wavFixture().subarray(0, 42))).toBeUndefined()
  })

  it.each([true, false])('validates mp3 with ID3=%s and counts complete frames', (tagged) => {
    const info = sniffMediaBytes(mp3Fixture(tagged))
    expect(info).toMatchObject({ kind: 'audio', mediaType: 'audio/mpeg' })
    expect(info?.kind === 'audio' && info.durationSeconds).toBeCloseTo((2 * 1152) / 44_100)
    expect(sniffMediaBytes(mp3Fixture(tagged).subarray(0, 80))).toBeUndefined()
  })

  it('refuses invalid ID3 sizes, reserved/free-rate frames and trailing garbage', () => {
    const badTag = Buffer.from(mp3Fixture())
    badTag[6] = 0x80
    const badRate = Buffer.from(mp3Fixture(false))
    badRate[2] = 0xfc
    const freeRate = Buffer.from(mp3Fixture(false))
    freeRate[2] = 0
    for (const bytes of [
      badTag,
      badRate,
      freeRate,
      Buffer.concat([Buffer.from(mp3Fixture(false)), Buffer.from([1, 2, 3])]),
      Buffer.from([0xff, 0xff]),
    ])
      expect(sniffMediaBytes(bytes)).toBeUndefined()
  })

  it('uses Xing/VBRI frame counts, and never guesses duration for partial CBR/VBR', async () => {
    for (const type of ['Xing', 'Info', 'VBRI']) {
      const bytes = Buffer.from(mp3Fixture(false))
      bytes.write(type, 36)
      if (type === 'VBRI') {
        bytes.writeUInt32BE(100, 50)
      } else {
        bytes.writeUInt32BE(1, 40)
        bytes.writeUInt32BE(100, 44)
      }
      expect(sniffMediaBytes(bytes)?.durationSeconds).toBeCloseTo((100 * 1152) / 44_100)
    }
    const frame = Buffer.from(mp3Fixture(false)).subarray(0, 417)
    const bytes = Buffer.concat(Array.from({ length: 3000 }, () => frame))
    expect(await sniffMedia(source(bytes))).toMatchObject({
      ok: true,
      info: { durationSeconds: null },
    })
    const footer = Buffer.alloc(128)
    footer.write('TAG')
    expect(sniffMediaBytes(Buffer.concat([Buffer.from(mp3Fixture(false)), footer]))).toMatchObject({
      durationSeconds: (2 * 1152) / 44_100,
    })
  })

  it('rejects invalid size, short/oversized reads and reader failures explicitly', async () => {
    for (const sizeBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const read = vi.fn(() => Promise.resolve(videoFixture()))
      expect(await sniffMedia({ sizeBytes, read })).toMatchObject({
        ok: false,
        reason: expect.any(String),
      })
      expect(read).not.toHaveBeenCalled()
    }
    for (const length of [1, 101])
      expect(
        await sniffMedia({ sizeBytes: 100, read: () => Promise.resolve(new Uint8Array(length)) }),
      ).toMatchObject({ ok: false })
    expect(
      await sniffMedia({ sizeBytes: 100, read: () => Promise.reject(new Error('private path')) }),
    ).toMatchObject({ ok: false, reason: expect.not.stringContaining('private') })
  })
})
