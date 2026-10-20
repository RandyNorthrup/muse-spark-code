// One solid brotli archive of exact UTF-8 text members (VSIXWEB A/B):
// the webview bundle and the vendored skill package are many small texts,
// so zip's per-member deflate repeats their shared runs. The packagers
// (`scripts/package-vsix.mjs`) pack every member except a small loose set
// into one brotli-11 archive holding each file's exact text and SHA-256 by
// its posix relative path. Readers verify every member's SHA-256 against
// the archive's record, so a missing, damaged or unreadable archive or
// member refuses exactly as a missing file does, never serving unverified
// bytes. Paths are posix in the archive; comparison normalises Windows
// separators before comparing, so the check holds on Windows checkouts.
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'

export const SOLID_TEXT_ARCHIVE_VERSION = 1
/** Production brotli quality; tests may pass a lower one (same bytes out). */
export const SOLID_TEXT_ARCHIVE_QUALITY = 11

/**
Every archivable file under `source`, posix paths sorted. A link in the
tree is never packed silently: packaging fails naming it.
*/
export function listTextMembers(source) {
  const found = []
  const visit = (directory, prefix) => {
    const names = readdirSync(directory).toSorted((left, right) => left.localeCompare(right, 'en'))
    for (const name of names) {
      const absolute = path.join(directory, name)
      const held = lstatSync(absolute)
      if (held.isSymbolicLink())
        throw new Error(`Solid archive link must not ship in the package: ${prefix}${name}`)
      if (held.isDirectory()) {
        visit(absolute, `${prefix}${name}/`)
        continue
      }
      found.push(`${prefix}${name}`)
    }
  }
  visit(source, '')
  return found
}

/**
The archive's member records for `files`: each file's exact bytes as UTF-8
text with its SHA-256. Raw text compresses far better than base64 here;
any member that is not valid UTF-8 fails packaging instead of shipping
altered bytes.
*/
export function readTextMembers(source, files) {
  const members = {}
  let looseBytes = 0
  for (const file of files) {
    const bytes = readFileSync(path.join(source, ...file.split('/')))
    looseBytes += bytes.byteLength
    const text = bytes.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(bytes))
      throw new Error(`Solid archive member is not exact UTF-8 text: ${file}`)
    members[file] = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      text,
    }
  }
  return { members, looseBytes }
}

/** The canonical archive document for `members`. */
export function encodeSolidTextArchive(members) {
  return JSON.stringify({ version: SOLID_TEXT_ARCHIVE_VERSION, files: members })
}

/**
Pack the staged `sourceRel` members into `archiveRel` and remove the loose
members from the stage, keeping `keep` (loose evidence and attribution a
person reads) beside it. `root` is the repository checkout, `stage` its
package stage. Returns the member count with the loose and archived byte
sizes for the packaging log.
*/
export function packSolidTextArchive(
  stage,
  sourceRel,
  archiveRel,
  keep = new Set(),
  quality = SOLID_TEXT_ARCHIVE_QUALITY,
  exclude = new Set(),
) {
  const source = path.join(stage, ...sourceRel.split('/'))
  if (!lstatSync(source).isDirectory())
    throw new Error(`Solid archive source is missing: ${source}`)
  // Kept members stay loose beside the archive; excluded members leave the
  // stage entirely (never shipped, e.g. an agent-only bundle inside the
  // webview tree that VSCE never allowlisted).
  for (const file of exclude) rmSync(path.join(source, ...file.split('/')), { force: true })
  const files = listTextMembers(source).filter((file) => !keep.has(file))
  if (files.length === 0) throw new Error(`Solid archive would be empty: ${source}`)
  const { members, looseBytes } = readTextMembers(source, files)
  const packed = brotliCompressSync(encodeSolidTextArchive(members), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality },
  })
  const archive = path.join(stage, ...archiveRel.split('/'))
  mkdirSync(path.dirname(archive), { recursive: true })
  writeFileSync(archive, packed)
  for (const file of files) rmSync(path.join(source, ...file.split('/')), { force: true })
  removeEmptyDirs(source)
  return { members: files.length, looseBytes, archiveBytes: packed.byteLength }
}

/** Remove dirs left hollow by the archive packing, keeping the kept loose files' parents. */
function removeEmptyDirs(source) {
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const absolute = path.join(directory, name)
      if (lstatSync(absolute).isDirectory()) visit(absolute)
    }
    if (directory !== source && readdirSync(directory).length === 0)
      rmSync(directory, { recursive: true, force: true })
  }
  if (existsSync(source)) visit(source)
}

/**
Parse and validate archived bytes: bound the compressed read and the
decoded form, then every member's shape. Throws on anything unexpected;
callers fail closed.
*/
export function parseSolidTextArchive(packed, maxOutputBytes, expectedVersion) {
  if (expectedVersion === undefined) throw new TypeError('Solid archive version is required')
  if (packed.byteLength > maxOutputBytes) throw new Error('Solid archive is over its bound')
  const text = brotliDecompressSync(packed, { maxOutputLength: maxOutputBytes }).toString('utf8')
  const parsed = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid solid archive')
  if (parsed.version !== expectedVersion) throw new Error('Invalid solid archive version')
  const files = Reflect.get(parsed, 'files')
  if (typeof files !== 'object' || files === null) throw new Error('Invalid solid archive members')
  for (const [relative, entry] of Object.entries(files)) {
    if (relative === '' || relative.includes('\\') || relative.split('/').includes('..'))
      throw new Error(`Invalid solid archive path: ${relative}`)
    if (typeof entry !== 'object' || entry === null) throw new Error('Invalid solid archive member')
    const { sha256, text: member } = entry
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256))
      throw new Error(`Invalid solid archive digest: ${relative}`)
    if (typeof member !== 'string') throw new TypeError(`Invalid solid archive text: ${relative}`)
  }
  return files
}

/**
One member's exact bytes: UTF-8 encodes the archived text and checks the
SHA-256 against the archive's record. Throws on mismatch, never returning
unverified bytes.
*/
export function solidMemberBytes(entry, relative) {
  const bytes = Buffer.from(entry.text, 'utf8')
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error(`Solid archive member failed verification: ${relative}`)
  return bytes
}
