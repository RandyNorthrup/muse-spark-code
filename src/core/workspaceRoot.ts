// The first workspace folder is the root (README, Requirements; PLAN.md
// D27): both backends run the agent there, so every workspace-relative path
// the extension shows, lists, reports or resolves is relative to it. A file
// VS Code attributes to a second folder is outside, as a file outside every
// folder is; a folder added inside the first one is part of it.
//
// Membership is VS Code's own: the folder `workspace.getWorkspaceFolder`
// names (its index), never a comparison of schemes or path strings, so its
// scheme, authority and path-casing rules apply. Pure: the host injects the
// lookups, over `vscode.Uri`.

import path from 'node:path'

export interface WorkspaceFolderRef<U> {
  /** `WorkspaceFolder.index`: 0 is the root. */
  readonly index: number
  readonly uri: U
}

export interface FolderLookup<U> {
  /** `workspace.getWorkspaceFolder(uri)`: the innermost folder holding `uri`, a folder's own URI naming itself. */
  readonly folderOf: (uri: U) => WorkspaceFolderRef<U> | undefined
  /**
   * `workspace.asRelativePath(uri, false)`: relative to the innermost folder
   * holding `uri`, and a folder's own URI relative to the folder around it.
   */
  readonly relativePath: (uri: U) => string
  /** The URI of the directory holding `uri`. */
  readonly parentOf: (uri: U) => U
  /** Whether two URIs name the same resource (`toString()` equality for `vscode.Uri`). */
  readonly isSame: (a: U, b: U) => boolean
}

function forward(relative: string): string {
  return relative.replaceAll('\\', '/')
}

/** Where a folder other than the root sits in it; undefined for a folder beside the root. */
function folderInRoot<U>(
  folder: WorkspaceFolderRef<U>,
  lookup: FolderLookup<U>,
): string | undefined {
  const around = lookup.folderOf(lookup.parentOf(folder.uri))
  // A folder VS Code attributes its own parent to (a file system root) ends the walk.
  return around === undefined || around.index === folder.index
    ? undefined
    : pathInRoot(around, forward(lookup.relativePath(folder.uri)), lookup)
}

/** `relative` (to `folder`) as a path relative to the root. */
function pathInRoot<U>(
  folder: WorkspaceFolderRef<U>,
  relative: string,
  lookup: FolderLookup<U>,
): string | undefined {
  if (folder.index === 0) {
    return relative
  }
  const base = folderInRoot(folder, lookup)
  return base === undefined ? undefined : `${base}/${relative}`
}

/**
 * The resource's path relative to the root, with forward slashes; undefined
 * for a resource VS Code attributes to no folder (an untitled document, a
 * git revision, a file elsewhere), to a folder beside the root, and for the
 * root itself. A folder added inside the root is where it sits in it.
 */
export function rootRelativePath<U>(uri: U, lookup: FolderLookup<U>): string | undefined {
  const folder = lookup.folderOf(uri)
  if (folder === undefined) {
    return undefined
  }
  if (lookup.isSame(folder.uri, uri)) {
    // A workspace folder's own URI: it has no path inside itself.
    return folder.index === 0 ? undefined : folderInRoot(folder, lookup)
  }
  return pathInRoot(folder, forward(lookup.relativePath(uri)), lookup)
}

/** The parts of a URI (`vscode.Uri` has them all). */
export interface UriParts {
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string
}

const REMOTE_SCHEME = 'vscode-remote'
const LOCAL_SCHEME = 'vscode-local'
const FILE_SCHEME = 'file'

/**
 * A URI the webview sent (a drop), as the extension host names the same
 * resource. In a remote window the panel runs on the UI side, where a file
 * of the remote workspace is `vscode-remote://<authority>/path` and a file
 * of the local machine `file:///path`, while this extension runs on the
 * remote side, where they are `file:///path` and `vscode-local:///path`:
 * the mapping VS Code's URI transformer applies to every URI that crosses
 * between them (microsoft/vscode `src/vs/base/common/uriTransformer.ts`),
 * which a string inside a webview message never gets (Claude Code #92403).
 * In a local window both sides name a resource alike.
 */
export function hostSideUri(parts: UriParts, remoteName: string | undefined): UriParts {
  if (remoteName === undefined) {
    return parts
  }
  if (parts.scheme === REMOTE_SCHEME) {
    return { ...parts, scheme: FILE_SCHEME, authority: '' }
  }
  return parts.scheme === FILE_SCHEME ? { ...parts, scheme: LOCAL_SCHEME } : parts
}

export function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/**
 * An absolute path as given; a relative one (the agent's, a link's) against
 * the root, never against another folder. Throws without a root rather than
 * resolving against the extension host's working directory.
 */
export function resolveAgainstRoot(
  filePath: string,
  root: string | undefined,
  platform: NodeJS.Platform,
): string {
  const p = pathModule(platform)
  if (p.isAbsolute(filePath)) {
    return filePath
  }
  if (root === undefined) {
    throw new Error(`${filePath} is relative and no folder is open`)
  }
  return p.join(root, filePath)
}
