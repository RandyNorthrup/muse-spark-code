// Finding a program on PATH without the working directory (PLAN.md D24).
// A bare name handed to `spawn` / `execFile` is looked up by the platform:
// libuv on Windows tries the current directory before PATH, and an empty or
// relative PATH entry means "here" on every platform. With the workspace as
// the working directory, a `git.exe` or `bash` committed to a repository
// would run instead of the real one. This resolver takes only absolute PATH
// entries, and on Windows only the extensions `execFile` can start without a
// shell (a `.cmd` needs one, and a shell string is banned, D4). Pure: the
// file probe is injected.

import path from 'node:path'

export interface ExecutableProbe {
  readonly platform: NodeJS.Platform
  /** The PATH value, unsplit. */
  readonly pathVariable: string | undefined
  readonly fileExists: (filePath: string) => boolean
  /**
   * The workspace the child runs in: directories inside it are never
   * probed, so a program planted on an absolute workspace PATH entry never
   * resolves. Absent leaves every absolute entry probed, as before.
   */
  readonly workspaceRoot?: string
  /**
   * Resolves links for the workspace comparison; injected so the Windows,
   * macOS and Linux branches are all unit-tested on any OS. Absent means
   * lexical comparison only.
   */
  readonly realpath?: (filePath: string) => string
}

// `execFile` starts these directly; batch files need a shell.
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.com'] as const

/**
 * Whether a Windows path names its drive (or server and share), so it means
 * the same folder whatever the child's working directory is. `path.win32`
 * calls a rooted `\foo` or `/foo` absolute, but CreateProcess resolves it on
 * the working directory's drive — with the workspace as the working
 * directory that is the workspace's drive, so such an entry can name the
 * workspace. Only drive-letter (`D:\…`, `D:/…`) and UNC (`\\server\share\…`,
 * spelled with either slash — Windows accepts forward slashes in a UNC
 * path) entries are fully qualified; anything else rooted is drive-relative.
 * Separators are normalised before classifying, so `//server/share` and
 * `//?/C:/…` count as the UNC and verbatim paths they are instead of being
 * rewritten onto the workspace's drive.
 */
export function isFullyQualifiedWindowsPath(entry: string): boolean {
  const normalized = entry.replaceAll('/', '\\')
  return /^[a-z]:\\/iu.test(normalized) || normalized.startsWith('\\\\')
}

/**
 * The absolute, non-empty entries of a PATH value, in order. With a
 * workspace, entries inside it (resolved through `realpath` when given) are
 * dropped too, so a planted program on an absolute workspace PATH entry is
 * never probed.
 */
export function absolutePathEntries(
  platform: NodeJS.Platform,
  pathVariable: string | undefined,
  workspace?: { readonly workspaceRoot: string; readonly realpath?: (filePath: string) => string },
): readonly string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const separator = platform === 'win32' ? ';' : ':'
  return (pathVariable ?? '')
    .split(separator)
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry !== '' &&
        p.isAbsolute(entry) &&
        (platform !== 'win32' || isFullyQualifiedWindowsPath(entry)) &&
        (workspace === undefined || !isWorkspacePath(platform, workspace, entry)),
    )
}

/**
 * Whether `candidate` is the workspace itself or inside it (resolved through
 * `realpath` when given, lexical otherwise), on `platform`'s terms: Windows
 * compares case-insensitively with verbatim prefixes stripped and loopback
 * admin shares mapped to their drive path.
 */
export function isWorkspacePath(
  platform: NodeJS.Platform,
  workspace: { readonly workspaceRoot: string; readonly realpath?: (filePath: string) => string },
  candidate: string,
): boolean {
  return isSameOrInsideDirectory(
    platform,
    resolveForCompare(workspace, workspace.workspaceRoot),
    resolveForCompare(workspace, candidate),
  )
}

export interface WorkspacePathSanitizeProbe {
  readonly platform: NodeJS.Platform
  /** The PATH value, unsplit. */
  readonly pathVariable: string | undefined
  /** The workspace the child runs in (its working directory). */
  readonly workspaceRoot: string
  /**
   * Resolves links in an entry or the workspace root; may throw (an entry
   * that cannot be resolved is compared lexically instead). Injected so the
   * Windows, macOS and Linux branches are all unit-tested on any OS.
   */
  readonly realpath: (filePath: string) => string
}

/**
 * Compares two absolute paths on `platform`'s terms: separators normalised
 * to `/` (so Windows spellings compare on any host) and, on Windows,
 * case-insensitive. Verbatim `\\?\` (`//?/`) prefixes are stripped, so a
 * verbatim spelling of the workspace compares as the workspace; a loopback
 * admin share (`//localhost/C$/…`, `//127.0.0.1/C$/…`) is mapped to its
 * drive path, so an admin share of the workspace directory compares as the
 * workspace itself. A remote UNC name that cannot be proven local stays as
 * it is: only the local spellings above are mapped.
 */
function isSameOrInsideDirectory(
  platform: NodeJS.Platform,
  directory: string,
  candidate: string,
): boolean {
  const normalize = (value: string): string => {
    let slashed = value.replaceAll('\\', '/').replaceAll(/\/+$/g, '')
    if (platform === 'win32') {
      slashed = slashed.toLowerCase()
      if (slashed.startsWith('//?/unc/')) {
        slashed = `//${slashed.slice('//?/unc/'.length)}`
      } else if (slashed.startsWith('//?/')) {
        slashed = slashed.slice('//?/'.length)
      }
      const adminShare = /^\/\/(?:localhost|127\.0\.0\.1)\/([a-z])\$(\/.*)?$/u.exec(slashed)
      if (adminShare?.[1] !== undefined) {
        slashed = `${adminShare[1]}:${adminShare[2] ?? ''}`
      }
    }
    return slashed
  }
  const root = normalize(directory)
  const target = normalize(candidate)
  return target === root || target.startsWith(`${root}/`)
}

function resolveForCompare(
  probe: { readonly realpath?: (filePath: string) => string },
  filePath: string,
): string {
  if (probe.realpath === undefined) {
    return filePath
  }
  try {
    return probe.realpath(filePath)
  } catch {
    return filePath
  }
}

/**
 * A PATH value with the workspace removed: entries that are empty,
 * relative, or inside `workspaceRoot` (resolved through links) are dropped,
 * on Windows, macOS and Linux alike. An empty or relative entry means the
 * working directory on every platform (and Windows also tries the current
 * directory before PATH), so with the workspace as the working directory a
 * planted program would otherwise run instead of the real one — as Muse
 * Code 1.4.9 proved with a planted `<workspace>/bin/bwrap` at `muse serve`
 * start (docs/certification/pathguard.md). On Windows a rooted `\foo` or
 * `/foo` entry is drive-relative and resolves on the child's drive, so it
 * is compared with the workspace root's drive applied (and dropped when the
 * root names no drive). Nothing else changes: kept entries stay
 * byte-identical and in order, and entries that cannot be resolved are kept
 * unless they are relative, empty, or lexically inside.
 */
export function sanitizePathForWorkspace(probe: WorkspacePathSanitizeProbe): string {
  const p = probe.platform === 'win32' ? path.win32 : path.posix
  const separator = probe.platform === 'win32' ? ';' : ':'
  const root = resolveForCompare(probe, probe.workspaceRoot)
  const entries = (probe.pathVariable ?? '').split(separator)
  const kept: string[] = []
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (trimmed === '' || !p.isAbsolute(trimmed)) {
      continue
    }
    // The original entry is resolved as itself: a forward-slash UNC or
    // verbatim spelling of the workspace must compare as the workspace, not
    // as a drive-rewritten path that no longer names it.
    if (isSameOrInsideDirectory(probe.platform, root, resolveForCompare(probe, trimmed))) {
      continue
    }
    // A rooted `\foo` or `/foo` entry is drive-relative: the child resolves
    // it on its own working directory's drive, which is the workspace's
    // drive, so compare it with that drive applied too. Without a drive on
    // the workspace root there is nothing safe to resolve it against: drop it.
    if (probe.platform === 'win32' && !isFullyQualifiedWindowsPath(trimmed)) {
      const drive = /^([a-z]:)/iu.exec(root)?.[1]
      if (drive === undefined) {
        continue
      }
      const candidate = `${drive}${trimmed.replaceAll('/', '\\')}`
      if (isSameOrInsideDirectory(probe.platform, root, resolveForCompare(probe, candidate))) {
        continue
      }
    }
    kept.push(entry)
  }
  return kept.join(separator)
}

/**
 * The absolute path of `name` on PATH, or undefined when it is not there. On
 * Windows a name that already ends in `.exe` or `.com` (the OS adapters'
 * `rundll32.exe`, `explorer.exe`, `powershell.exe`) is looked up as named;
 * any other name gets those extensions, so a batch file never resolves.
 */
export function resolveExecutable(name: string, probe: ExecutableProbe): string | undefined {
  const p = probe.platform === 'win32' ? path.win32 : path.posix
  const isNamedExecutable = WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) =>
    name.toLowerCase().endsWith(extension),
  )
  const candidates =
    isNamedExecutable || probe.platform !== 'win32'
      ? [name]
      : WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`)
  const workspace =
    probe.workspaceRoot === undefined
      ? undefined
      : { workspaceRoot: probe.workspaceRoot, realpath: probe.realpath }
  for (const directory of absolutePathEntries(probe.platform, probe.pathVariable, workspace)) {
    for (const candidate of candidates) {
      const full = p.join(directory, candidate)
      if (probe.fileExists(full)) {
        return full
      }
    }
  }
  return undefined
}
