// Project memory for the Model API backend (PLAN.md D13): Muse Code keeps
// a project's notes under `.agents/memory` with `MEMORY.md` as the index
// (one line per note) and reads the index at session start. The model
// gets that index in its instructions and reads or writes the notes with
// the ordinary file tools under the permission mode. Over the limits the
// index is cut with Muse Code's own marker; an index that is not text, or
// leads outside the workspace through a link, is refused (D27).

import path from 'node:path'
import {
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_SEGMENTS,
  MEMORY_TRUNCATED_MARKER,
} from '../../shared/constants'
import { type ContextIo, readContextText } from './contextFiles'

export interface MemoryIndex {
  /** Workspace-relative path of the index, forward slashes. */
  readonly path: string
  readonly text: string
  readonly warning: string | undefined
}

export interface MemoryLoaderDeps {
  readonly io: ContextIo
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
}

const LINE_BREAK = /\r?\n/

/**
 * The memory index, or undefined when the workspace keeps none. Throws with
 * the reason when the index cannot be read as text.
 */
export async function loadMemoryIndex(deps: MemoryLoaderDeps): Promise<MemoryIndex | undefined> {
  const p = deps.platform === 'win32' ? path.win32 : path.posix
  const relative = MEMORY_INDEX_SEGMENTS.join('/')
  const absolute = p.join(deps.workspaceRoot, ...MEMORY_INDEX_SEGMENTS)
  const read = await readContextText(deps, absolute, deps.workspaceRoot)
  if (read === undefined) {
    return undefined
  }
  if (!read.ok) {
    throw new Error(`${relative} ${read.reason}`)
  }
  const { text } = read
  const lines = text.split(LINE_BREAK)
  const bytes = Buffer.byteLength(text)
  if (lines.length <= MEMORY_INDEX_MAX_LINES && bytes <= MEMORY_INDEX_MAX_BYTES) {
    return { path: relative, text: text.trim(), warning: undefined }
  }
  let kept = lines.slice(0, MEMORY_INDEX_MAX_LINES).join('\n')
  if (Buffer.byteLength(kept) > MEMORY_INDEX_MAX_BYTES) {
    kept = Buffer.from(kept).subarray(0, MEMORY_INDEX_MAX_BYTES).toString()
  }
  const limit =
    lines.length > MEMORY_INDEX_MAX_LINES
      ? `${String(lines.length)} lines exceeds the ${String(MEMORY_INDEX_MAX_LINES)} line index limit`
      : `${String(bytes)} bytes exceeds the ${String(MEMORY_INDEX_MAX_BYTES)} byte index limit`
  return {
    path: relative,
    text: `${kept.trim()}\n${MEMORY_TRUNCATED_MARKER}`,
    warning: `${relative}: ${limit}; it is truncated for this session`,
  }
}
