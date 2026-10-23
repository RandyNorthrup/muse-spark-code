// M110os OS6: the reproducibility comparison. It records a directory
// tree's file hashes, checks a tree against a record, or compares two
// trees, reporting every divergence. The image jobs build twice and
// compare; the comparison starts recorded (hashes kept as artifacts)
// and blocks once two builds match. Node builtins only.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

const HASH_CHUNK_BYTES = 64 * 1024 * 1024

/** Every file under dir as a sorted list of /-separated relative paths. */
function compareStrings(one, other) {
  if (one === other) return 0
  return one < other ? -1 : 1
}

export function listFiles(dir) {
  const found = []
  const walk = (relative) => {
    const absolute = relative === '' ? dir : path.join(dir, relative)
    const entries = readdirSync(absolute, { withFileTypes: true }).toSorted((left, right) =>
      compareStrings(left.name, right.name),
    )
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile()) found.push(child)
    }
  }
  walk('')
  return found
}

// Chunked reads: whole-file reads refuse files over 2 GiB, and the
// raw images are near 6 GiB.
function sha256File(file) {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES)
    let position = 0
    for (;;) {
      const read = readSync(fd, chunk, 0, HASH_CHUNK_BYTES, position)
      if (read === 0) break
      hash.update(chunk.subarray(0, read))
      position += read
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/** Hash every file under dir: { files: { relative: sha256 } }. */
export function recordTree(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return { ok: false, error: `not a directory: ${dir}` }
  }
  const files = {}
  for (const relative of listFiles(dir)) {
    files[relative] = sha256File(path.join(dir, relative))
  }
  return { ok: true, files }
}

/** Parse a record file back into { files }. */
export function parseRecord(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'record is not JSON' }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'record must hold an object' }
  }
  const { files } = data
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    return { ok: false, error: 'record must hold files' }
  }
  for (const [name, hash] of Object.entries(files)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      return { ok: false, error: `record hash for ${name} is not a sha256` }
    }
  }
  return { ok: true, files }
}

/**
Compare two { files } maps. Every divergence is reported: changed,
missing on one side, extra on one side. Empty means identical.
*/
export function compareMaps(left, right) {
  const divergences = []
  for (const name of Object.keys(left).toSorted(compareStrings)) {
    if (!Object.hasOwn(right, name)) divergences.push(`only on the left: ${name}`)
    else if (left[name] !== right[name]) divergences.push(`changed: ${name}`)
  }
  for (const name of Object.keys(right).toSorted(compareStrings)) {
    if (!Object.hasOwn(left, name)) divergences.push(`only on the right: ${name}`)
  }
  return divergences
}
