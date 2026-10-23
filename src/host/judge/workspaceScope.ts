// Paid settings are machine-scoped (PLAN.md D15, D30): VS Code reads
// `museSpark.judge.engine` and `museSpark.judge.separate` from user settings
// only, so a repository's workspace settings can never turn paid use on. A
// value found only there is not honoured, and never silently either: the
// window names it (gap `scope`) in the status line and the log. This reads
// the raw workspace files (`.vscode/settings.json`, a `.code-workspace`
// file's `settings`), which VS Code itself hides for these settings.
import { Buffer } from 'node:buffer'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import * as z from 'zod/mini'
import {
  SETTINGS_SECTION,
  WORKSPACE_SETTINGS_MAX_BYTES,
  WORKSPACE_SETTINGS_MAX_FILES,
  WORKSPACE_SETTINGS_TOTAL_BYTES,
} from '../../shared/constants'

/** The texts read, and how many files could not be read within the bounds. */
export interface WorkspaceSettingsRead {
  readonly texts: readonly string[]
  readonly skipped: number
}

/** An absent file is normal (most folders have no settings file); anything unreadable is skipped. */
const ABSENT = new Set(['ENOENT', 'ENOTDIR'])

function errorCode(error: unknown): string | undefined {
  const parsed = z.object({ code: z.string() }).safeParse(error)
  return parsed.success ? parsed.data.code : undefined
}

/** One bounded read: the text, no such file, or a file skipped (irregular, too large, unreadable). */
type BoundedRead =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'skipped' }

const SKIPPED: BoundedRead = { kind: 'skipped' }

/**
O_NONBLOCK keeps a FIFO's open from waiting for a writer. POSIX defines it;
Windows' fs constants omit it (no FIFO can be opened there by path).
*/
const NON_BLOCKING = z.optional(z.number()).parse(Reflect.get(constants, 'O_NONBLOCK')) ?? 0

/**
One file's text when it is a regular file of at most `limit` bytes, opened
without blocking (a FIFO or device, or a link to one, is refused after
opening, before any read).
*/
function boundedRegularFile(file: string, limit: number): BoundedRead {
  let descriptor: number
  try {
    descriptor = openSync(file, constants.O_RDONLY | NON_BLOCKING)
  } catch (error: unknown) {
    return ABSENT.has(errorCode(error) ?? '') ? { kind: 'absent' } : SKIPPED
  }
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.size > limit) return SKIPPED
    // Read at most one byte past the limit: a file that grew is still refused.
    const buffer = Buffer.alloc(limit + 1)
    let length = 0
    for (;;) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null)
      if (count === 0) break
      length += count
      if (length > limit) return SKIPPED
    }
    return { kind: 'text', text: buffer.subarray(0, length).toString('utf8') }
  } catch {
    return SKIPPED
  } finally {
    closeSync(descriptor)
  }
}

/**
The workspace's settings files, read within bounds: regular files only,
at most WORKSPACE_SETTINGS_MAX_BYTES each and WORKSPACE_SETTINGS_TOTAL_BYTES
in all, from at most WORKSPACE_SETTINGS_MAX_FILES files. A file outside the
bounds is skipped and counted, never read in full or parsed.
*/
export function readWorkspaceSettings(files: readonly string[]): WorkspaceSettingsRead {
  const texts: string[] = []
  let skipped = Math.max(0, files.length - WORKSPACE_SETTINGS_MAX_FILES)
  let total = 0
  for (const file of files.slice(0, WORKSPACE_SETTINGS_MAX_FILES)) {
    const limit = Math.min(WORKSPACE_SETTINGS_MAX_BYTES, WORKSPACE_SETTINGS_TOTAL_BYTES - total)
    const read = boundedRegularFile(file, limit)
    if (read.kind === 'skipped') skipped += 1
    if (read.kind !== 'text') continue
    total += Buffer.byteLength(read.text)
    texts.push(read.text)
  }
  return { texts, skipped }
}

const ENGINE_KEY = `${SETTINGS_SECTION}.judge.engine`
const SEPARATE_KEY = `${SETTINGS_SECTION}.judge.separate`

/** The text with JSONC comments and trailing commas removed; strings are kept as written. */
function plainJson(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if (char === '"') {
      const start = index
      index += 1
      while (index < text.length && text.charAt(index) !== '"') {
        index += text.charAt(index) === '\\' ? 2 : 1
      }
      index += 1
      out += text.slice(start, index)
    } else if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
    } else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return out.replaceAll(/,(\s*[}\]])/g, '$1')
}

const recordSchema = z.record(z.string(), z.unknown())

function settingsOf(text: string): Readonly<Record<string, unknown>> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(plainJson(text))
  } catch (error: unknown) {
    // A settings file that is not JSON holds no settings; JSON.parse
    // throws only SyntaxError, and anything else rethrows.
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  const record = recordSchema.safeParse(parsed)
  if (!record.success) return undefined
  // A `.code-workspace` file keeps its settings under `settings`.
  const nested = recordSchema.safeParse(record.data['settings'])
  return nested.success ? { ...record.data, ...nested.data } : record.data
}

/**
Whether any workspace settings file selects the separate judge (an
explicit `separate`/`both` engine or a separate source id). Unreadable
files select nothing.
*/
export function isSeparateInWorkspace(texts: readonly string[]): boolean {
  return texts.some((text) => {
    const settings = settingsOf(text)
    if (settings === undefined) return false
    const engine = settings[ENGINE_KEY]
    const separate = settings[SEPARATE_KEY]
    return (
      engine === 'separate' ||
      engine === 'both' ||
      (typeof separate === 'string' && separate.trim() !== '')
    )
  })
}
