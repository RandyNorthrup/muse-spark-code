// Shared rig for the solid-archive suites (VSIXWEB A/B): reading and
// damaging real archives the real producer packed. Both suites break one
// member or byte the same way and assert the same refusal, so the rig lives
// once here instead of twice in the suites.
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'

/** One archived member: the exact text with its SHA-256, as the packager wrote it. */
export interface SolidArchiveMember {
  readonly sha256: string
  readonly text: string
}

/** The archive's member records by posix relative path. */
export type SolidArchiveMembers = Record<string, SolidArchiveMember>

export function isSolidArchiveMembers(value: unknown): value is SolidArchiveMembers {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (member: unknown) =>
        typeof member === 'object' &&
        member !== null &&
        typeof Reflect.get(member, 'sha256') === 'string' &&
        typeof Reflect.get(member, 'text') === 'string',
    )
  )
}

/** The archive's validated member records; a malformed archive fails the test. */
export function readSolidArchiveMembers(archiveFile: string): SolidArchiveMembers {
  const parsed: unknown = JSON.parse(
    brotliDecompressSync(readFileSync(archiveFile)).toString('utf8'),
  )
  const files: unknown =
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'files') : undefined
  if (!isSolidArchiveMembers(files)) throw new Error('Test archive is malformed')
  return files
}

/** The members repacked over an archive, production brotli settings aside. */
export function writeSolidArchiveMembers(
  archiveFile: string,
  members: SolidArchiveMembers,
  version: number,
): void {
  writeFileSync(
    archiveFile,
    brotliCompressSync(JSON.stringify({ version, files: members }), {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 },
    }),
  )
}

/** Flip one member's first text character, keeping its recorded SHA-256: a wrong member byte. */
export function damageSolidArchiveMember(
  archiveFile: string,
  member: string,
  version: number,
): void {
  const members = readSolidArchiveMembers(archiveFile)
  const original = members[member]?.text ?? ''
  if (original.length === 0) throw new Error(`Test archive member is empty: ${member}`)
  members[member] = { sha256: members[member]?.sha256 ?? '', text: `X${original.slice(1)}` }
  writeSolidArchiveMembers(archiveFile, members, version)
}

/** Flip the archive's last compressed byte: a damaged archive. */
export function damageSolidArchiveBytes(archiveFile: string): void {
  const packed = readFileSync(archiveFile)
  const last = packed.at(-1)
  if (last === undefined) throw new Error('Test archive is empty')
  packed.writeUInt8(last ^ 0xff, packed.length - 1)
  writeFileSync(archiveFile, packed)
}

/** A private copy of a rig directory the test then damages, removed afterwards. */
export function copyRig(sourceDir: string): { dir: string; cleanup: () => void } {
  const copy = mkdtempSync(path.join(tmpdir(), 'muse-solid-archive-rig-'))
  rmSync(copy, { recursive: true, force: true })
  cpSync(sourceDir, copy, { recursive: true })
  return {
    dir: copy,
    cleanup: () => {
      rmSync(copy, { recursive: true, force: true })
    },
  }
}

/** The SHA-256 of text, for members a test adds to an archive. */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
