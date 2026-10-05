// The portable Node adapter for M103 detection. No discovery, writes or device opens.
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { MAKER_DETECT_MAX_DEPTH } from '../../../shared/constants'
import { isBelow } from '../../workspacePath'
import type { ProjectDetectIo } from './projectKinds'

const IGNORED = new Set(['.git', 'node_modules', '.pio', 'build', 'dist', '.venv', '__pycache__'])

/** Links are skipped, including linked directories; even ignored names count towards the cap. */
async function* files(root: string, maxNames: number): AsyncIterable<string> {
  const canonical = await realpath(root)
  const pending = [{ name: '', depth: 0 }]
  let names = 0
  while (pending.length > 0 && names < maxNames) {
    const next = pending.shift()
    if (next === undefined) break
    const directory = path.join(canonical, next.name)
    // A directory replaced by a link since listing is not traversed.
    const info = await lstat(directory)
    if (!info.isDirectory() || (await realpath(directory)) !== directory) continue
    const handle = await opendir(directory, { bufferSize: 1 })
    try {
      let entry = await handle.read()
      while (entry !== null && names < maxNames) {
        names += 1
        const relative = path.join(next.name, entry.name)
        if (entry.isFile()) yield relative.split(path.sep).join('/')
        else if (
          entry.isDirectory() &&
          next.depth < MAKER_DETECT_MAX_DEPTH &&
          !IGNORED.has(entry.name)
        ) {
          pending.push({ name: relative, depth: next.depth + 1 })
        }
        entry = names < maxNames ? await handle.read() : null
      }
    } finally {
      await handle.close()
    }
  }
}

async function read(
  root: string,
  relative: string,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const canonicalRoot = await realpath(root)
  const target = path.resolve(canonicalRoot, relative)
  if (!isBelow(path.relative(canonicalRoot, target), path)) return
  const info = await lstat(target)
  if (!info.isFile()) return
  const canonical = await realpath(target)
  if (!isBelow(path.relative(canonicalRoot, canonical), path)) return
  const handle = await open(
    canonical,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  )
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) return
    const buffer = Buffer.alloc(maxBytes)
    let filled = 0
    while (filled < maxBytes) {
      const { bytesRead } = await handle.read(buffer, filled, maxBytes - filled, filled)
      if (bytesRead === 0) break
      filled += bytesRead
    }
    return buffer.subarray(0, filled)
  } finally {
    await handle.close()
  }
}

export const nodeProjectDetectIo: ProjectDetectIo = { files, read }
