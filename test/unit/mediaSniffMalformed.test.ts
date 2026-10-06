import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { sniffMedia, sniffMediaBytes } from '../../src/core/media/limits'
import { MEDIA_SNIFF_MAX_BYTES } from '../../src/shared/constants'
import { sniffEbml } from '../../src/core/media/sniff/ebml'
import { ebmlFixture, mp3Fixture, videoFixture, wavFixture } from './helpers/media/fixtures'

describe('M105 hostile and partial metadata', () => {
  it('refuses unknown/malformed ftyp brands and malformed movie/track/media boxes', () => {
    const unknown = Buffer.from(videoFixture())
    unknown.write('xxxx', 8)
    unknown.write('xxxx', 16)
    const shortBrand = Buffer.from(videoFixture())
    shortBrand.writeUInt32BE(19)
    const shortLarge = Buffer.from([0, 0, 0, 1, 0x66, 0x74, 0x79, 0x70])
    const shortStandalone = Buffer.from([
      0, 0, 0, 15, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0,
    ])
    const oddStandalone = Buffer.concat([
      Buffer.from([0, 0, 0, 17]),
      Buffer.from('ftypisom'),
      Buffer.alloc(5),
    ])
    for (const type of ['trak', 'mdia', 'hdlr']) {
      const bytes = Buffer.from(videoFixture())
      bytes.writeUInt32BE(7, bytes.indexOf(type) - 4)
      expect(sniffMediaBytes(bytes)).toBeUndefined()
    }
    for (const bytes of [unknown, shortBrand, shortLarge, shortStandalone, oddStandalone])
      expect(sniffMediaBytes(bytes)).toBeUndefined()
  })

  it('does not invent sound or dimensions from missing/unreadable track fields', () => {
    for (const type of ['hdlr', 'tkhd']) {
      const bytes = Buffer.from(videoFixture({ soundtrack: false }))
      bytes.write('xxxx', bytes.indexOf(type))
      const info = sniffMediaBytes(bytes)
      if (type === 'hdlr') expect(info).toBeUndefined()
      else {
        expect(info).toBeDefined()
        expect(info).not.toHaveProperty('width')
      }
    }
    const version = Buffer.from(videoFixture())
    version[version.indexOf('tkhd') + 4] = 2
    expect(sniffMediaBytes(version)).not.toHaveProperty('width')
  })

  it('refuses duplicate/unknown EBML DocTypes and malformed lengths', () => {
    const header = Buffer.from(ebmlFixture())
    const duplicate = Buffer.concat([header, header.subarray(5)])
    duplicate[4] = 0x80 | (duplicate.length - 5)
    const unknown = Buffer.from(header)
    unknown.write('xxxx', unknown.indexOf('webm'))
    const shortType = Buffer.from(header)
    shortType[4] = 0x81
    const shortLength = Buffer.from(header)
    shortLength[4] = 0x82
    const hugeType = Buffer.from(header)
    hugeType[7] = 0xfe
    const invalidId = Buffer.from(header)
    invalidId[0] = 0x08
    for (const bytes of [duplicate, unknown, shortType, shortLength, hugeType, invalidId])
      expect(sniffMediaBytes(bytes)).toBeUndefined()
    expect(sniffEbml(header, header.length - 1)).toBeUndefined()
  })

  it('refuses RIFF boundaries, short fmt and zero block alignment before deriving duration', () => {
    const badRiff = Buffer.from(wavFixture())
    badRiff.writeUInt32LE(2, 4)
    const shortChunk = Buffer.from(wavFixture())
    shortChunk.writeUInt32LE(5, 4)
    const badChunk = Buffer.from(wavFixture())
    badChunk.writeUInt32LE(0xff_ff_ff_ff, 40)
    const shortFormat = Buffer.from(wavFixture())
    shortFormat.writeUInt32LE(8, 16)
    const borrowedFormat = Buffer.concat([
      shortFormat.subarray(0, 28),
      Buffer.from('JUNK'),
      Buffer.from([2, 0, 0, 0, 0, 0]),
      shortFormat.subarray(36),
    ])
    borrowedFormat.writeUInt32LE(borrowedFormat.length - 8, 4)
    const badAlign = Buffer.from(wavFixture())
    badAlign.writeUInt16LE(0, 32)
    for (const bytes of [badRiff, shortChunk, badChunk, shortFormat, borrowedFormat, badAlign])
      expect(sniffMediaBytes(bytes)).toBeUndefined()
  })

  it('validates MP3 version/layer/sync/rate and ID3 version/size boundaries', () => {
    for (const flags of [0xeb, 0xff, 0x1b]) {
      const bytes = Buffer.from(mp3Fixture(false))
      bytes[1] = flags
      expect(sniffMediaBytes(bytes)).toBeUndefined()
    }
    const reservedRate = Buffer.from(mp3Fixture(false))
    reservedRate[2] = 0x9c
    expect(sniffMediaBytes(reservedRate)).toBeUndefined()
    const invalidPrefix = Buffer.from(mp3Fixture(false))
    invalidPrefix[0] = 0
    expect(sniffMediaBytes(invalidPrefix)).toBeUndefined()
    for (const [offset, value] of [
      [3, 1],
      [4, 0xff],
    ]) {
      const tagged = Buffer.from(mp3Fixture())
      tagged[offset!] = value!
      expect(sniffMediaBytes(tagged)).toBeUndefined()
    }
    const badSynchsafe = Buffer.concat([
      Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0x80]),
      Buffer.alloc(128),
      Buffer.from(mp3Fixture(false)),
    ])
    expect(sniffMediaBytes(badSynchsafe)).toBeUndefined()
    for (const bytes of [
      Buffer.from('ID3'),
      Buffer.from([0x49, 0x44, 0x33, 1, 0, 0, 0, 0, 0, 0]),
      Buffer.from([0x49, 0x44, 0x33, 3, 0xff, 0, 0, 0, 0, 0]),
      Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]),
    ])
      expect(sniffMediaBytes(bytes)).toBeUndefined()
  })

  it('reads MPEG2/2.5 and CRC/mono/Xing plus an ID3v2.4 footer', () => {
    for (const [flags, length, samples, rate] of [
      [0xf3, 261, 576, 22_050],
      [0xe3, 522, 576, 11_025],
    ]) {
      const frame = Buffer.alloc(length!)
      frame.set([0xff, flags!, 0x90, 0xc0])
      expect(sniffMediaBytes(Buffer.concat([frame, frame]))?.durationSeconds).toBeCloseTo(
        (2 * samples!) / rate!,
      )
    }
    const mono = Buffer.from(mp3Fixture(false))
    mono[1] = 0xfa
    mono[3] = 0xc0
    mono.write('Xing', 23)
    mono.writeUInt32BE(1, 27)
    mono.writeUInt32BE(100, 31)
    expect(sniffMediaBytes(mono)?.durationSeconds).toBeCloseTo((100 * 1152) / 44_100)
    const footerTag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0, 0])
    expect(
      sniffMediaBytes(Buffer.concat([footerTag, Buffer.alloc(10), Buffer.from(mp3Fixture(false))]))
        ?.durationSeconds,
    ).toBeCloseTo((2 * 1152) / 44_100)
  })

  it('keeps a large ID3 tag unknown rather than reading outside the windows', async () => {
    const tagSize = MEDIA_SNIFF_MAX_BYTES * 2
    const tag = Buffer.alloc(tagSize + 10)
    tag.write('ID3')
    tag[3] = 3
    tag[6] = (tagSize >> 21) & 0x7f
    tag[7] = (tagSize >> 14) & 0x7f
    tag[8] = (tagSize >> 7) & 0x7f
    tag[9] = tagSize & 0x7f
    const bytes = Buffer.concat([tag, Buffer.from(mp3Fixture(false))])
    expect(
      await sniffMedia({
        sizeBytes: bytes.length,
        read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
      }),
    ).toMatchObject({ ok: true, info: { mediaType: 'audio/mpeg', durationSeconds: null } })
  })

  it('rejects incorrect head/tail read lengths even when the bytes would otherwise parse', async () => {
    const clip = Buffer.from(videoFixture())
    for (const returned of [clip.subarray(0, -1), Buffer.concat([clip, Buffer.alloc(1)])])
      expect(
        await sniffMedia({ sizeBytes: clip.length, read: () => Promise.resolve(returned) }),
      ).toMatchObject({ ok: false })
    const ftyp = clip.subarray(0, 20)
    const movie = clip.subarray(20, clip.indexOf('mdat') - 4)
    const mdat = Buffer.alloc(MEDIA_SNIFF_MAX_BYTES * 2)
    mdat.writeUInt32BE(mdat.length)
    mdat.write('mdat', 4)
    const bytes = Buffer.concat([ftyp, mdat, movie])
    for (const difference of [-1, 1])
      expect(
        await sniffMedia({
          sizeBytes: bytes.length,
          read: (offset, length) =>
            Promise.resolve(
              offset === 0
                ? bytes.subarray(0, length)
                : bytes.subarray(offset - difference, offset + length),
            ),
        }),
      ).toMatchObject({ ok: false })
  })
})
