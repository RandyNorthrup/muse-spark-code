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

/**
 * The explicit "no workspace" scope for a capability probe before any folder
 * is known: absolute PATH entries only, links followed. Grep for
 * `NO_WORKSPACE` to review every such probe: each must never execute a
 * program planted in a workspace, so it resolves fixed absolute paths or
 * re-resolves once a workspace is known.
 */
export const NO_WORKSPACE = 'absolute-entries-only-links-followed' as const

/**
 * Where an executable lookup runs: a workspace root with its link resolver
 * (directories inside it are never probed), or the explicit no-workspace
 * scope above. Both carry the realpath function: forgetting either is a
 * type error, so the compiler lists every call site that skipped the guard.
 */
export type ExecutableScope =
  | {
      readonly workspaceRoot: string
      readonly realpath: (filePath: string) => string
    }
  | {
      readonly noWorkspace: typeof NO_WORKSPACE
      readonly realpath: (filePath: string) => string
    }

export interface ExecutableProbe {
  readonly platform: NodeJS.Platform
  /** The PATH value, unsplit. */
  readonly pathVariable: string | undefined
  readonly fileExists: (filePath: string) => boolean
  /** REQUIRED: the workspace the child runs in, or the explicit no-workspace scope. */
  readonly scope: ExecutableScope
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
  scope: ExecutableScope,
): readonly string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const separator = platform === 'win32' ? ';' : ':'
  const workspace =
    'workspaceRoot' in scope
      ? { workspaceRoot: scope.workspaceRoot, realpath: scope.realpath }
      : undefined
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
  workspace: {
    readonly workspaceRoot: string
    readonly realpath: (filePath: string) => string
  },
  candidate: string,
): boolean {
  return isSameOrInsideDirectory(
    platform,
    resolveForCompare(workspace.realpath, workspace.workspaceRoot),
    resolveForCompare(workspace.realpath, candidate),
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
 * case-insensitive. Device (`\\.\`, `//./`) and verbatim (`\\?\`, `//?/`)
 * prefixes are stripped, `\\.\UNC\` like `\\?\UNC\` maps to its plain share,
 * and a loopback admin share (`//localhost/C$/…`, `//127.0.0.1/C$/…`) maps
 * to its drive path, so every local spelling of the workspace compares as
 * the workspace itself. `.` and `..` collapse lexically and trailing
 * spaces and dots strip the way `GetFullPathName` strips them, so `..\…`,
 * `repo.\…` and `repo .` spellings of the workspace compare as the
 * workspace too (a run of two or more dots on a non-final segment stays a
 * distinct name). A
 * remote UNC name that cannot be proven local stays as it is: only the
 * local spellings above are mapped.
 */
function isSameOrInsideDirectory(
  platform: NodeJS.Platform,
  directory: string,
  candidate: string,
): boolean {
  const normalize = (value: string): string => {
    const slashed = value.replaceAll('\\', '/').replaceAll(/\/+$/g, '')
    return platform === 'win32' ? normalizeWindowsSpelling(slashed) : collapsePosix(slashed)
  }
  const root = normalize(directory)
  const target = normalize(candidate)
  return target === root || target.startsWith(`${root}/`)
}

/**
 * A Windows path with every local spelling collapsed to one comparison
 * form: lower-cased, device/verbatim prefixes stripped, loopback admin
 * shares mapped to their drive, `.`/`..` collapsed and trailing spaces and
 * dots stripped the way `GetFullPathName` strips them (`..` above the root
 * clamps). The final segment loses every trailing space and dot, so
 * `repo .` and `repo...` are `repo`. A non-final `name.` or `name .` names
 * `name` too, but a run of two or more dots on a non-final segment is a
 * distinct legal name (`repo...` is not `repo..`) and is kept. Drive-relative
 * and UNC roots keep their prefix; `..` never climbs past it.
 */
function withoutTrailingSpaces(value: string): string {
  return value.replace(/ +$/u, '')
}

/**
 * A final segment with every trailing space and dot stripped, so `repo .`
 * and `repo...` are both `repo`. Dots reveal spaces and spaces reveal dots
 * (`repo. ` strips to `repo`), so both are stripped until nothing moves.
 */
function stripFinalSegment(raw: string): string {
  let segment = raw
  for (;;) {
    const fewer = withoutTrailingSpaces(segment.replace(/\.+$/u, ''))
    if (fewer === segment) {
      return segment
    }
    segment = fewer
  }
}

function normalizeWindowsSpelling(slashed: string): string {
  let rest = slashed.toLowerCase()
  if (rest.startsWith('//./unc/')) {
    rest = `//${rest.slice('//./unc/'.length)}`
  } else if (rest.startsWith('//?/unc/')) {
    rest = `//${rest.slice('//?/unc/'.length)}`
  } else if (rest.startsWith('//./')) {
    rest = rest.slice('//./'.length)
  } else if (rest.startsWith('//?/')) {
    rest = rest.slice('//?/'.length)
  }
  const adminShare = /^\/\/(?:localhost|127\.0\.0\.1)\/([a-z])\$(\/.*)?$/u.exec(rest)
  if (adminShare?.[1] !== undefined) {
    rest = `${adminShare[1]}:${adminShare[2] ?? ''}`
  }
  const drive = /^[a-z]:(?=\/|$)/u.exec(rest)
  const unc = /^\/\/[^/]+\/[^/]+/u.exec(rest)
  const prefix = drive?.[0] ?? unc?.[0] ?? ''
  const kept: string[] = []
  const segments = rest.slice(prefix.length).split('/')
  for (let index = 0; index < segments.length; index += 1) {
    const isFinal = index === segments.length - 1
    // A `..` with trailing spaces still climbs.
    let segment = withoutTrailingSpaces(segments[index] ?? '')
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      kept.pop()
      continue
    }
    if (isFinal) {
      segment = stripFinalSegment(segment)
    } else if (segment.endsWith('.') && !segment.endsWith('..')) {
      // One trailing dot, the space-then-dot mix included (`repo .` is
      // `repo`); a run of two or more dots stays a distinct name.
      segment = withoutTrailingSpaces(segment.slice(0, -1))
    }
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      kept.pop()
      continue
    }
    kept.push(segment)
  }
  return kept.length === 0 ? prefix : `${prefix}/${kept.join('/')}`
}

/** POSIX needs no spelling map, but `.` and `..` still collapse lexically:
 * a `work/../work/bin` entry names the workspace as surely as `work/bin`. */
function collapsePosix(slashed: string): string {
  const kept: string[] = []
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      kept.pop()
      continue
    }
    kept.push(segment)
  }
  return `/${kept.join('/')}`
}

function resolveForCompare(realpath: (filePath: string) => string, filePath: string): string {
  try {
    return realpath(filePath)
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
  const root = resolveForCompare(probe.realpath, probe.workspaceRoot)
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
    if (isSameOrInsideDirectory(probe.platform, root, resolveForCompare(probe.realpath, trimmed))) {
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
      if (
        isSameOrInsideDirectory(probe.platform, root, resolveForCompare(probe.realpath, candidate))
      ) {
        continue
      }
    }
    kept.push(entry)
  }
  return kept.join(separator)
}

export interface WorkspaceChild {
  /** The workspace the child runs in (its working directory). */
  readonly workspaceRoot: string
  /**
   * Resolves links in an entry or the workspace root; may throw (an entry
   * that cannot be resolved is compared lexically instead). REQUIRED: a
   * lexical-only comparison keeps a symlink into the workspace on PATH.
   */
  readonly realpath: (filePath: string) => string
}

declare const guardedChildEnvBrand: unique symbol

/**
 * A child environment the guard produced: only `workspaceChildEnvironment`
 * (or `noWorkspaceChildEnvironment` for the explicit no-workspace probe)
 * can make one. Every spawn helper for a product-chosen program takes this
 * type, so passing a raw `process.env` is a type error the compiler lists.
 */
export type GuardedChildEnv = NodeJS.ProcessEnv & {
  readonly [guardedChildEnvBrand]: true
}

function brandGuarded(env: NodeJS.ProcessEnv): GuardedChildEnv {
  return env as GuardedChildEnv
}

/**
 * One child environment for every spawn the product makes with the workspace
 * as its working directory or on its PATH: PATH sanitised by
 * `sanitizePathForWorkspace` (empty, relative, drive-relative and workspace
 * entries dropped; a PATH with nothing left deleted, never stored empty),
 * and `NoDefaultCurrentDirectoryInExePath=1` on Windows so CreateProcess
 * does not try the working directory before PATH. Nothing else changes.
 */
/**
 * The `KEY=value` environment block for a native helper that starts the
 * payload itself (`CreateProcessW` from its own environment array): only a
 * guarded child environment serializes, so a raw `request.env` cannot reach
 * a helper payload. Entries with `undefined` values are dropped, as the
 * helper's block parser rejects them.
 */
export function guardedEnvironmentBlock(env: GuardedChildEnv): string[] {
  return Object.entries(env).flatMap(([key, value]) =>
    value === undefined ? [] : [`${key}=${value}`],
  )
}

export function workspaceChildEnvironment(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  workspace: WorkspaceChild,
): GuardedChildEnv {
  const pathName =
    platform === 'win32'
      ? (Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH')
      : 'PATH'
  const sanitized = sanitizePathForWorkspace({
    platform,
    pathVariable: env[pathName],
    workspaceRoot: workspace.workspaceRoot,
    realpath: workspace.realpath,
  })
  const { [pathName]: _removed, ...kept } = env
  const child: NodeJS.ProcessEnv =
    sanitized === '' ? { ...kept } : { ...kept, [pathName]: sanitized }
  if (platform === 'win32') {
    child['NoDefaultCurrentDirectoryInExePath'] = '1'
  }
  return brandGuarded(child)
}

/**
 * The guarded child environment before any folder is known (the explicit
 * no-workspace probe): empty and relative entries are still dropped and
 * Windows still gets `NoDefaultCurrentDirectoryInExePath`, but no workspace
 * is excluded. Only for probes that resolve fixed absolute paths and never
 * execute a PATH-resolved program; grep `NO_WORKSPACE` to review each one.
 */
export function noWorkspaceChildEnvironment(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  realpath: (filePath: string) => string,
): GuardedChildEnv {
  const pathName =
    platform === 'win32'
      ? (Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH')
      : 'PATH'
  const p = platform === 'win32' ? path.win32 : path.posix
  const separator = platform === 'win32' ? ';' : ':'
  const keptEntries = (env[pathName] ?? '')
    .split(separator)
    .filter((entry) => {
      const trimmed = entry.trim()
      return (
        trimmed !== '' &&
        p.isAbsolute(trimmed) &&
        (platform !== 'win32' || isFullyQualifiedWindowsPath(trimmed))
      )
    })
    .map((entry) => {
      try {
        void realpath(entry)
      } catch {
        /* An entry that cannot be resolved stays as written. */
      }
      return entry
    })
  const { [pathName]: _removed, ...kept } = env
  const child: NodeJS.ProcessEnv =
    keptEntries.length === 0 ? { ...kept } : { ...kept, [pathName]: keptEntries.join(separator) }
  if (platform === 'win32') {
    child['NoDefaultCurrentDirectoryInExePath'] = '1'
  }
  return brandGuarded(child)
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
  for (const directory of absolutePathEntries(probe.platform, probe.pathVariable, probe.scope)) {
    for (const candidate of candidates) {
      const full = p.join(directory, candidate)
      if (probe.fileExists(full)) {
        return full
      }
    }
  }
  return undefined
}
