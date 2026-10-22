// The host side of byte-range file reads and edits: one byte window of a
// file of any size, and a streaming range splice that never loads the whole
// file. Only the Model API backend's range tools call it, through ToolIo, so
// it loads with its own chunk (dist/toolRange.js, D6) on the first range
// addressed call; whole-file turns never carry it. Like the review bundle it
// carries its own copy of every module it shares with dist/extension.js, the
// display language's table among them, so the factory installs the
// activation bundle's table before it builds anything.

import { createHash, randomUUID } from 'node:crypto'
import { type BigIntStats } from 'node:fs'
import { Buffer } from 'node:buffer'
import { type FileHandle, open, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { sameFile } from '../../core/fs/fileIdentity'
import type { AtomicWriteOptions } from '../fsAtomic'
import type { ToolIo } from '../../core/backends/modelapi/tools'
import { PERMISSION_BITS } from '../fsAtomic'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  BOUNDED_FILE_READ_CHUNK_BYTES,
  TOOL_FILE_RANGE_MAX_BYTES,
} from '../../shared/constants'
import { fill, setUiText, UI_TEXT } from '../../shared/l10n/text'

// What the range implementation needs from the activation bundle: the
// sampled-path guard stays single-sourced in ToolIo (no second copy of the
// junction-swap check), and the atomic rename stays the host's, so a range
// splice keeps its permission bits exactly as the whole-file write does.
export interface FileRangeIoDeps {
  readonly uiText: typeof UI_TEXT
  readonly uiLocale: string
  readonly platform: NodeJS.Platform
  /** Waits between rename attempts; injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  readonly checkOpenedFile: (
    absolutePath: string,
    file: FileHandle,
    expectedCanonicalPath: string | undefined,
  ) => Promise<BigIntStats>
  readonly isMissingFile: (error: unknown) => boolean
  readonly renameReplacing: (
    from: string,
    to: string,
    options: AtomicWriteOptions,
    beforeAttempt?: () => Promise<void>,
  ) => Promise<void>
  readonly hasUnsavedChanges: (absolutePath: string) => boolean
  readonly assertWorkspaceCurrent?: (() => void) | undefined
}

// A file's text shape in one streaming pass: a UTF-8 byte-order mark at
// the start, and whether every line break is a CRLF.
const UTF8_BOM_LENGTH = 3
const UTF8_BOM_FIRST = 0xef
const UTF8_BOM_SECOND = 0xbb
const UTF8_BOM_THIRD = 0xbf
const ASCII_LINE_FEED = 0x0a
const ASCII_CARRIAGE_RETURN = 0x0d
const UTF8_MAX_SEQUENCE_BYTES = 4
const UTF8_CONTINUATION_MASK = 0xc0
const UTF8_CONTINUATION_BITS = 0x80

/** A range splice that found the file changed under it: nothing was written. */
class SpliceStaleError extends Error {}

// The range half of ToolIo, built on the first range addressed call. Both
// methods are always present (unlike the ToolIo interface, which predates
// range reads): a bundle that cannot load never gets this far.
export function createFileRangeIo(
  deps: FileRangeIoDeps,
): Required<Pick<ToolIo, 'readFileRange' | 'spliceFileRange'>> {
  setUiText(deps.uiText, deps.uiLocale)
  return {
    // One byte window of a file of any size, with the shape a range display
    // and edit needs. Memory and I/O stay windowed: the window's bytes plus
    // a few overlap bytes are the only bytes read — no whole-file scan. The
    // shape is window-local (BOM only when the window covers byte 0, this
    // window's breaks only) and the fingerprint digests the returned window,
    // not the file.
    async readFileRange(absolutePath, expectedCanonicalPath, range, signal) {
      const offset = Math.max(Math.floor(range.offset), 0)
      const length = Math.min(Math.max(Math.floor(range.length), 0), TOOL_FILE_RANGE_MAX_BYTES)
      let file: FileHandle
      try {
        file = await open(absolutePath, 'r')
      } catch (error: unknown) {
        if (deps.isMissingFile(error)) {
          return
        }
        throw error
      }
      try {
        signal?.throwIfAborted()
        const identity = await deps.checkOpenedFile(absolutePath, file, expectedCanonicalPath)
        const metadata = await file.stat()
        const size = metadata.size
        const mtimeMs = metadata.mtimeMs
        const requestedStart = Math.min(offset, size)
        const readStart = Math.max(requestedStart - UTF8_MAX_SEQUENCE_BYTES + 1, 0)
        const requestedEnd = Math.min(requestedStart + length, size)
        const readEnd = Math.min(requestedEnd + UTF8_MAX_SEQUENCE_BYTES, size)
        const bytes = Buffer.alloc(readEnd - readStart)
        const { bytesRead } = await file.read(bytes, 0, bytes.length, readStart)
        const view = bytes.subarray(0, bytesRead)
        const isContinuation = (at: number): boolean => {
          const byte = view[at]
          return byte !== undefined && (byte & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_BITS
        }
        let from = requestedStart - readStart
        let to = Math.min(requestedEnd - readStart, bytesRead)
        while (from > 0 && isContinuation(from)) from -= 1
        while (to < bytesRead && isContinuation(to)) to += 1
        // CRLF is one logical break; do not normalize its halves separately.
        if (view[from] === ASCII_LINE_FEED && view[from - 1] === ASCII_CARRIAGE_RETURN) from -= 1
        if (view[to] === ASCII_LINE_FEED && view[to - 1] === ASCII_CARRIAGE_RETURN) to += 1
        const window = view.subarray(from, to)
        const alignedStart = readStart + from
        let breaks = 0
        let crlf = 0
        let isAfterCarriageReturn = false
        for (const byte of window) {
          if (byte === ASCII_LINE_FEED) {
            breaks += 1
            if (isAfterCarriageReturn) {
              crlf += 1
            }
            isAfterCarriageReturn = false
          } else if (byte === ASCII_CARRIAGE_RETURN) {
            isAfterCarriageReturn = true
          } else {
            isAfterCarriageReturn = false
          }
        }
        const hasBom =
          alignedStart === 0 &&
          window.length >= UTF8_BOM_LENGTH &&
          window[0] === UTF8_BOM_FIRST &&
          window[1] === UTF8_BOM_SECOND &&
          window[2] === UTF8_BOM_THIRD
        const fingerprint = createHash('sha256').update(window).digest('hex')
        signal?.throwIfAborted()
        const after = await file.stat()
        const current = await deps.checkOpenedFile(absolutePath, file, expectedCanonicalPath)
        if (
          after.size !== size ||
          after.mtimeMs !== mtimeMs ||
          after.ctimeMs !== metadata.ctimeMs ||
          !sameFile(identity, current)
        )
          throw new Error(fill(UI_TEXT.media.sourceChanged, { name: path.basename(absolutePath) }))
        return {
          bytes: window,
          offset: alignedStart,
          size,
          mtimeMs,
          fingerprint,
          hasBom,
          isCrlf: breaks > 0 && crlf === breaks,
        }
      } finally {
        await file.close()
      }
    },
    // Replace one byte span `[start, end)` with `replacement` without
    // loading the file: head and tail stream through a temporary file beside
    // the target in 64 KiB chunks, which is renamed over it (PLAN.md
    // D26/D27). `changed`, and nothing written, when the file no longer has
    // the expected size and mtime, is gone, or an editor holds unsaved text;
    // other OS failures throw, naming the cause.
    async spliceFileRange(
      absolutePath,
      expectedCanonicalPath,
      expected,
      start,
      end,
      replacement,
      options,
      signal,
    ) {
      let file: FileHandle
      try {
        file = await open(absolutePath, 'r')
      } catch (error: unknown) {
        if (deps.isMissingFile(error)) {
          return { status: 'changed' } as const
        }
        throw error
      }
      try {
        signal?.throwIfAborted()
        await deps.checkOpenedFile(absolutePath, file, expectedCanonicalPath)
        const metadata = await file.stat()
        if (metadata.size !== expected.size || metadata.mtimeMs !== expected.mtimeMs) {
          return { status: 'changed' } as const
        }
        if (start < 0 || end < start || end > metadata.size) {
          throw new Error(
            `range splice [${String(start)}, ${String(end)}) is outside ${path.basename(absolutePath)} (${String(metadata.size)} bytes)`,
          )
        }
        options.assertCanWrite?.()
        // The write lands where the file really is (through a link, the
        // file it leads to), keeping its permission bits, as the atomic
        // whole-file write does.
        let real: string
        try {
          real = await realpath(absolutePath)
        } catch (error: unknown) {
          if (deps.isMissingFile(error)) {
            return { status: 'changed' } as const
          }
          throw error
        }
        const { mode } = await stat(real)
        const temporary = `${real}.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
        const copy = Buffer.alloc(BOUNDED_FILE_READ_CHUNK_BYTES)
        const staged = await open(temporary, 'wx')
        try {
          let position = 0
          const pump = async (from: number, to: number): Promise<void> => {
            position = from
            while (position < to) {
              signal?.throwIfAborted()
              const { bytesRead } = await file.read(
                copy,
                0,
                Math.min(copy.length, to - position),
                position,
              )
              if (bytesRead === 0) {
                break
              }
              await staged.write(copy.subarray(0, bytesRead))
              position += bytesRead
            }
          }
          await pump(0, start)
          await staged.write(replacement)
          await pump(end, metadata.size)
          await staged.chmod(mode & PERMISSION_BITS)
        } finally {
          await staged.close()
        }
        const latest = await file.stat()
        if (latest.size !== expected.size || latest.mtimeMs !== expected.mtimeMs) {
          await rm(temporary, { force: true })
          return { status: 'changed' } as const
        }
        if (options.unsavedAt.some((name) => deps.hasUnsavedChanges(name))) {
          await rm(temporary, { force: true })
          return { status: 'changed' } as const
        }
        options.assertCanWrite?.()
        try {
          await deps.renameReplacing(
            temporary,
            real,
            {
              sleep: deps.sleep,
              assertCanWrite: () => {
                deps.assertWorkspaceCurrent?.()
                options.assertCanWrite?.()
              },
              ...(expectedCanonicalPath !== undefined && { expectedCanonicalPath }),
              platform: deps.platform,
            },
            async () => {
              const again = await file.stat()
              if (again.size !== expected.size || again.mtimeMs !== expected.mtimeMs) {
                throw new SpliceStaleError()
              }
            },
          )
        } catch (error: unknown) {
          if (error instanceof SpliceStaleError) {
            await rm(temporary, { force: true })
            return { status: 'changed' } as const
          }
          throw error
        }
        const done = await stat(real)
        return { status: 'written', size: done.size, mtimeMs: done.mtimeMs } as const
      } finally {
        await file.close()
      }
    },
  }
}
