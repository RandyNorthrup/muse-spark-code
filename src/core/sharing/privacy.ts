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
// Preserve URLs and relative paths. Unknown absolute paths are conservatively
// removed through the end of their quoted/line fragment, including spaces.
const OTHER_ABSOLUTE = /(?<![\w.:/\]-])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\r\n"'<>()[\],;]*/g

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
      let clean = text.replaceAll(FILE_URI, (uri) => localFilePath(uri))
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
      clean = clean.replaceAll(OTHER_ABSOLUTE, () => '[path]')
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
