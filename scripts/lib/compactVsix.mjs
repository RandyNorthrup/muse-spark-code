// Recompress VSCE's approved members with maximum deflate. Check every decoded
// byte before replacing its archive; executable modes come from VSCE's files.
import { Buffer } from 'node:buffer'
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { constants, deflateRawSync } from 'node:zlib'
import { readZip } from '@vscode/vsce/out/zip.js'

const LOCAL_BYTES = 30
const CENTRAL_BYTES = 46
const END_BYTES = 22
const MAX_MEMBERS = 0xff_ff
const MAX_CONTENT_BYTES = 32 * 1024 * 1024
const CRC_POLYNOMIAL = 0xed_b8_83_20
const CRC_MASK = 0xff_ff_ff_ff
const MACOS_HELPER = 'extension/native/darwin/muse-dictate'
const DEFLATE_OPTIONS = Array.from({ length: 9 }, (_, index) => index + 1).flatMap((memLevel) => [
  { level: 9, memLevel },
  { level: 9, memLevel, strategy: constants.Z_FILTERED },
])

function checksum(bytes) {
  let value = CRC_MASK
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? (value >>> 1) ^ CRC_POLYNOMIAL : value >>> 1
  }
  return (value ^ CRC_MASK) >>> 0
}

export async function compactVsix(archive, files) {
  const before = await readZip(archive, () => true)
  if (before.size === 0 || before.size !== files.length || before.size > MAX_MEMBERS)
    throw new Error('Invalid VSIX member set')
  const parts = []
  const directory = []
  let offset = 0
  let contentBytes = 0
  for (const file of files) {
    const content = before.get(file.path.toLowerCase())
    if (content === undefined) throw new Error('Missing VSIX member')
    contentBytes += content.length
    if (contentBytes > MAX_CONTENT_BYTES) throw new Error('VSIX content exceeds repack bound')
    const name = Buffer.from(file.path)
    if (name.length > MAX_MEMBERS) throw new Error('VSIX member name exceeds ZIP bound')
    let compressed = content
    let method = 0
    for (const options of DEFLATE_OPTIONS) {
      const candidate = deflateRawSync(content, options)
      if (candidate.length >= compressed.length) {
        continue
      }

      compressed = candidate
      method = 8
    }
    const crc = checksum(content)
    const local = Buffer.alloc(LOCAL_BYTES)
    local.writeUInt32LE(0x04_03_4b_50, 0)
    local.writeUInt16LE(20, 4) // ZIP 2.0, UTF-8, deflate, fixed 1980-01-01.
    local.writeUInt16LE(0x8_00, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(CENTRAL_BYTES)
    central.writeUInt32LE(0x02_01_4b_50, 0)
    central.writeUInt16LE(0x3_14, 4) // Unix metadata, ZIP 2.0.
    local.copy(central, 6, 4, 30)
    // Windows stat cannot retain the execute bit of the verified macOS helper.
    const mode =
      file.path === MACOS_HELPER
        ? 0o10_0755
        : (file.mode ?? (file.localPath === undefined ? 0o10_0644 : statSync(file.localPath).mode))
    central.writeUInt32LE((mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    parts.push(local, name, compressed)
    directory.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const central = Buffer.concat(directory)
  const end = Buffer.alloc(END_BYTES)
  end.writeUInt32LE(0x06_05_4b_50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  const temporary = `${archive}.compact`
  try {
    writeFileSync(temporary, Buffer.concat([...parts, central, end]))
    const after = await readZip(temporary, () => true)
    if (
      after.size !== before.size ||
      [...before].some(([name, content]) => !content.equals(after.get(name)))
    )
      throw new Error('Repacked VSIX differs from VSCE members')
    if (
      statSync(temporary).size >= statSync(archive).size &&
      files.every((file) => file.path !== MACOS_HELPER)
    )
      return
    renameSync(temporary, archive)
  } finally {
    rmSync(temporary, { force: true })
  }
}
