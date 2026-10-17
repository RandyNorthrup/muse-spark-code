// The runtime bundle's bounded ZIP reader (M81 A1, design spec v4 §4.3):
// only what the pinned Chrome-for-Testing archives use, as captured from all
// four (docs/certification/m81.md): one disk, no ZIP64, no comment, no
// encryption, no data descriptors, stored or deflate entries, regular files
// only. Everything is bounded before it is allocated or written: the
// end-of-central-directory search, the directory's size, the entry count,
// each name, every declared size against the 400 MiB total and the pin's
// own totals. Central and local headers must agree byte for byte where they
// overlap; entry data must not overlap another entry or the directory.
//
// Inflation streams with backpressure, and every output chunk is counted
// before it is written: an entry that inflates past its declared size, or
// past what the total still allows, stops there. Each entry's length and
// CRC-32 are checked after it ends. Names are plain ASCII paths whose every
// segment is safe on Windows, macOS and Linux (no traversal, drive, UNC,
// backslash, colon, reserved device name, trailing dot or space), unique
// case-insensitively, with no file standing where another needs a folder;
// every final path is checked to stay inside the destination, and every
// file is created exclusively, private (0600, the pin's executable entries
// 0700), without the archive's own mode bits.

import { createReadStream, createWriteStream } from 'node:fs'
import { type FileHandle, lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw } from 'node:zlib'
import {
  BROWSER_RUNTIME_EOCD_SEARCH_BYTES,
  BROWSER_RUNTIME_MAX_ENTRIES,
  BROWSER_RUNTIME_MAX_EXTRACTED_BYTES,
  BROWSER_RUNTIME_MAX_NAME_BYTES,
} from '../../../shared/browserCheckConstants'

/** The archive is not one this reader accepts; the reason never leaves the bundle. */
export class ZipRefused extends Error {
  public constructor(reason: string) {
    super(reason)
    this.name = 'ZipRefused'
  }
}

export interface ZipEntry {
  readonly name: string
  readonly method: number
  readonly crc: number
  readonly compressedSize: number
  readonly size: number
  /** Where its data starts, after its local header. */
  readonly dataOffset: number
}

export interface ExtractPlan {
  readonly entryCount: number
  readonly extractedBytes: number
  /** Names created 0700; every other file is 0600. */
  readonly executableEntries: ReadonlySet<string>
}

const EOCD_SIGNATURE = 0x06_05_4b_50
const EOCD_MARK = Buffer.from('504b0506', 'hex')
const ZIP64_LOCATOR_SIGNATURE = 0x07_06_4b_50
const CENTRAL_SIGNATURE = 0x02_01_4b_50
const LOCAL_SIGNATURE = 0x04_03_4b_50
const EOCD_BYTES = 22
const ZIP64_LOCATOR_BYTES = 20
const CENTRAL_BYTES = 46
const LOCAL_BYTES = 30
const MAX_U16 = 0xff_ff
const MAX_U32 = 0xff_ff_ff_ff
const METHOD_STORED = 0
const METHOD_DEFLATE = 8
// General-purpose flags allowed: deflate's level bits (1, 2) and UTF-8 names
// (11). Encryption (0, 6), a data descriptor (3) and masked headers (13) refuse.
const ALLOWED_FLAGS = 0b0000_1000_0000_0110
const ZIP64_EXTRA = 0x00_01
const UNIX_TYPE_MASK = 0o17_0000
const UNIX_REGULAR = 0o10_0000
const DOS_DIRECTORY = 0x10
const DOS_VOLUME = 0x08
const SHIFT_UNIX_MODE = 16
// Field offsets inside each record (PKWARE APPNOTE.TXT §4.3).
const EOCD_AT = {
  disk: 4,
  directoryDisk: 6,
  onDisk: 8,
  count: 10,
  length: 12,
  offset: 16,
  commentLength: 20,
} as const
const CENTRAL_AT = {
  flags: 8,
  method: 10,
  crc: 16,
  compressedSize: 20,
  size: 24,
  nameLength: 28,
  extraLength: 30,
  commentLength: 32,
  diskStart: 34,
  external: 38,
  localOffset: 42,
} as const
const LOCAL_AT = {
  flags: 6,
  method: 8,
  crc: 14,
  compressedSize: 18,
  size: 22,
  nameLength: 26,
  extraLength: 28,
} as const
// An extra field's header: its id, then its data's length (two bytes each).
const EXTRA_HEADER_BYTES = 4
const EXTRA_LENGTH_AT = 2
const CRC_POLYNOMIAL = 0xed_b8_83_20
const BYTE_VALUES = 256
const BYTE_MASK = 0xff
const BITS_PER_BYTE = 8
const MAX_CENTRAL_DIRECTORY_BYTES = BROWSER_RUNTIME_MAX_ENTRIES * (CENTRAL_BYTES + 2 * MAX_U16)
const PRIVATE_DIR_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const EXECUTABLE_MODE = 0o700
// Printable ASCII only: the pinned archives' names are.
const PRINTABLE = /^[ -~]+$/
const UNSAFE_CHARACTERS = /[\\:<>"|?*]/
const RESERVED_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i

// CRC-32 (IEEE 802.3), as ZIP stores it.
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(BYTE_VALUES)
  for (let index = 0; index < BYTE_VALUES; index += 1) {
    let value = index
    for (let bit = 0; bit < BITS_PER_BYTE; bit += 1) {
      value = value & 1 ? CRC_POLYNOMIAL ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

function crcUpdate(crc: number, chunk: Uint8Array): number {
  let value = ~crc >>> 0
  for (const byte of chunk) {
    value = (CRC_TABLE[(value ^ byte) & BYTE_MASK] ?? 0) ^ (value >>> BITS_PER_BYTE)
  }
  return ~value >>> 0
}

async function readAt(file: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await file.read(buffer, 0, length, offset)
  if (bytesRead !== length) {
    throw new ZipRefused('short read')
  }
  return buffer
}

/** Whether a name is a safe relative path: every segment plain, the whole printable ASCII. */
function isSafeName(name: string): boolean {
  return (
    PRINTABLE.test(name) &&
    !name.endsWith('/') &&
    name
      .split('/')
      .every(
        (segment) =>
          segment !== '' &&
          segment !== '.' &&
          segment !== '..' &&
          !UNSAFE_CHARACTERS.test(segment) &&
          !segment.endsWith('.') &&
          !segment.endsWith(' ') &&
          !RESERVED_NAME.test(segment),
      )
  )
}

/** Duplicates and file/folder collisions, case-insensitively (macOS and Windows fold case). */
function checkNames(names: readonly string[]): void {
  const files = new Set<string>()
  const folders = new Set<string>()
  for (const name of names) {
    const folded = name.toLowerCase()
    if (files.has(folded)) {
      throw new ZipRefused('duplicate name')
    }
    files.add(folded)
    const segments = folded.split('/')
    for (let end = 1; end < segments.length; end += 1) {
      folders.add(segments.slice(0, end).join('/'))
    }
  }
  for (const file of files) {
    if (folders.has(file)) {
      throw new ZipRefused('a file where a folder is needed')
    }
  }
}

/** The end of central directory: exactly at the end, one disk, no ZIP64. */
async function readEnd(
  file: FileHandle,
  size: number,
): Promise<{ readonly count: number; readonly offset: number; readonly length: number }> {
  if (size < EOCD_BYTES) {
    throw new ZipRefused('too small')
  }
  const tailLength = Math.min(size, BROWSER_RUNTIME_EOCD_SEARCH_BYTES)
  const tail = await readAt(file, size - tailLength, tailLength)
  const at = tail.lastIndexOf(EOCD_MARK)
  // No comment: the record is the file's last 22 bytes.
  if (at !== tailLength - EOCD_BYTES || tail.readUInt32LE(at) !== EOCD_SIGNATURE) {
    throw new ZipRefused('no end record')
  }
  const disk = tail.readUInt16LE(at + EOCD_AT.disk)
  const directoryDisk = tail.readUInt16LE(at + EOCD_AT.directoryDisk)
  const onDisk = tail.readUInt16LE(at + EOCD_AT.onDisk)
  const count = tail.readUInt16LE(at + EOCD_AT.count)
  const length = tail.readUInt32LE(at + EOCD_AT.length)
  const offset = tail.readUInt32LE(at + EOCD_AT.offset)
  const commentLength = tail.readUInt16LE(at + EOCD_AT.commentLength)
  const eocdOffset = size - EOCD_BYTES
  const locatorAt = at - ZIP64_LOCATOR_BYTES
  const hasZip64 = locatorAt >= 0 && tail.readUInt32LE(locatorAt) === ZIP64_LOCATOR_SIGNATURE
  if (
    hasZip64 ||
    disk !== 0 ||
    directoryDisk !== 0 ||
    onDisk !== count ||
    commentLength !== 0 ||
    count === 0 ||
    count === MAX_U16 ||
    length === MAX_U32 ||
    offset === MAX_U32 ||
    count > BROWSER_RUNTIME_MAX_ENTRIES ||
    length > MAX_CENTRAL_DIRECTORY_BYTES ||
    offset + length !== eocdOffset
  ) {
    throw new ZipRefused('unsupported end record')
  }
  return { count, offset, length }
}

/** An extra field's ids, bounded by its length; ZIP64's refuses. */
function checkExtra(extra: Buffer): void {
  let at = 0
  while (at < extra.length) {
    if (at + EXTRA_HEADER_BYTES > extra.length) {
      throw new ZipRefused('malformed extra field')
    }
    const id = extra.readUInt16LE(at)
    const length = extra.readUInt16LE(at + EXTRA_LENGTH_AT)
    if (id === ZIP64_EXTRA || at + EXTRA_HEADER_BYTES + length > extra.length) {
      throw new ZipRefused('unsupported extra field')
    }
    at += EXTRA_HEADER_BYTES + length
  }
}

/**
 * The archive's entries, every header checked and the local headers read
 * against the central ones, before anything is extracted.
 */
export async function readZipEntries(
  file: FileHandle,
  size: number,
  plan: ExtractPlan,
): Promise<readonly ZipEntry[]> {
  const end = await readEnd(file, size)
  if (end.count !== plan.entryCount) {
    throw new ZipRefused('entry count')
  }
  const directory = await readAt(file, end.offset, end.length)
  const entries: (ZipEntry & { readonly localOffset: number; readonly flags: number })[] = []
  let total = 0
  let at = 0
  for (let index = 0; index < end.count; index += 1) {
    if (at + CENTRAL_BYTES > directory.length || directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new ZipRefused('malformed central header')
    }
    const flags = directory.readUInt16LE(at + CENTRAL_AT.flags)
    const method = directory.readUInt16LE(at + CENTRAL_AT.method)
    const crc = directory.readUInt32LE(at + CENTRAL_AT.crc)
    const compressedSize = directory.readUInt32LE(at + CENTRAL_AT.compressedSize)
    const entrySize = directory.readUInt32LE(at + CENTRAL_AT.size)
    const nameLength = directory.readUInt16LE(at + CENTRAL_AT.nameLength)
    const extraLength = directory.readUInt16LE(at + CENTRAL_AT.extraLength)
    const commentLength = directory.readUInt16LE(at + CENTRAL_AT.commentLength)
    const diskStart = directory.readUInt16LE(at + CENTRAL_AT.diskStart)
    const external = directory.readUInt32LE(at + CENTRAL_AT.external)
    const localOffset = directory.readUInt32LE(at + CENTRAL_AT.localOffset)
    const next = at + CENTRAL_BYTES + nameLength + extraLength + commentLength
    const unixMode = (external >>> SHIFT_UNIX_MODE) & MAX_U16
    if (
      nameLength === 0 ||
      commentLength !== 0 ||
      diskStart !== 0 ||
      compressedSize === MAX_U32 ||
      entrySize === MAX_U32 ||
      localOffset === MAX_U32 ||
      nameLength > BROWSER_RUNTIME_MAX_NAME_BYTES ||
      next > directory.length ||
      (flags & ~ALLOWED_FLAGS) !== 0 ||
      (method !== METHOD_STORED && method !== METHOD_DEFLATE) ||
      (method === METHOD_STORED && compressedSize !== entrySize) ||
      (unixMode !== 0 && (unixMode & UNIX_TYPE_MASK) !== UNIX_REGULAR) ||
      (external & (DOS_DIRECTORY | DOS_VOLUME)) !== 0
    ) {
      throw new ZipRefused('unsupported central header')
    }
    const nameBytes = directory.subarray(at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameLength)
    const name = nameBytes.toString('latin1')
    if (!isSafeName(name)) {
      throw new ZipRefused('unsafe name')
    }
    checkExtra(
      directory.subarray(
        at + CENTRAL_BYTES + nameLength,
        at + CENTRAL_BYTES + nameLength + extraLength,
      ),
    )
    total += entrySize
    if (
      entrySize > BROWSER_RUNTIME_MAX_EXTRACTED_BYTES ||
      total > BROWSER_RUNTIME_MAX_EXTRACTED_BYTES
    ) {
      throw new ZipRefused('too large')
    }
    entries.push({
      name,
      method,
      crc,
      compressedSize,
      size: entrySize,
      localOffset,
      flags,
      dataOffset: 0,
    })
    at = next
  }
  if (at !== directory.length || total !== plan.extractedBytes) {
    throw new ZipRefused('directory totals')
  }
  checkNames(entries.map((entry) => entry.name))
  // Each local header, against its central one; data in order, never overlapping.
  const checked: ZipEntry[] = []
  const byOffset = entries.toSorted((left, right) => left.localOffset - right.localOffset)
  for (const [index, entry] of byOffset.entries()) {
    const local = await readAt(file, entry.localOffset, LOCAL_BYTES)
    const nameLength = local.readUInt16LE(LOCAL_AT.nameLength)
    const extraLength = local.readUInt16LE(LOCAL_AT.extraLength)
    const dataOffset = entry.localOffset + LOCAL_BYTES + nameLength + extraLength
    const dataEnd = dataOffset + entry.compressedSize
    // Contiguous, as the pinned archives are: the first entry at the start,
    // each next one where the last one's data ends, the directory after.
    const limit = byOffset[index + 1]?.localOffset ?? end.offset
    const localName = await readAt(file, entry.localOffset + LOCAL_BYTES, nameLength)
    checkExtra(await readAt(file, entry.localOffset + LOCAL_BYTES + nameLength, extraLength))
    if (
      dataEnd !== limit ||
      (index === 0 && entry.localOffset !== 0) ||
      local.readUInt32LE(0) !== LOCAL_SIGNATURE ||
      local.readUInt16LE(LOCAL_AT.flags) !== entry.flags ||
      local.readUInt16LE(LOCAL_AT.method) !== entry.method ||
      local.readUInt32LE(LOCAL_AT.crc) !== entry.crc ||
      local.readUInt32LE(LOCAL_AT.compressedSize) !== entry.compressedSize ||
      local.readUInt32LE(LOCAL_AT.size) !== entry.size ||
      localName.toString('latin1') !== entry.name
    ) {
      throw new ZipRefused('local header disagrees')
    }
    checked.push({
      name: entry.name,
      method: entry.method,
      crc: entry.crc,
      compressedSize: entry.compressedSize,
      size: entry.size,
      dataOffset,
    })
  }
  return checked
}

/** Counts and checks every output byte before it is written; refuses past either bound. */
class BoundedOutput extends Transform {
  public written = 0
  public crc = 0

  public constructor(
    private readonly entrySize: number,
    private readonly budget: { remaining: number },
  ) {
    super()
  }

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: TransformCallback,
  ): void {
    this.written += chunk.length
    this.budget.remaining -= chunk.length
    if (this.written > this.entrySize || this.budget.remaining < 0) {
      done(new ZipRefused('output beyond its bound'))
      return
    }
    this.crc = crcUpdate(this.crc, chunk)
    done(null, chunk)
  }
}

/** A folder made private inside the destination, and not a link or reparse point. */
async function privateFolder(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true, mode: PRIVATE_DIR_MODE })
  const info = await lstat(folder)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ZipRefused('destination is not a plain folder')
  }
}

/**
 * Extracts the checked entries of `archive` into `destination` (a fresh
 * folder), each streamed, bounded, counted and checked. Stops at `signal`.
 */
export async function extractZipEntries(
  archive: string,
  entries: readonly ZipEntry[],
  destination: string,
  plan: ExtractPlan,
  signal: AbortSignal,
): Promise<void> {
  const root = path.resolve(destination)
  const budget = { remaining: plan.extractedBytes }
  for (const entry of entries) {
    signal.throwIfAborted()
    const target = path.resolve(root, ...entry.name.split('/'))
    const relative = path.relative(root, target)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ZipRefused('outside the destination')
    }
    await privateFolder(path.dirname(target))
    const mode = plan.executableEntries.has(entry.name) ? EXECUTABLE_MODE : PRIVATE_FILE_MODE
    const output = new BoundedOutput(entry.size, budget)
    const source =
      entry.compressedSize === 0
        ? new PassThrough().end()
        : createReadStream(archive, {
            start: entry.dataOffset,
            end: entry.dataOffset + entry.compressedSize - 1,
          })
    const decoder = entry.method === METHOD_DEFLATE ? createInflateRaw() : new PassThrough()
    await pipeline(source, decoder, output, createWriteStream(target, { flags: 'wx', mode }), {
      signal,
    })
    if (output.written !== entry.size || output.crc !== entry.crc) {
      throw new ZipRefused('length or CRC')
    }
  }
}
