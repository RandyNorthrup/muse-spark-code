// The guarded process-start layer (PLAN.md D24): every program src/ starts
// by bare name resolves here, and every child environment is built here, so
// no program planted in a workspace ever runs. This module ships beside
// activation in its own bundle and is required from it, so the activation
// bundle carries none of it: only the entry re-exports it, and the split
// gate pins these files to that bundle.

import path from 'node:path'
import { realpathSync } from 'node:fs'
import { isCredentialVariable, withoutCredentials } from './credentialEnvironment'
import { isHostOnlyVariable } from './hostVariables'
import { vaultFenceEnvironment, type VaultFenceOptions } from './vault/exec/fence'
import {
  HOOK_FORBIDDEN_ENV_NAMES,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_PSMODULEPATH_SEGMENTS,
  WINDOWS_PSMODULEPATH_VARIABLE,
  type EnvironmentVariable,
} from '../shared/constants'
import type {
  ExecutableProbe,
  ExecutableScope,
  GuardedChildEnv,
  WorkspaceChild,
  WorkspacePathSanitizeProbe,
} from './executables'

const GIT = 'git'
const PATH_VARIABLE = 'PATH'

/**
Sets `name` in a copied environment. Windows names are case-insensitive
and Node passes the first of several spellings in sort order, so an
inherited `PSMODULEPATH` would beat a new `PSModulePath`: every other
spelling goes first.
*/
export function setEnvironmentVariable(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
  value: string,
): void {
  if (platform === 'win32') {
    const lower = name.toLowerCase()
    for (const key of Object.keys(env)) {
      if (key !== name && key.toLowerCase() === lower) {
        Reflect.deleteProperty(env, key)
      }
    }
  }
  env[name] = value
}

/** Reads `name` from a copied environment, ignoring case on Windows. */
export function environmentValue(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
): string | undefined {
  if (platform !== 'win32') {
    return env[name]
  }
  const lower = name.toLowerCase()
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : env[key]
}

/** Removes `name` (every spelling of it on Windows) from a copied environment. */
export function deleteEnvironmentVariable(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
): void {
  const lower = name.toLowerCase()
  for (const key of Object.keys(env)) {
    if (key === name || (platform === 'win32' && key.toLowerCase() === lower)) {
      Reflect.deleteProperty(env, key)
    }
  }
}

/**
Windows PowerShell 5.1's own module directories. A pwsh 7 `PSModulePath`
inherited by powershell.exe makes it load 7.x modules it cannot use
(verified failure: `Get-FileHash` not recognised).
*/
export function windowsPowerShellModulePath(
  systemRoot: string,
  programFiles: string | undefined,
): string {
  const base = programFiles ?? path.win32.join(systemRoot, '..', 'Program Files')
  return [
    path.win32.join(base, ...WINDOWS_PSMODULEPATH_SEGMENTS.programFiles),
    path.win32.join(systemRoot, ...WINDOWS_PSMODULEPATH_SEGMENTS.systemRoot),
  ].join(';')
}

const PROGRAM_FILES = 'ProgramFiles'

/**
The one rule for every Windows PowerShell 5.1 (`powershell.exe`) child: a
copy of `env` whose `PSModulePath`, every spelling of it, is Windows
PowerShell's own module directories, from which 5.1 builds its default
(it adds the person's own folder itself). VS Code or the agent started from
a PowerShell 7 terminal inherits pwsh 7's module path, which lists pwsh 7's
copies of the core modules first; 5.1 then fails to autoload some of them and
every cmdlet they hold fails (verified on Windows 11: `Get-Acl` and `Set-Acl`
of Microsoft.PowerShell.Security end in CouldNotAutoloadMatchingModule;
`Get-FileHash` was not recognised for `muse serve`'s launcher). PowerShell 7
repairs the variable only when it starts powershell.exe itself; a Node
process in between passes it on unchanged. A PowerShell 7 (`pwsh`) child
keeps its environment as it is. `programFiles` defaults to the
environment's own `ProgramFiles`.
*/
export function windowsPowerShellEnvironment<T extends NodeJS.ProcessEnv>(
  env: T,
  systemRoot: string,
  programFiles: string | undefined = environmentValue(env, 'win32', PROGRAM_FILES),
): T {
  const child = { ...env }
  setEnvironmentVariable(
    child,
    'win32',
    WINDOWS_PSMODULEPATH_VARIABLE,
    windowsPowerShellModulePath(systemRoot, programFiles),
  )
  return child
}

/**
The PATH entries worth probing: an empty or relative entry means the
current directory, which for `muse serve` is the workspace (PLAN.md D24).
On Windows a rooted `\foo` entry is drive-relative and resolves on the
working directory's drive, so only fully qualified entries are probed.
*/
export function absoluteEntries(
  probe: {
    readonly platform: NodeJS.Platform
    readonly pathEntries: readonly string[]
    readonly scope: ExecutableScope
  },
  p: path.PlatformPath,
): readonly string[] {
  const workspace = 'workspaceRoot' in probe.scope ? probe.scope : undefined
  return probe.pathEntries
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry !== '' &&
        p.isAbsolute(entry) &&
        (probe.platform !== 'win32' || isFullyQualifiedWindowsPath(entry)) &&
        (workspace === undefined || !isWorkspacePath(probe.platform, workspace, entry)),
    )
}

export interface ChildEnvironmentInput {
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  readonly extraVariables: readonly EnvironmentVariable[]
  readonly systemRoot: string | undefined
  readonly programFiles: string | undefined
  /** Supplied only by the capture-gated account owner, never settings or a page. */
  readonly accountHome?:
    | {
        readonly assertCurrent: () => void
        readonly configHome: string | undefined
      }
    | undefined
  /**
  The workspace the child runs in: PATH entries that are relative, empty,
  or inside it (resolved through links) are dropped, so no workspace
  program runs from PATH when Muse Code starts
  (docs/certification/pathguard.md). REQUIRED: with no folder open the
  caller passes the explicit no-workspace scope (absolute entries only,
  links followed).
  */
  readonly scope: ExecutableScope
}

/**
The environment for `muse serve`. On Windows `PSModulePath` is reset to the
Windows PowerShell module directories: the CLI's launcher runs under
powershell.exe 5.1, which cannot load its own modules when a pwsh 7 module
path is inherited (verified failure: `Get-FileHash` not recognised).

The Model API key from secret storage is deliberately NOT injected: the
CLI prefers `META_API_KEY` over its browser session, which would bill the
subscription's work to the key (PLAN.md D1, M7). A key already in the
user's own environment is inherited untouched, as the CLI documents.
*/
/**
The guarded environment for `muse serve`: PATH entries that would let a
workspace program run are dropped (relative, empty, or inside
`workspaceRoot`, resolved through links; with the explicit no-workspace
scope, relative, empty and drive-relative entries still go). On Windows
the child also gets `NoDefaultCurrentDirectoryInExePath`, so
CreateProcess does not try the working directory before PATH (probed on
Windows 11, Node 24.20: docs/certification/m21.md). Sanitizing PATH alone
does not close that lookup. Only the branded producers below can make the
returned environment, so a raw one never reaches the serve spawn.
*/
export function buildChildEnvironment(input: ChildEnvironmentInput): GuardedChildEnv {
  const env: NodeJS.ProcessEnv =
    input.platform === 'win32' && input.systemRoot !== undefined
      ? windowsPowerShellEnvironment(input.baseEnv, input.systemRoot, input.programFiles)
      : { ...input.baseEnv }
  for (const variable of input.extraVariables) {
    setEnvironmentVariable(env, input.platform, variable.name, variable.value)
  }
  if (input.accountHome !== undefined) {
    input.accountHome.assertCurrent()
  }
  if (input.accountHome?.configHome !== undefined) {
    // A CLI account must never silently use another account's inherited key
    // or the POSIX launcher's auth-file override. The default path keeps D1.
    for (const name of Object.keys(env)) {
      const upper = name.toUpperCase()
      if (
        upper === 'MUSE_AUTH_PATH' ||
        upper.endsWith('_API_KEY') ||
        HOOK_FORBIDDEN_ENV_NAMES.has(upper)
      )
        Reflect.deleteProperty(env, name)
    }
    setEnvironmentVariable(env, input.platform, 'XDG_CONFIG_HOME', input.accountHome.configHome)
  }
  // The guard runs after the person's variables, so a PATH from
  // `museSpark.environmentVariables` is sanitized like the inherited one and
  // cannot put a workspace entry back.
  return 'workspaceRoot' in input.scope
    ? workspaceChildEnvironment(input.platform, env, input.scope)
    : noWorkspaceChildEnvironment(input.platform, env, input.scope.realpath)
}

// `execFile` starts these directly; batch files need a shell.
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.com'] as const

/**
Whether a Windows path names its drive (or server and share), so it means
the same folder whatever the child's working directory is. `path.win32`
calls a rooted `\foo` or `/foo` absolute, but CreateProcess resolves it on
the working directory's drive — with the workspace as the working
directory that is the workspace's drive, so such an entry can name the
workspace. Only drive-letter (`D:\…`, `D:/…`) and UNC (`\\server\share\…`,
spelled with either slash — Windows accepts forward slashes in a UNC
path) entries are fully qualified; anything else rooted is drive-relative.
Separators are normalised before classifying, so `//server/share` and
`//?/C:/…` count as the UNC and verbatim paths they are instead of being
rewritten onto the workspace's drive.
*/
export function isFullyQualifiedWindowsPath(entry: string): boolean {
  const normalized = entry.replaceAll('/', '\\')
  return /^[a-z]:\\/iu.test(normalized) || normalized.startsWith('\\\\')
}

/**
The absolute, non-empty entries of a PATH value, in order. With a
workspace, entries inside it (resolved through `realpath` when given) are
dropped too, so a planted program on an absolute workspace PATH entry is
never probed.
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
Whether `candidate` is the workspace itself or inside it (resolved through
`realpath` when given, lexical otherwise), on `platform`'s terms: Windows
compares case-insensitively with verbatim prefixes stripped and loopback
admin shares mapped to their drive path.
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

/**
Compares two absolute paths on `platform`'s terms: separators normalised
to `/` (so Windows spellings compare on any host) and, on Windows,
case-insensitive. Device (`\\.\`, `//./`) and verbatim (`\\?\`, `//?/`)
prefixes are stripped, `\\.\UNC\` like `\\?\UNC\` maps to its plain share,
and a loopback admin share (`//localhost/C$/…`, `//127.0.0.1/C$/…`) maps
to its drive path, so every local spelling of the workspace compares as
the workspace itself. `.` and `..` collapse lexically and trailing
spaces and dots strip the way `GetFullPathName` strips them, so `..\…`,
`repo.\…` and `repo .` spellings of the workspace compare as the
workspace too (a run of two or more dots on a non-final segment stays a
distinct name). A
remote UNC name that cannot be proven local stays as it is: only the
local spellings above are mapped.
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
A Windows path with every local spelling collapsed to one comparison
form: lower-cased, device/verbatim prefixes stripped, loopback admin
shares mapped to their drive, `.`/`..` collapsed and trailing spaces and
dots stripped the way `GetFullPathName` strips them (`..` above the root
clamps). The final segment loses every trailing space and dot, so
`repo .` and `repo...` are `repo`. A non-final `name.` or `name .` names
`name` too, but a run of two or more dots on a non-final segment is a
distinct legal name (`repo...` is not `repo..`) and is kept. Drive-relative
and UNC roots keep their prefix; `..` never climbs past it.
*/
function withoutTrailingSpaces(value: string): string {
  return value.replace(/ +$/u, '')
}

/**
A final segment with every trailing space and dot stripped, so `repo .`
and `repo...` are both `repo`. Dots reveal spaces and spaces reveal dots
(`repo. ` strips to `repo`), so both are stripped until nothing moves.
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
a `work/../work/bin` entry names the workspace as surely as `work/bin`. */
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

/** System errors that mean a path could not be resolved (missing, refused, looping or misshapen). */
const RESOLVE_FALLBACK_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'ELOOP',
  'ENOTDIR',
  'ENAMETOOLONG',
])

/** Whether the path probe failed on an unresolvable path, with its code. */
function isUnresolvablePathError(error: unknown): error is Error & { readonly code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    RESOLVE_FALLBACK_CODES.has(error.code)
  )
}

function resolveForCompare(realpath: (filePath: string) => string, filePath: string): string {
  try {
    return realpath(filePath)
  } catch (error: unknown) {
    // An unresolvable path compares lexically; anything else keeps its kind.
    if (isUnresolvablePathError(error)) return filePath
    throw error
  }
}

/**
A PATH value with the workspace removed: entries that are empty,
relative, or inside `workspaceRoot` (resolved through links) are dropped,
on Windows, macOS and Linux alike. An empty or relative entry means the
working directory on every platform (and Windows also tries the current
directory before PATH), so with the workspace as the working directory a
planted program would otherwise run instead of the real one — as Muse
Code 1.4.9 proved with a planted `<workspace>/bin/bwrap` at `muse serve`
start (docs/certification/pathguard.md). On Windows a rooted `\foo` or
`/foo` entry is drive-relative and resolves on the child's drive, so it
is compared with the workspace root's drive applied (and dropped when the
root names no drive). Nothing else changes: kept entries stay
byte-identical and in order, and entries that cannot be resolved are kept
unless they are relative, empty, or lexically inside.
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

function brandGuarded(env: NodeJS.ProcessEnv): GuardedChildEnv {
  return env as GuardedChildEnv
}

/**
Whether `name` is a PATH spelling the guard handles: on Windows every
casing (the child reads the first spelling in block order, so a second
raw spelling would survive the first sanitizing empty — every spelling
is guarded); elsewhere only `PATH`.
*/
function isPathSpelling(platform: NodeJS.Platform, name: string): boolean {
  return platform === 'win32' ? name.toLowerCase() === 'path' : name === 'PATH'
}

/** Whether `name` is the Windows current-directory-exclusion variable. */
function isNoDefaultCwdGuard(name: string): boolean {
  return name.toLowerCase() === 'nodefaultcurrentdirectoryinexepath'
}

/**
Copies `env` while guarding every PATH spelling with `sanitizePath`
(a spelling with nothing left is deleted, never stored empty), dropping
any preset current-directory-exclusion variable, and setting the
canonical `NoDefaultCurrentDirectoryInExePath=1` on Windows so a preset
`0` cannot shadow it. Nothing else changes.
*/
function guardedEnvironmentEntries(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  sanitizePath: (pathVariable: string | undefined) => string,
): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {}
  const paths: [string, string][] = []
  for (const [name, value] of Object.entries(env)) {
    if (isPathSpelling(platform, name)) {
      const sanitized = sanitizePath(value)
      if (sanitized !== '') paths.push([name, sanitized])
    } else if (platform !== 'win32' || !isNoDefaultCwdGuard(name)) {
      kept[name] = value
    }
  }
  const child: NodeJS.ProcessEnv = { ...kept, ...Object.fromEntries(paths) }
  if (platform === 'win32') {
    child['NoDefaultCurrentDirectoryInExePath'] = '1'
  }
  return child
}

/**
One child environment for every spawn the product makes with the workspace
as its working directory or on its PATH: every PATH spelling sanitised by
`sanitizePathForWorkspace` (empty, relative, drive-relative and workspace
entries dropped; a spelling with nothing left deleted, never stored
empty), and `NoDefaultCurrentDirectoryInExePath=1` on Windows (any preset
spelling removed first, so a preset `0` cannot shadow it) so CreateProcess
does not try the working directory before PATH. Nothing else changes.
*/
export function workspaceChildEnvironment(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  workspace: WorkspaceChild,
): GuardedChildEnv {
  return brandGuarded(
    guardedEnvironmentEntries(platform, env, (pathVariable) =>
      sanitizePathForWorkspace({
        platform,
        pathVariable,
        workspaceRoot: workspace.workspaceRoot,
        realpath: workspace.realpath,
      }),
    ),
  )
}

/**
The guarded child environment before any folder is known (the explicit
no-workspace probe): empty and relative entries are still dropped and
Windows still gets `NoDefaultCurrentDirectoryInExePath`, but no workspace
is excluded. Only for probes that resolve fixed absolute paths and never
execute a PATH-resolved program; grep `NO_WORKSPACE` to review each one.
*/
export function noWorkspaceChildEnvironment(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  realpath: (filePath: string) => string,
): GuardedChildEnv {
  const p = platform === 'win32' ? path.win32 : path.posix
  const separator = platform === 'win32' ? ';' : ':'
  const sanitize = (pathVariable = ''): string =>
    pathVariable
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
      .join(separator)
  return brandGuarded(guardedEnvironmentEntries(platform, env, sanitize))
}

/**
The `KEY=value` environment block for a native helper that starts the
payload itself (`CreateProcessW` from its own environment array): only a
guarded child environment serializes, so a raw `request.env` cannot reach
a helper payload. Entries with `undefined` values are dropped, as the
helper's block parser rejects them.
*/
export function guardedEnvironmentBlock(env: GuardedChildEnv): string[] {
  return Object.entries(env).flatMap(([key, value]) =>
    value === undefined ? [] : `${key}=${value}`,
  )
}

/**
Every absolute path of `name` on PATH, in PATH order. A file that exists
need not run (macOS's Xcode stub exists while its tools are missing), so a
caller that executes what it resolves tries each in order until one works.
On Windows a name that already ends in `.exe` or `.com` (the OS adapters'
`rundll32.exe`, `explorer.exe`, `powershell.exe`) is looked up as named;
any other name gets those extensions, so a batch file never resolves.
*/
export function resolveAllExecutables(name: string, probe: ExecutableProbe): readonly string[] {
  const p = probe.platform === 'win32' ? path.win32 : path.posix
  const isNamedExecutable = WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) =>
    name.toLowerCase().endsWith(extension),
  )
  const candidates =
    isNamedExecutable || probe.platform !== 'win32'
      ? [name]
      : WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`)
  const found: string[] = []
  for (const directory of absolutePathEntries(probe.platform, probe.pathVariable, probe.scope)) {
    for (const candidate of candidates) {
      const full = p.join(directory, candidate)
      if (probe.fileExists(full)) {
        found.push(full)
      }
    }
  }
  return found
}

/**
The absolute path of `name` on PATH, or undefined when it is not there. On
Windows a name that already ends in `.exe` or `.com` (the OS adapters'
`rundll32.exe`, `explorer.exe`, `powershell.exe`) is looked up as named;
any other name gets those extensions, so a batch file never resolves.
*/
export function resolveExecutable(name: string, probe: ExecutableProbe): string | undefined {
  return resolveAllExecutables(name, probe).at(0)
}

const HOOK_ENV_NAMES = [
  'HOME',
  'PATH',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TERM',
] as const

// ProgramData: Windows' own OpenSSH reads its configuration there, and without
// it a hook's `ssh` or git over ssh exits 255 without a word.
const WINDOWS_HOOK_ENV_NAMES = [
  'COMSPEC',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'ProgramData',
] as const

/** The shell tool's environment, without host plumbing or unapproved credentials. */
export function shellEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  systemRoot: string | undefined,
  passNames: readonly string[] = [],
  isFenced = true,
  vault: VaultFenceOptions = {},
  scope: ExecutableScope,
): GuardedChildEnv {
  const kept: NodeJS.ProcessEnv = {}
  const entries = Object.entries(withoutCredentials(env, passNames, platform))
  for (const [key, value] of entries) {
    // One list for every child's environment (`core/hostVariables`, the names
    // VS Code's own terminal strips): matched without regard to case on
    // Windows, where a mixed-case spelling names the same variable.
    if (!isHostOnlyVariable(key, platform)) {
      kept[key] = value
    }
  }
  // The shell tool's interpreter on Windows is Windows PowerShell 5.1, so the
  // person's own `Get-Acl` and the like load 5.1's modules.
  const clean =
    platform === 'win32' && systemRoot !== undefined
      ? windowsPowerShellEnvironment(
          kept,
          systemRoot,
          environmentValue(env, platform, PROGRAM_FILES),
        )
      : kept
  const fenced = isFenced ? vaultFenceEnvironment(clean, { ...vault, passNames, platform }) : clean
  // Shell commands run with the workspace as their working directory: the
  // guarded child PATH plus `NoDefaultCurrentDirectoryInExePath` on
  // Windows, so a planted helper there never runs by bare name.
  return 'workspaceRoot' in scope
    ? { ...workspaceChildEnvironment(platform, fenced, scope) }
    : { ...noWorkspaceChildEnvironment(platform, fenced, scope.realpath) }
}

export function hookEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  extraNames: readonly string[] = [],
  scope: ExecutableScope,
): GuardedChildEnv {
  const clean: NodeJS.ProcessEnv = {}
  const names: readonly string[] =
    platform === 'win32'
      ? [...HOOK_ENV_NAMES, ...WINDOWS_HOOK_ENV_NAMES, ...extraNames]
      : [...HOOK_ENV_NAMES, ...extraNames]
  for (const name of names) {
    if (isCredentialVariable(name)) {
      continue
    }
    const value = environmentValue(env, platform, name)
    if (value === undefined) {
      continue
    }
    const normalizedName = platform === 'win32' ? name.toUpperCase() : name
    if (normalizedName === PATH_VARIABLE) {
      const pathApi = platform === 'win32' ? path.win32 : path.posix
      const delimiter = pathApi.delimiter
      const workspace = 'workspaceRoot' in scope ? scope : undefined
      setEnvironmentVariable(
        clean,
        platform,
        name,
        value
          .split(delimiter)
          .filter(
            (entry) =>
              pathApi.isAbsolute(entry) &&
              (platform !== 'win32' || isFullyQualifiedWindowsPath(entry)) &&
              (workspace === undefined || !isWorkspacePath(platform, workspace, entry)),
          )
          .join(delimiter),
      )
    } else if (normalizedName !== 'COMSPEC' || path.win32.isAbsolute(value)) {
      setEnvironmentVariable(clean, platform, name, value)
    }
  }
  const fenced = vaultFenceEnvironment(clean, { platform })
  // Hooks run with the workspace as their working directory: the guarded
  // child PATH plus `NoDefaultCurrentDirectoryInExePath` on Windows, so a
  // planted helper there never runs by bare name.
  return 'workspaceRoot' in scope
    ? { ...workspaceChildEnvironment(platform, fenced, scope) }
    : { ...noWorkspaceChildEnvironment(platform, fenced, scope.realpath) }
}

/**
git's absolute path, found once per PATH value and workspace; a miss is
not cached, so git installed while the window is open is found on the
next call. The run's working directory is the workspace: entries inside
it are never probed, so a planted git there never resolves
(docs/certification/pathguard.md).
*/
export function gitLocator(deps: {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly fileExists: (filePath: string) => boolean
  readonly realpath: (filePath: string) => string
}): (workspaceRoot: string) => string | undefined {
  let cache: { readonly key: string; readonly git: string } | undefined
  return (workspaceRoot) => {
    const pathValue = environmentValue(deps.env, deps.platform, PATH_VARIABLE)
    const key = JSON.stringify([pathValue, workspaceRoot])
    if (cache?.key !== key) {
      const git = resolveExecutable(GIT, {
        platform: deps.platform,
        pathVariable: pathValue,
        fileExists: deps.fileExists,
        scope: { workspaceRoot, realpath: deps.realpath },
      })
      cache = git === undefined ? undefined : { key, git }
    }
    return cache?.git
  }
}

/**
The extension's git environment: no optional locks, and never a
credential prompt. With the workspace the child runs in, its PATH is the
guarded child PATH (workspace entries dropped, empty/relative entries
dropped, `NoDefaultCurrentDirectoryInExePath=1` on Windows), so git's own
bare-name lookups (`ssh`, `git-remote-https`) never run a helper planted
in the repository.
*/
export function quietGitEnvironment(
  env: NodeJS.ProcessEnv,
  workspace: {
    readonly workspaceRoot: string
    readonly platform: NodeJS.Platform
    readonly realpath: (filePath: string) => string
  },
): GuardedChildEnv {
  const child = workspaceChildEnvironment(
    workspace.platform,
    { ...withoutCredentials(env), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    workspace,
  )
  child['GIT_OPTIONAL_LOCKS'] = '0'
  child['GIT_TERMINAL_PROMPT'] = '0'
  return child
}

/**
One environment for both launch routes, an allow-list per operation
(RVM123G2 R3): no credential variable at all, or for D104's exception
(a confirmed push, a pull request fetch) only the Git routes
GIT_PUSH_CREDENTIAL_VARIABLES names, never a model or provider key.
*/
export function childGitEnvironment(
  options: {
    readonly env: NodeJS.ProcessEnv
    readonly credentialRoutes?: readonly string[] | undefined
  },
  workspace: {
    readonly workspaceRoot: string
    readonly platform: NodeJS.Platform
    readonly realpath: (filePath: string) => string
  },
): GuardedChildEnv {
  const base =
    options.credentialRoutes === undefined
      ? withoutCredentials(options.env)
      : {
          ...withoutCredentials(options.env, options.credentialRoutes),
          GIT_TERMINAL_PROMPT: '0',
        }
  return workspaceChildEnvironment(workspace.platform, base, workspace)
}

const PATHEXT_VARIABLE = 'PATHEXT'

// The extensions `CreateProcess` starts, in Windows' default PATHEXT order.
const WINDOWS_LAUNCHABLE = ['.com', '.exe', '.bat', '.cmd'] as const

const WINDOWS_BATCH: ReadonlySet<string> = new Set(['.bat', '.cmd'])

const CMD_RELATIVE_PATH = String.raw`System32\cmd.exe`

// `/d` skips AutoRun; `/v:off` prevents inherited delayed expansion of `!`;
// `/s` keeps the quoted line as it is; `/c` runs it and ends.
const CMD_ARGUMENTS = ['/d', '/v:off', '/s', '/c'] as const

const CMD_UNQUOTABLE = /["%\r\n]/

const NUL = String.fromCodePoint(0)

const TRAILING_BACKSLASHES = /(\\+)$/

/** The extensions to try for a bare Windows name: PATHEXT's launchable ones, in its order. */
function windowsExtensions(env: NodeJS.ProcessEnv): readonly string[] {
  const listed = (environmentValue(env, 'win32', PATHEXT_VARIABLE) ?? '')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
  const known: readonly string[] = WINDOWS_LAUNCHABLE
  const ordered = listed.filter((extension) => known.includes(extension))
  return ordered.length === 0 ? WINDOWS_LAUNCHABLE : ordered
}

function candidatesFor(
  name: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  if (platform !== 'win32') {
    return [name]
  }
  const extension = path.win32.extname(name).toLowerCase()
  const known: readonly string[] = WINDOWS_LAUNCHABLE
  return known.includes(extension)
    ? [name]
    : windowsExtensions(env).map((candidate) => `${name}${candidate}`)
}

/**
The file the command names, absolute; throws with the reason when there
is none. A bare name is resolved on the absolute PATH entries outside the
server's working directory (resolved through links), so a planted `node`
there never wins; a command with a directory is the file the person's
config names, resolved against that directory.
*/
export function resolveServerCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  deps: {
    readonly platform: NodeJS.Platform
    readonly isExistingFile: (filePath: string) => boolean
  },
  scope: ExecutableScope,
): string {
  const p = deps.platform === 'win32' ? path.win32 : path.posix
  const name = p.basename(command)
  const hasDirectory =
    command.includes('/') || (deps.platform === 'win32' && command.includes('\\'))
  const directories = hasDirectory
    ? [p.dirname(p.resolve(cwd, command))]
    : absolutePathEntries(deps.platform, environmentValue(env, deps.platform, PATH_VARIABLE), scope)
  for (const directory of directories) {
    for (const candidate of candidatesFor(name, deps.platform, env)) {
      const full = p.join(directory, candidate)
      if (deps.isExistingFile(full)) {
        return full
      }
    }
  }
  throw new Error(
    hasDirectory
      ? `its command ${name} does not exist`
      : `its command ${name} was not found on the absolute entries of PATH`,
  )
}

/** One part of a cmd.exe line: quoted, with the backslashes before the closing quote doubled. */
export function cmdQuoted(part: string): string {
  if (CMD_UNQUOTABLE.test(part) || part.includes(NUL)) {
    throw new Error(
      'a batch-file server cannot be given a double quote, a percent sign or a line break; start its program directly',
    )
  }
  return `"${part.replace(TRAILING_BACKSLASHES, '$1$1')}"`
}

/** What `spawn` is given: the file itself, or cmd.exe running a batch file. */
export function spawnLine(
  file: string,
  args: readonly string[],
  deps: {
    readonly platform: NodeJS.Platform
    readonly systemRoot: string | undefined
  },
): { readonly file: string; readonly args: readonly string[]; readonly isVerbatim: boolean } {
  const isBatch =
    deps.platform === 'win32' && WINDOWS_BATCH.has(path.win32.extname(file).toLowerCase())
  if (!isBatch) {
    return { file, args, isVerbatim: false }
  }
  if (deps.systemRoot === undefined) {
    throw new Error('a batch-file server needs cmd.exe, and SystemRoot is not set')
  }
  const line = [file, ...args].map((part) => cmdQuoted(part)).join(' ')
  return {
    file: path.win32.join(deps.systemRoot, CMD_RELATIVE_PATH),
    args: [...CMD_ARGUMENTS, `"${line}"`],
    isVerbatim: true,
  }
}

/**
`%SystemRoot%`'s Windows PowerShell 5.1 with its own modules
(`Get-CimInstance`, `Add-Type`, `Get-Acl`), whatever shell VS Code came
from: the file and its credential-free environment under the one rule above
(`windowsPowerShellEnvironment`).
*/
export function windowsPowerShell(
  systemRoot: string,
  base: NodeJS.ProcessEnv = process.env,
): {
  readonly file: string
  readonly env: GuardedChildEnv
} {
  const env = windowsPowerShellEnvironment(withoutCredentials(base), systemRoot)
  // System PowerShell runs no workspace program: absolute entries only, links followed.
  return {
    file: path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
    env: noWorkspaceChildEnvironment('win32', env, realpathSync),
  }
}

/**
The compiled job helper (`MuseSparkJob-<digest>.exe`) run as a program of its
own, for every call into the job type but the shell tool's: the resource
governor's tree reads, job holder and created-path registry, the team
workers' file commands and process launches, the playbook's contained job and
its end by name, and the legacy shell stop. The shell tool's PowerShell loads
the same file as the type a command joins its job with; a call that only
needs the type costs one native start (about 40 ms) where a Windows
PowerShell start costs 200 ms and more, seconds on a busy machine. The helper
is a digest-named file the build put in the extension's storage: the path
must be absolute. The environment given is `SystemRoot` and the guard's
`NoDefaultCurrentDirectoryInExePath=1`: no credential, no module path. Node's
process start on Windows (libuv) then copies, from this process, each of
`HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `PATH`, `SYSTEMDRIVE`, `TEMP`,
`USERDOMAIN`, `USERNAME`, `USERPROFILE` and `WINDIR` that this process has:
it adds them to any environment that lacks them, and a variable can be
emptied but not left out. None is a credential. `PATH` is this process's
whole PATH, which is why a program the helper starts for a caller is named
by its absolute path (the playbook's git is `processGitPath`'s);
test/unit/jobHostNative.test.ts reads the set back.
*/
export function windowsJobHost(
  assemblyPath: string,
  systemRoot: string,
): {
  readonly file: string
  readonly env: GuardedChildEnv
} {
  if (!path.win32.isAbsolute(assemblyPath) || !path.win32.isAbsolute(systemRoot))
    throw new Error('Resource helper paths must be absolute')
  return {
    file: assemblyPath,
    env: noWorkspaceChildEnvironment('win32', { SystemRoot: systemRoot }, realpathSync),
  }
}
