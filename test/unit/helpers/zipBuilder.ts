// Builds ZIP archives for the runtime bundle's tests (M81 A1): well-formed
// ones like the pinned Chrome-for-Testing archives (stored or deflate, no
// data descriptor, Unix modes), and malformed ones field by field.
import { Buffer } from 'node:buffer'
import { deflateRawSync } from 'node:zlib'

export interface ZipFileSpec {
  readonly name: string
  readonly data: Buffer
  readonly method?: 0 | 8 | 12
  /** Unix mode with its file type (0o100644 for a regular file). */
  readonly mode?: number
  readonly flags?: number
  readonly extra?: Buffer
  /** The declared uncompressed size, if not the data's. */
  readonly size?: number
  /** The declared CRC, if not the data's. */
  readonly crc?: number
  /** What the local header says instead, where a test makes them disagree. */
  readonly local?: { readonly name?: string; readonly flags?: number; readonly crc?: number }
  /** Compressed bytes to store instead of compressing `data`. */
  readonly compressed?: Buffer
  readonly dosAttributes?: number
}

export interface ZipOptions {
  readonly comment?: string
  readonly zip64Locator?: boolean
  readonly disk?: number
  /** The entry count the end record declares, if not the real one. */
  readonly count?: number
  /** Bytes put before the first entry (a prefix the directory offset skips). */
  readonly gapBeforeDirectory?: number
}

/** CRC-32 bit by bit, independent of the reader's table, so a fault in either shows. */
export function crc32(data: Uint8Array): number {
  let value = 0xff_ff_ff_ff
  for (const byte of data) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xed_b8_83_20 & -(value & 1))
    }
  }
  return (value ^ 0xff_ff_ff_ff) >>> 0
}

export function buildZip(files: readonly ZipFileSpec[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const method = file.method ?? 8
    const compressed = file.compressed ?? (method === 8 ? deflateRawSync(file.data) : file.data)
    const crc = file.crc ?? crc32(file.data)
    const size = file.size ?? file.data.length
    const flags = file.flags ?? 0
    const name = Buffer.from(file.name, 'latin1')
    const localName = Buffer.from(file.local?.name ?? file.name, 'latin1')
    const extra = file.extra ?? Buffer.alloc(0)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04_03_4b_50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(file.local?.flags ?? flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(file.local?.crc ?? crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(localName.length, 26)
    local.writeUInt16LE(extra.length, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02_01_4b_50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt32LE((((file.mode ?? 0o10_0644) << 16) | (file.dosAttributes ?? 0)) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, localName, extra, compressed)
    centrals.push(central, name, extra)
    offset += local.length + localName.length + extra.length + compressed.length
  }
  const gap = Buffer.alloc(options.gapBeforeDirectory ?? 0)
  const directory = Buffer.concat(centrals)
  const comment = Buffer.from(options.comment ?? '', 'latin1')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06_05_4b_50, 0)
  end.writeUInt16LE(options.disk ?? 0, 4)
  end.writeUInt16LE(options.count ?? files.length, 8)
  end.writeUInt16LE(options.count ?? files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset + gap.length, 16)
  end.writeUInt16LE(comment.length, 20)
  const locator = Buffer.alloc(options.zip64Locator === true ? 20 : 0)
  if (options.zip64Locator === true) {
    locator.writeUInt32LE(0x07_06_4b_50, 0)
  }
  return Buffer.concat([...locals, gap, directory, locator, end, comment])
}
