// Solid brotli archive of the pinned legal texts (VSIXFIT A): the SPDX
// templates, `equivalentwords.txt` and the slot-words file under
// `dist/legal-data/` are many near-identical texts (GPL/LGPL/AGPL
// only/or-later pairs), so zip's per-member deflate repeats their shared
// runs. The packagers (`scripts/package-vsix.mjs`, `scripts/package-acp.mjs`)
// pack every member except `NOTICE.md` and `provenance.json` (both stay
// loose: CI asserts them, and they are the attribution a person reads)
// into one brotli-11 archive holding each file's exact bytes by its
// relative path. The scanner (`src/core/legal/workspace.ts`) reads a
// member from the archive when it is present beside the module and from
// the loose directory otherwise, verifying every member's SHA-256 either
// way, so a missing, damaged or unreadable archive or member fails
// closed exactly as a missing file does today.
import { Buffer } from 'node:buffer'
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

export const LEGAL_DATA_DIR = 'dist/legal-data'
export const LEGAL_DATA_ARCHIVE_FILE = 'dist/legal-data.json.br'
export const LEGAL_DATA_ARCHIVE_VERSION = 1
/** Production brotli quality; tests may pass a lower one (same bytes out). */
export const LEGAL_DATA_ARCHIVE_QUALITY = 11

const LOOSE_KEEP = new Set(['NOTICE.md', 'provenance.json'])

/** Every archivable file under the staged legal-data dir, posix paths sorted. */
function listArchivedFiles(source) {
  const found = []
  const visit = (directory, prefix) => {
    const names = readdirSync(directory).toSorted((left, right) => left.localeCompare(right, 'en'))
    for (const name of names) {
      const absolute = path.join(directory, name)
      const held = lstatSync(absolute)
      // A link in the stage is never packed silently: packaging fails
      // naming it, the same way an unexpected file fails the stage.
      if (held.isSymbolicLink())
        throw new Error(`Legal-data link must not ship in the package: ${prefix}${name}`)
      if (held.isDirectory()) {
        visit(absolute, `${prefix}${name}/`)
        continue
      }
      if (prefix === '' && LOOSE_KEEP.has(name)) continue
      found.push(`${prefix}${name}`)
    }
  }
  visit(source, '')
  return found
}

/**
Pack the staged legal-data members into the solid archive and remove the
loose members from the stage. `root` is the repository checkout, `stage`
its package stage. Returns the member count with the loose and archived
byte sizes for the packaging log.
*/
export function packLegalDataArchive(stage, quality = LEGAL_DATA_ARCHIVE_QUALITY) {
  const source = path.join(stage, LEGAL_DATA_DIR)
  // lstatSync throws when the stage lacks legal data: the package must
  // fail, never ship the scanner without its pinned texts.
  if (!lstatSync(source).isDirectory())
    throw new Error(`Legal data is missing from the stage: ${source}`)
  const files = listArchivedFiles(source)
  if (files.length === 0) throw new Error(`Legal data archive would be empty: ${source}`)
  const members = {}
  let looseBytes = 0
  for (const file of files) {
    const bytes = readFileSync(path.join(source, ...file.split('/')))
    looseBytes += bytes.byteLength
    // Raw text compresses far better than base64 here (the near-identical
    // templates share long runs): 32 KiB against 67 KiB measured. The
    // round-trip check below keeps it exact: any future member that is
    // not valid UTF-8 fails packaging instead of shipping altered bytes.
    const text = bytes.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(bytes))
      throw new Error(`Legal-data member is not exact UTF-8 text: ${file}`)
    members[file] = text
  }
  const packed = brotliCompressSync(
    JSON.stringify({ version: LEGAL_DATA_ARCHIVE_VERSION, files: members }),
    {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality },
    },
  )
  writeFileSync(path.join(stage, LEGAL_DATA_ARCHIVE_FILE), packed)
  for (const file of files) rmSync(path.join(source, ...file.split('/')), { force: true })
  // The templates directory holds only archived members; remove it when
  // empty so the stage keeps no hollow directory. Anything else left
  // behind stays, and still ships loose.
  const templates = path.join(source, 'templates')
  if (existsSync(templates) && readdirSync(templates).length === 0)
    rmSync(templates, { recursive: true, force: true })
  return { members: files.length, looseBytes, archiveBytes: packed.byteLength }
}
