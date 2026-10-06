import type { SharePrivacyPort } from '../../shared/share'
import { scrubTransferIdentifiers } from '../export/sessionTransfer'

export interface ChatSharePrivacyContext {
  readonly workspaceRoots: readonly string[]
  readonly home: string
  readonly userName: string
  /** M108/M109 bind their current in-memory registry here; no value is retained. */
  readonly redactRegisteredSecrets: (text: string) => string
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g
const SEPARATORS = /[\\/]+/g
const FILE_URI = /\bfile:\/\/[^\s"'<>]+/gi
// Tokenize without crossing whitespace; recognition below distinguishes paths
// from division, slash commands, closing tags, URLs and escaped regex literals.
const PATH_TOKENS = /(?:(?<![\p{L}\p{N}_])[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>()[\]{},;]*/gu
const PATH_BOUNDARY = /[\s"'()[\]{}=]/
const PATH_PREFIX = /(?:^|[\s"'()[\]{}=])[\p{L}\p{N}_-]+:$/u
const PATH_END = /[\s"'<>()[\]{},;]/
const POSIX_SEGMENT = /^[\p{L}\p{N}._~!$&+%@=-]+$/u

function isPathBoundary(token: string, offset: number, text: string): boolean {
  if (text.slice(0, offset).endsWith('[home]')) return false
  // A label's colon is a boundary; a URL's scheme separator is not.
  if (
    offset > 0 &&
    !PATH_BOUNDARY.test(text[offset - 1] ?? '') &&
    (token.startsWith('//') || !PATH_PREFIX.test(text.slice(0, offset)))
  )
    return false
  return true
}

function isAbsolutePath(token: string, offset: number, text: string): boolean {
  if (!isPathBoundary(token, offset, text)) return false
  if (/^[A-Za-z]:[\\/]/.test(token)) return true
  const segments = token
    .split(token.startsWith(String.raw`\\`) ? SEPARATORS : '/')
    .filter((segment) => segment !== '')
  return segments.length >= 2 && segments.every((segment) => POSIX_SEGMENT.test(segment))
}

function escaped(text: string): string {
  return text.replaceAll(REGEXP_SPECIAL, String.raw`\$&`)
}

function canonicalPath(text: string): string {
  return `${text.startsWith(String.raw`\\`) || text.startsWith('//') ? '/' : ''}${text.replaceAll(SEPARATORS, '/')}`
}

function rootPattern(root: string): string {
  return root
    .split('/')
    .map((segment) => escaped(segment))
    .join(String.raw`[\\/]+`)
}

function localFilePath(uri: string): string {
  const path = uri.slice('file://'.length).replace(/^localhost(?=\/)/i, '')
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // A malformed local URI is private too, never a link to follow.
  }
  if (/^\/[A-Za-z]:\//.test(decoded)) return decoded.slice(1)
  return decoded.startsWith('/') ? decoded : `//${decoded}`
}

/** Editor-independent adapter; registry calls always read its current values. */
export function createChatSharePrivacy(context: ChatSharePrivacyContext): SharePrivacyPort {
  const roots = context.workspaceRoots
    .filter((root) => root !== '')
    .map((root) => canonicalPath(root).replace(/\/+$/, ''))
    .filter((root) => root !== '')
    .toSorted((a, b) => b.length - a.length)
  const home = canonicalPath(context.home).replace(/\/+$/, '')
  return {
    redactRegisteredSecrets: (text) =>
      scrubTransferIdentifiers(context.redactRegisteredSecrets(text)),
    normalisePaths: (text) => {
      const filePaths = new Set<string>()
      let clean = text.replaceAll(FILE_URI, (uri) => {
        const path = localFilePath(uri)
        filePaths.add(path)
        return path
      })
      for (const root of roots) {
        // Match whole roots, not a similarly named neighbour. Root folding
        // follows M84: separators and Windows case, with names containing spaces.
        const pattern = new RegExp(
          String.raw`(?<![\w./])${rootPattern(root)}(?=[\\/]|$|[\s"'<>])(?:[\\/]+([^\r\n"'<>()[\],;]*))?`,
          'gi',
        )
        clean = clean.replaceAll(pattern, (_match: string, tail: string | undefined) =>
          tail === undefined ? '.' : canonicalPath(tail),
        )
      }
      if (home !== '') {
        const pattern = new RegExp(
          String.raw`${rootPattern(home)}(?=[\\/]|$|[\s"'<>])(?:[\\/]+([^\r\n"'<>()[\],;]*))?`,
          'gi',
        )
        clean = clean.replaceAll(pattern, (_match: string, tail: string | undefined) =>
          tail === undefined ? '[home]' : `[home]/${canonicalPath(tail)}`,
        )
      }
      // File URIs explicitly identify local paths, including single-segment
      // names and decoded spaces. Known roots/home have already been folded.
      for (const path of filePaths) {
        clean = clean.replaceAll(path, (token: string, offset: number, text: string) =>
          isPathBoundary(token, offset, text) &&
          (offset + token.length === text.length ||
            PATH_END.test(text[offset + token.length] ?? ''))
            ? '[path]'
            : token,
        )
      }
      clean = clean.replaceAll(PATH_TOKENS, (token: string, offset: number, text: string) =>
        isAbsolutePath(token, offset, text) ? '[path]' : token,
      )
      if (context.userName !== '') {
        const pattern = new RegExp(
          String.raw`(?<![\p{L}\p{N}_])${escaped(context.userName)}(?![\p{L}\p{N}_])`,
          'giu',
        )
        clean = clean.replaceAll(pattern, () => '[user]')
      }
      // Decoding a local URI can expose a registered value or digest that
      // was encoded during the first scrub. Read the current registry again.
      return scrubTransferIdentifiers(context.redactRegisteredSecrets(clean))
    },
  }
}
