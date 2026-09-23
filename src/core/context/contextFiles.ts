// How the workspace context loaders read their files (PLAN.md D13, D27):
// the rules files, the skills and the memory index. A file is read as bytes
// and decoded by its byte-order mark, so a UTF-16 `AGENTS.md` (what Windows
// PowerShell 5.1's `>` writes) reads as the text it is instead of NUL
// garbage; a UTF-8 mark is dropped; text that is not valid in its encoding,
// or that still holds NUL characters, is refused with the reason rather than
// given to the model. A file the repository ships is confined to the
// workspace by canonical path (D24): a link or junction that leads outside it
// is refused. Pure: the host supplies the file system.

import { confineWorkspacePath } from '../backends/modelapi/tools'

export interface ContextIo {
  /** The file's bytes; undefined when it does not exist. */
  readFile(absolutePath: string): Promise<Uint8Array | undefined>
  /**
   * The names of the entries of an absolute directory that are directories
   * or links (symbolic links, junctions), whatever a link leads to, so a
   * broken one is reported by the reader rather than dropped; empty when the
   * directory is missing.
   */
  listDirectory(absolutePath: string): Promise<readonly string[]>
  /** The canonical form of an absolute path (links resolved, PLAN.md D24). */
  realPath(absolutePath: string): Promise<string>
}

export interface ContextReadDeps {
  readonly io: ContextIo
  readonly platform: NodeJS.Platform
}

export type ContextText =
  | { readonly ok: true; readonly text: string }
  /** `reason` reads after the file's name ("is not valid UTF-8 text"). */
  | { readonly ok: false; readonly reason: string }

type Encoding = 'utf8' | 'utf16le' | 'utf16be'

// The UTF-16 byte-order marks, one character per byte (as `imageDimensions`
// spells its signatures).
const UTF16LE_BOM = '\u{FF}\u{FE}'
const UTF16BE_BOM = '\u{FE}\u{FF}'
const INVALID_REASONS: Readonly<Record<Encoding, string>> = {
  utf8: 'is not valid UTF-8 text',
  utf16le: 'is not valid UTF-16LE text',
  utf16be: 'is not valid UTF-16BE text',
}
const NUL = '\0'
const NUL_REASON =
  'contains NUL characters (a binary file, or UTF-16 text without a byte-order mark)'

// `fatal`: a malformed sequence throws instead of becoming U+FFFD. Both
// decoders drop their own byte-order mark (`ignoreBOM` is false): EF BB BF
// for UTF-8, FF FE for UTF-16LE (a big-endian file's FE FF once swapped).
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const utf16Decoder = new TextDecoder('utf-16le', { fatal: true })

function hasMark(bytes: Uint8Array, mark: string): boolean {
  return String.fromCodePoint(...bytes.subarray(0, mark.length)) === mark
}

function encodingOf(bytes: Uint8Array): Encoding {
  if (hasMark(bytes, UTF16LE_BOM)) {
    return 'utf16le'
  }
  return hasMark(bytes, UTF16BE_BOM) ? 'utf16be' : 'utf8'
}

function decodeAs(encoding: Encoding, bytes: Uint8Array): string {
  switch (encoding) {
    case 'utf16le': {
      return utf16Decoder.decode(bytes)
    }
    case 'utf16be': {
      // Each code unit's bytes swapped (a copy); an odd length throws.
      return utf16Decoder.decode(Buffer.from(bytes).swap16())
    }
    case 'utf8': {
      return utf8Decoder.decode(bytes)
    }
  }
}

/**
 * A context file's text: UTF-16 (either byte order) by its mark, UTF-8
 * otherwise (its mark dropped); refused when the bytes are not valid in that
 * encoding or the text still holds NUL characters.
 */
export function decodeContextText(bytes: Uint8Array): ContextText {
  const encoding = encodingOf(bytes)
  let text: string
  try {
    text = decodeAs(encoding, bytes)
  } catch {
    return { ok: false, reason: INVALID_REASONS[encoding] }
  }
  return text.includes(NUL) ? { ok: false, reason: NUL_REASON } : { ok: true, text }
}

/**
 * One context file as text; undefined when it does not exist. With
 * `confineTo` (the workspace root, for the files a repository ships) a path
 * whose canonical form leaves that root is refused before it is read.
 */
export async function readContextText(
  deps: ContextReadDeps,
  absolutePath: string,
  confineTo: string | undefined,
): Promise<ContextText | undefined> {
  if (confineTo !== undefined) {
    const resolution = await confineWorkspacePath(confineTo, absolutePath, deps.platform, deps.io)
    if (!resolution.ok) {
      return { ok: false, reason: `is refused: ${resolution.reason}` }
    }
  }
  const bytes = await deps.io.readFile(absolutePath)
  return bytes === undefined ? undefined : decodeContextText(bytes)
}
