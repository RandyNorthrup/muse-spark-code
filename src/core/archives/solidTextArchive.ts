// The solid brotli archives the packagers write beside their loose
// directories (VSIXWEB A/B: `dist/webview.json.br`, the vendored skill
// archive): one JSON document holding each member's exact UTF-8 text and
// SHA-256 by its posix relative path. Pure over bytes: the host's
// extractor, the skill installer and the archive-backed reader share this
// parser, and every member's bytes come out only through `solidMemberBytes`,
// which checks the SHA-256 against the archive's record first.
import { createHash } from 'node:crypto'
import { brotliDecompressSync } from 'node:zlib'

/** One archived member: the exact text the packager read with its SHA-256. */
export interface SolidTextMember {
  readonly sha256: string
  readonly text: string
}

/** The archive's validated member records by posix relative path. */
export type SolidTextFiles = Readonly<Record<string, SolidTextMember>>

function isMember(value: unknown): value is SolidTextMember {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'sha256') === 'string' &&
    /^[0-9a-f]{64}$/.test(Reflect.get(value, 'sha256') as string) &&
    typeof Reflect.get(value, 'text') === 'string'
  )
}

/**
Parse and validate archived bytes: bound the compressed read and the
decoded form, then every member's shape. Throws on anything unexpected;
callers fail closed, never serving unverified bytes.
*/
export function parseSolidTextArchive(
  packed: Uint8Array,
  maxOutputBytes: number,
  expectedVersion: number,
): SolidTextFiles {
  if (packed.byteLength > maxOutputBytes) throw new Error('Solid archive is over its bound')
  const text = brotliDecompressSync(packed, { maxOutputLength: maxOutputBytes }).toString('utf8')
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid solid archive')
  if (Reflect.get(parsed, 'version') !== expectedVersion)
    throw new Error('Invalid solid archive version')
  const files: unknown = Reflect.get(parsed, 'files')
  if (typeof files !== 'object' || files === null) throw new Error('Invalid solid archive members')
  for (const [relative, entry] of Object.entries(files)) {
    if (relative === '' || relative.includes('\\') || relative.split('/').includes('..'))
      throw new Error(`Invalid solid archive path: ${relative}`)
    if (!isMember(entry)) throw new Error(`Invalid solid archive member: ${relative}`)
  }
  return files as SolidTextFiles
}

/**
One member's exact bytes: UTF-8 encodes the archived text and checks the
SHA-256 against the archive's record. Throws on mismatch, never returning
unverified bytes.
*/
export function solidMemberBytes(entry: SolidTextMember, relative: string): Buffer {
  const bytes = Buffer.from(entry.text, 'utf8')
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Solid archive member failed verification: ${relative}`)
  return bytes
}
