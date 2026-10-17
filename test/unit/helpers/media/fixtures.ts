// Bounded header fixtures for sniffing, not playable clips or live wire captures.
// Built at run time; no binary assets are committed.
import { Buffer } from 'node:buffer'

function box(type: string, body: Uint8Array): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(header.length + body.byteLength)
  header.write(type, 4, 'ascii')
  return Buffer.concat([header, body])
}

export interface VideoFixtureOptions {
  readonly brand?: 'isom' | 'mp42' | 'avc1' | 'qt  ' | 'M4A '
  readonly durationSeconds?: number
  readonly width?: number
  readonly height?: number
  readonly soundtrack?: boolean
  readonly moovLast?: boolean
  readonly fragmented?: boolean
  readonly oversizedMoov?: boolean
}

/** mvhd v0, tkhd v0 and hdlr: the metadata D85.4's sniffer reads. */
export function videoFixture(options: VideoFixtureOptions = {}): Uint8Array {
  const brand = options.brand ?? 'isom'
  const ftyp = box('ftyp', Buffer.concat([Buffer.from(brand), Buffer.alloc(4), Buffer.from(brand)]))
  const mvhd = Buffer.alloc(100)
  mvhd.writeUInt32BE(1000, 12)
  mvhd.writeUInt32BE((options.durationSeconds ?? 10) * 1000, 16)
  const tkhd = Buffer.alloc(84)
  tkhd.writeUInt32BE((options.width ?? 640) * 65_536, 76)
  tkhd.writeUInt32BE((options.height ?? 480) * 65_536, 80)
  const handler = (kind: string) => {
    const body = Buffer.alloc(24)
    body.write(kind, 8, 'ascii')
    return box('hdlr', body)
  }
  const videoTrack = box('trak', Buffer.concat([box('tkhd', tkhd), box('mdia', handler('vide'))]))
  const audioTrack =
    options.soundtrack === false ? Buffer.alloc(0) : box('trak', box('mdia', handler('soun')))
  const moov = box('moov', Buffer.concat([box('mvhd', mvhd), videoTrack, audioTrack]))
  if (options.oversizedMoov === true) moov.writeUInt32BE(0xff_ff_ff_ff)
  const media = box('mdat', Buffer.alloc(16))
  const fragment = options.fragmented === true ? box('moof', Buffer.alloc(8)) : Buffer.alloc(0)
  return Uint8Array.from(
    options.moovLast === true
      ? Buffer.concat([ftyp, media, fragment, moov])
      : Buffer.concat([ftyp, moov, fragment, media]),
  )
}

export function wavFixture(durationSeconds = 1): Uint8Array {
  const sampleRate = 8000
  const bytes = Buffer.alloc(44 + durationSeconds * sampleRate * 2)
  bytes.write('RIFF')
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  return Uint8Array.from(bytes)
}

/** MPEG1 layer III 128 kb/s, 44.1 kHz; headers only, with optional ID3v2. */
export function mp3Fixture(hasId3 = true): Uint8Array {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0])
  const tag = hasId3 ? Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]) : Buffer.alloc(0)
  return Uint8Array.from(Buffer.concat([tag, frame, frame]))
}

/** Minimal EBML header with the DocType that distinguishes WebM and Matroska. */
export function ebmlFixture(docType: 'webm' | 'matroska' = 'webm'): Uint8Array {
  const type = Buffer.from(docType)
  const body = Buffer.concat([Buffer.from([0x42, 0x82, 0x80 | type.length]), type])
  return Uint8Array.from(
    Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length]), body]),
  )
}
