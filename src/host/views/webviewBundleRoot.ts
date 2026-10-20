// The webview bundle's one shared root resolver (VSIXWEB A). Every panel
// that serves the webview bundle resolves its `localResourceRoots`/script
// root through `resolveWebviewBundleDir`, never by joining the extension
// path itself: a packaged install (the solid archive beside `dist/`)
// extracts once per archive digest into the extension's own global storage
// and serves the verified copy; the source tree, a dev build and tests
// (no archive) serve `dist/webview` as today. The extracted folder is
// named by the archive's own digest, older digests are removed, and every
// file's SHA-256 is checked against the archive's record before the first
// panel uses it and on every activation that reuses it. A missing,
// damaged or unwritable extraction throws `WebviewBundleError`: the panel
// shows the fixed sentence and logs the cause, never serving unverified
// files. Content Security Policy, `asWebviewUri` and chunk loading keep
// working: the folder holds the exact archived bytes, so the HTML each
// panel builds is unchanged except the root.
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { parseSolidTextArchive, solidMemberBytes } from '../../core/archives/solidTextArchive'
import { isCodedError } from '../../core/workspaceRoot'
import {
  WEBVIEW_ARCHIVE_DIR_PREFIX,
  WEBVIEW_ARCHIVE_FILE,
  WEBVIEW_ARCHIVE_MAX_BYTES,
  WEBVIEW_ARCHIVE_MEMBER_MAX_BYTES,
  WEBVIEW_ARCHIVE_VERSION,
  WEBVIEW_DIST_SEGMENTS,
} from '../../shared/constants'

/** Where the webview bundle lives: the install and the machine's storage. */
export interface WebviewBundleLocations {
  readonly extensionPath: string
  readonly globalStoragePath: string
}

/** Why the webview bundle has no verified folder to serve. */
export type WebviewBundleFailureKind = 'missing' | 'damaged' | 'unwritable'

/** A panel shows the fixed sentence and logs the cause, never the files. */
export class WebviewBundleError extends Error {
  public constructor(
    public readonly kind: WebviewBundleFailureKind,
    message: string,
  ) {
    super(message)
    this.name = 'WebviewBundleError'
  }
}

/** The loose bundle and its packaged archive beside the module. */
function bundlePaths(extensionPath: string): {
  readonly looseDir: string
  readonly archive: string
} {
  const looseDir = path.join(extensionPath, ...WEBVIEW_DIST_SEGMENTS)
  return { looseDir, archive: path.join(path.dirname(looseDir), WEBVIEW_ARCHIVE_FILE) }
}

/** A damaged archive reads as the bundle failure carrying its cause, never raw. */
function bundleDamage(message: string, cause: unknown): WebviewBundleError {
  return Object.assign(new WebviewBundleError('damaged', message), { cause })
}

/** Every archived member's exact bytes, SHA-256 checked, size-bounded. */
function archivedMembers(packed: Buffer): Map<string, Buffer> {
  try {
    const files = parseSolidTextArchive(packed, WEBVIEW_ARCHIVE_MAX_BYTES, WEBVIEW_ARCHIVE_VERSION)
    const members = new Map<string, Buffer>()
    for (const [relative, entry] of Object.entries(files)) {
      const bytes = solidMemberBytes(entry, relative)
      if (bytes.byteLength > WEBVIEW_ARCHIVE_MEMBER_MAX_BYTES)
        throw new WebviewBundleError('damaged', `Webview member is over its bound: ${relative}`)
      members.set(relative, bytes)
    }
    if (members.size === 0)
      throw new WebviewBundleError('damaged', 'Webview archive holds no members')
    return members
  } catch (error: unknown) {
    if (error instanceof WebviewBundleError) throw error
    throw bundleDamage('Webview archive cannot be verified', error)
  }
}

/** Every extracted file still matches the archive's record. */
function verifyExtracted(target: string, members: Map<string, Buffer>): void {
  for (const [relative, expected] of members) {
    let actual: Buffer
    try {
      actual = readFileSync(path.join(target, ...relative.split('/')))
    } catch (error: unknown) {
      if (isCodedError(error))
        throw new WebviewBundleError(
          'damaged',
          `Webview member is missing from storage: ${relative}`,
        )
      throw error
    }
    if (!actual.equals(expected))
      throw new WebviewBundleError('damaged', `Webview member failed verification: ${relative}`)
  }
}

/** The verified members written under `target`; a failure removes the half-written copy. */
function extractMembers(target: string, members: Map<string, Buffer>): void {
  try {
    mkdirSync(target, { recursive: true })
    for (const [relative, bytes] of members) {
      const file = path.join(target, ...relative.split('/'))
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, bytes)
    }
  } catch (error: unknown) {
    rmSync(target, { recursive: true, force: true })
    if (error instanceof WebviewBundleError) throw error
    if (isCodedError(error))
      throw new WebviewBundleError(
        'unwritable',
        `Webview bundle cannot be written to storage: ${target}`,
      )
    throw error
  }
}

/** Folders from earlier archive digests, named by the same prefix. */
function removeStaleDigests(globalStoragePath: string, current: string): void {
  let names: readonly string[]
  try {
    names = readdirSync(globalStoragePath)
  } catch (error: unknown) {
    if (isCodedError(error)) return
    throw error
  }
  for (const name of names) {
    if (!name.startsWith(WEBVIEW_ARCHIVE_DIR_PREFIX)) continue
    const folder = path.join(globalStoragePath, name)
    if (folder === current) continue
    try {
      if (lstatSync(folder).isDirectory()) rmSync(folder, { recursive: true, force: true })
    } catch (error: unknown) {
      if (isCodedError(error)) continue
      throw error
    }
  }
}

/**
The verified folder serving the webview bundle: the archive extracted
once per digest under global storage in a packaged install, the loose
`dist/webview` directory otherwise. Throws `WebviewBundleError` when no
verified folder can be served.
*/
export function resolveWebviewBundleDir(locations: WebviewBundleLocations): string {
  const { looseDir, archive } = bundlePaths(locations.extensionPath)
  if (!existsSync(archive)) {
    // No archive: the source tree, a dev build, tests. A missing loose
    // directory fails the panel visibly rather than serving nothing.
    try {
      if (!lstatSync(looseDir).isDirectory())
        throw new WebviewBundleError('missing', `Webview bundle is missing: ${looseDir}`)
    } catch (error: unknown) {
      if (error instanceof WebviewBundleError) throw error
      if (isCodedError(error))
        throw new WebviewBundleError('missing', `Webview bundle cannot be read: ${looseDir}`)
      throw error
    }
    return looseDir
  }
  let packed: Buffer
  try {
    packed = readFileSync(archive)
  } catch (error: unknown) {
    if (isCodedError(error))
      throw new WebviewBundleError('damaged', `Webview archive cannot be read: ${archive}`)
    throw error
  }
  const members = archivedMembers(packed)
  const digest = createHash('sha256').update(packed).digest('hex')
  try {
    mkdirSync(locations.globalStoragePath, { recursive: true })
  } catch (error: unknown) {
    if (isCodedError(error))
      throw new WebviewBundleError(
        'unwritable',
        `Webview bundle cannot use storage: ${locations.globalStoragePath}`,
      )
    throw error
  }
  const target = path.join(locations.globalStoragePath, `${WEBVIEW_ARCHIVE_DIR_PREFIX}${digest}`)
  if (existsSync(target)) {
    try {
      verifyExtracted(target, members)
      return target
    } catch (error: unknown) {
      // A stored copy that no longer verifies is dropped and extracted
      // again from the archive; a bad archive still refuses below.
      if (!(error instanceof WebviewBundleError)) throw error
      rmSync(target, { recursive: true, force: true })
    }
  }
  extractMembers(target, members)
  removeStaleDigests(locations.globalStoragePath, target)
  return target
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character)
}

/**
The document a panel shows instead of an unverified bundle: the fixed
sentence, no scripts, no remote origins, so the failure needs no bundle
at all.
*/
export function webviewBundleErrorHtml(sentence: string, locale: string): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<title>${escapeHtml(sentence)}</title></head>
<body><main><p>${escapeHtml(sentence)}</p></main></body></html>`
}
