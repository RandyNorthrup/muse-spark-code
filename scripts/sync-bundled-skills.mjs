// M89/D68: download a pinned release, verify it, then copy only the workflow package.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const PACKAGE = 'high-quality-projects-skill'
const SOURCE = `https://github.com/RandyNorthrup/${PACKAGE}`
const VENDOR_PARENT = path.resolve(import.meta.dirname, '..', 'vendor')
const DESTINATION = path.join(VENDOR_PARENT, PACKAGE)
const BLOCK_BYTES = 512
const FETCH_TIMEOUT_MS = 60_000
const ROOT_FILES = new Set(['AGENTS.md', 'LICENSE', 'README.md'])
const SKILLS = ['project_setup', 'feature_delivery', 'quality_retrofit']

/** Require exactly one matching SHA256SUMS line and return the verified digest. */
export function assertArchiveChecksum(bytes, sums, archiveName) {
  const matches = sums
    .split(/\r?\n/)
    .map((line) => /^([\da-f]{64})\s+\*?(.+)$/i.exec(line))
    .filter((match) => match?.[2] === archiveName)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (matches.length !== 1 || matches[0][1].toLowerCase() !== actual) {
    throw new Error(`SHA-256 mismatch or missing/duplicate checksum for ${archiveName}`)
  }
  return actual
}

/** Reject traversal, Windows drive/stream paths, and archive links before selection. */
export function assertArchivePath(name, type) {
  if (
    name === '' ||
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    name.includes('\\') ||
    name.includes(':') ||
    name.split('/').includes('..')
  ) {
    throw new Error(`Unsafe archive path: ${name}`)
  }
  if (type === '1' || type === '2') {
    throw new Error(`Archive links are forbidden: ${name}`)
  }
}

function selected(name) {
  return (
    ROOT_FILES.has(name) ||
    name.startsWith('skills/') ||
    (name.startsWith('scripts/') && name !== 'scripts/build-release.ps1') ||
    name.startsWith('templates/') ||
    /^docs\/[^/]+\.md$/.test(name)
  )
}

export { selected as isSelected }

function field(header, start, end) {
  return header.toString('utf8', start, end).split('\0', 1)[0]
}

function octal(header, start, end) {
  const text = field(header, start, end).trim()
  if (!/^[0-7]+$/.test(text)) throw new Error('Invalid tar numeric field')
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value)) throw new Error('Tar numeric field is too large')
  return value
}

// The tagged git archive uses ustar entries plus a global PAX comment containing
// the source commit. Ignore only that metadata; path/size overrides are unsupported.
export function archiveFiles(bytes, topFolder) {
  const tar = gunzipSync(bytes)
  const files = new Map()
  const archiveNames = new Set()
  for (let at = 0; at < tar.length;) {
    if (at + BLOCK_BYTES > tar.length) throw new Error('Truncated tar header')
    const header = tar.subarray(at, at + BLOCK_BYTES)
    if (header.every((byte) => byte === 0)) {
      if (tar.subarray(at).some((byte) => byte !== 0)) {
        throw new Error('Unexpected data after tar terminator')
      }
      break
    }
    const checksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    )
    if (checksum !== octal(header, 148, 156)) throw new Error('Invalid tar header checksum')
    const prefix = field(header, 345, 500)
    const name = `${prefix === '' ? '' : `${prefix}/`}${field(header, 0, 100)}`
    const type = field(header, 156, 157)
    assertArchivePath(name, type)
    const size = octal(header, 124, 136)
    const end = at + BLOCK_BYTES + size
    const next = at + BLOCK_BYTES + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES
    if (next > tar.length) throw new Error(`Truncated tar entry: ${name}`)
    const body = tar.subarray(at + BLOCK_BYTES, end)
    at = next
    if (type === 'g') {
      const metadata = body.toString('utf8')
      if (!/^\d+ comment=[\da-f]+\n$/.test(metadata)) {
        throw new Error('Unsupported global PAX metadata')
      }
      continue
    }
    if (!['', '0', '5'].includes(type)) throw new Error(`Unsupported tar entry: ${name}`)
    if (!name.startsWith(`${topFolder}/`)) throw new Error(`Unexpected archive root: ${name}`)
    if (type === '5') continue
    const relative = name.slice(topFolder.length + 1)
    // Windows trims dots/spaces in each path segment; case also folds on macOS.
    // Check before selection so an excluded alias cannot overwrite an allowed file.
    const normalized = relative
      .split('/')
      .map((segment) => segment.replace(/[. ]+$/, '').toLowerCase())
      .join('/')
    if (archiveNames.has(normalized)) throw new Error(`Duplicate archive file: ${relative}`)
    archiveNames.add(normalized)
    if (!selected(relative)) continue
    files.set(relative, { body, mode: octal(header, 100, 108) & 0o777 })
  }
  for (const required of ['LICENSE', ...SKILLS.map((id) => `skills/${id}/SKILL.md`)]) {
    if (!files.has(required)) throw new Error(`Release is missing ${required}`)
  }
  return files
}

async function download(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function sync(tag) {
  const archiveName = `${PACKAGE}-${tag}.tar.gz`
  const release = `${SOURCE}/releases/download/${tag}`
  const [archive, sums] = await Promise.all([
    download(`${release}/${archiveName}`),
    download(`${release}/SHA256SUMS.txt`),
  ])
  // Never recurse through a linked vendor parent. The target itself is a fixed
  // directory inside this script's worktree, independent of the caller's cwd.
  if (lstatSync(VENDOR_PARENT, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('The vendor parent must not be a link')
  }
  const archiveSha256 = assertArchiveChecksum(archive, sums.toString('utf8'), archiveName)
  const files = archiveFiles(archive, `${PACKAGE}-${tag}`)
  rmSync(DESTINATION, { recursive: true, force: true })
  mkdirSync(DESTINATION, { recursive: true })
  for (const [relative, { body, mode }] of files) {
    const destination = path.join(DESTINATION, relative)
    mkdirSync(path.dirname(destination), { recursive: true })
    writeFileSync(destination, body, { mode })
  }
  const manifest = {
    source: SOURCE,
    tag,
    archiveSha256,
    files: [...files]
      .map(([relative, { body }]) => ({
        path: relative,
        sha256: createHash('sha256').update(body).digest('hex'),
      }))
      .toSorted((a, b) => a.path.localeCompare(b.path, 'en')),
  }
  writeFileSync(path.join(DESTINATION, 'VENDOR.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${PACKAGE} ${tag}: ${files.size} files copied (${archiveSha256})`)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const [flag, tag, ...extra] = process.argv.slice(2)
    if (flag !== '--tag' || !/^v\d+\.\d+\.\d+$/.test(tag ?? '') || extra.length > 0) {
      throw new Error('Usage: node scripts/sync-bundled-skills.mjs --tag vX.Y.Z')
    }
    await sync(tag)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
