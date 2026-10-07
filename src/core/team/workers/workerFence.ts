import type { RefFenceVerdict } from '../refFence'
import type { MuseWorkerApprovalRequest, MuseWorkerApprovalAnswer } from './museCodeWorker'
import type { AcpPermissionInput, AcpPermissionVerdict, AcpPreset, AcpPresetId } from './acpWorker'
// One admission authority for every team worker (PLAN.md M96 W-F1-W-F3).
// Names locate objects; only native identities establish containment.
import { open, realpath } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { handleIdentity } from '../../fs/fileIdentity'
import { scrubWorkerEnv } from './workerEnv'
import { fileIdentityKey, statIdentity } from '../../fs/fileIdentity'
import { homedir } from 'node:os'
import { pathModule } from '../../workspaceRoot'
import type { RealPathIo } from '../../workspacePath'
import { isProtectedPath } from '../../protectedPaths'
import { isGlobMatch } from '../../backends/modelapi/globLimits'
import { commandShape, looseWords, type ShellDialect } from '../../backends/modelapi/shellSyntax'
import {
  WORKER_ACP_MAX_PERMISSION_PATHS,
  WORKER_FILE_PATH_TIMEOUT_MS,
  WORKER_FILE_PATH_BUFFER_CHARS,
} from '../../../shared/constants'
import type { WorkerRolePolicy } from './workerTypes'

export interface WorkerFenceIo extends RealPathIo {
  /** Windows volume serial + file index; POSIX device + inode. Never a path string. */
  readonly pathIdentity: (canonicalPath: string) => Promise<string>
  readonly openFile?: (absolute: string, isWrite: boolean) => Promise<WorkerFileHandle>
}

export interface WorkerFileHandle {
  readonly identify: () => Promise<{ readonly absolute: string; readonly identity: string }>
  readonly read: (maxBytes: number) => Promise<string | undefined>
  readonly write: (content: string) => Promise<void>
  readonly close: () => Promise<void>
}

// stdin is a duplicate of the already-open file handle, never a filename.
const WINDOWS_HANDLE_PATH = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -TypeDefinition '
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WorkerFilePath {
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern uint GetFinalPathNameByHandle(IntPtr h, StringBuilder b, uint n, uint flags);
 public static string Read(int capacity) {
  var b = new StringBuilder(capacity);
  var n = GetFinalPathNameByHandle(GetStdHandle(-10), b, (uint)capacity, 0);
  if (n == 0 || n >= capacity) throw new System.ComponentModel.Win32Exception();
  return b.ToString();
 }
}'
[WorkerFilePath]::Read(${String(WORKER_FILE_PATH_BUFFER_CHARS)}) | ConvertTo-Json -Compress
`

async function windowsHandlePath(fd: number): Promise<string> {
  const systemRoot = process.env['SystemRoot'] ?? process.env['SYSTEMROOT']
  if (systemRoot === undefined) throw new MuseWorkerFolderError()
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      pathModule('win32').join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_HANDLE_PATH],
      {
        windowsHide: true,
        stdio: [fd, 'pipe', 'ignore'],
        env: scrubWorkerEnv({ platform: process.platform, baseEnv: process.env }),
      },
    )
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new MuseWorkerFolderError())
    }, WORKER_FILE_PATH_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.length <= WORKER_FILE_PATH_BUFFER_CHARS * 2) return
      child.kill()
      reject(new MuseWorkerFolderError())
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        if (code !== 0) throw new MuseWorkerFolderError()
        resolve(z.string().parse(JSON.parse(output)))
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new MuseWorkerFolderError())
      }
    })
  })
}

async function openWorkerFile(absolute: string, isWrite: boolean): Promise<WorkerFileHandle> {
  const handle = await open(absolute, isWrite ? 'r+' : 'r')
  return {
    identify: async () => {
      const identity = fileIdentityKey(await handleIdentity(handle))
      if (identity === undefined) throw new MuseWorkerFolderError()
      let final: string
      if (process.platform === 'win32') final = await windowsHandlePath(handle.fd)
      else if (process.platform === 'darwin') {
        // macOS fd paths are not symlinks; lsof reads the kernel's fd name.
        const result = await promisify(execFile)(
          '/usr/sbin/lsof',
          ['-a', '-p', String(process.pid), '-d', String(handle.fd), '-Fn'],
          {
            timeout: WORKER_FILE_PATH_TIMEOUT_MS,
            env: {
              ...scrubWorkerEnv({ platform: process.platform, baseEnv: process.env }),
              LC_CTYPE: 'en_US.UTF-8',
            },
          },
        )
        const names = result.stdout.split('\n').filter((line) => line.startsWith('n'))
        if (names.length !== 1 || names[0] === undefined) throw new MuseWorkerFolderError()
        final = await realpath(names[0].slice(1))
      } else final = await realpath(`/proc/self/fd/${String(handle.fd)}`)
      final = final.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
      if ((await workerPathIdentity(final)) !== identity) throw new MuseWorkerFolderError()
      return { absolute: final, identity }
    },
    read: async (maxBytes) => {
      const stats = await handle.stat()
      const buffer = Buffer.alloc(Math.min(stats.size, maxBytes))
      const result = await handle.read(buffer, 0, buffer.length, 0)
      return buffer.subarray(0, result.bytesRead).toString('utf8')
    },
    write: async (content) => {
      await handle.truncate(0)
      await handle.writeFile(content, 'utf8')
    },
    close: () => handle.close(),
  }
}

/** Node/libuv's Windows stat obtains volume/file identity from a native handle. */
export async function workerPathIdentity(canonicalPath: string): Promise<string> {
  const key = fileIdentityKey(await statIdentity(canonicalPath))
  if (key === undefined) throw new Error('The filesystem did not supply a file identity')
  return key
}

export const WORKER_NATIVE_IO: WorkerFenceIo = {
  realPath: realpath,
  pathIdentity: workerPathIdentity,
  openFile: openWorkerFile,
}

export class MuseWorkerFolderError extends Error {
  public constructor() {
    super('A worker starts in its admitted working copy')
    this.name = 'MuseWorkerFolderError'
  }
}

interface IdentifiedPath {
  readonly absolute: string
  readonly identity: string
}

const grantTag: unique symbol = Symbol('worker root admission')
export interface WorkerRootGrant {
  readonly absolute: string
  readonly [grantTag]: true
}
const grants = new WeakMap<WorkerRootGrant, IdentifiedPath>()

export async function recheckWorkerRoot(
  input: WorkerPathInput,
  grant: WorkerRootGrant,
): Promise<string> {
  const admitted = grants.get(grant)
  if (admitted === undefined) throw new MuseWorkerFolderError()
  for (const given of [input.folder, grant.absolute]) {
    const current = await identify(given, input.platform, input.io)
    if (current.identity !== admitted.identity) throw new MuseWorkerFolderError()
  }
  return grant.absolute
}

async function identify(
  given: string,
  platform: NodeJS.Platform,
  io: WorkerFenceIo,
): Promise<IdentifiedPath> {
  const absolute = await io.realPath(given)
  if (!pathModule(platform).isAbsolute(absolute)) throw new MuseWorkerFolderError()
  const identity = await io.pathIdentity(absolute)
  if (identity.trim() === '') throw new MuseWorkerFolderError()
  return { absolute, identity }
}

/** Includes the object itself, then every resolved ancestor (including volume/share root). */
async function lineage(
  target: IdentifiedPath,
  platform: NodeJS.Platform,
  io: WorkerFenceIo,
): Promise<readonly IdentifiedPath[]> {
  const p = pathModule(platform)
  const entries: IdentifiedPath[] = [target]
  const seen = new Set([target.identity])
  let current = target.absolute
  for (;;) {
    const parent = p.dirname(current)
    if (parent === current) return entries
    const resolved = await identify(parent, platform, io)
    if (seen.has(resolved.identity)) throw new MuseWorkerFolderError()
    seen.add(resolved.identity)
    entries.push(resolved)
    current = resolved.absolute
  }
}

/** Grants one native root identity. External workers never accept in-place. */
export async function assertWorkerRoot(input: {
  readonly workspaceRoot: string
  readonly folder: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
  readonly isInPlace?: boolean
  readonly role?: WorkerRolePolicy
  readonly grant?: WorkerRootGrant
}): Promise<WorkerRootGrant> {
  try {
    if (input.grant !== undefined) {
      await recheckWorkerRoot(input, input.grant)
      return input.grant
    }
    if (input.role?.workspaceMode === 'in-place' && input.isInPlace !== true)
      throw new MuseWorkerFolderError()
    const [checkout, worker] = await Promise.all([
      identify(input.workspaceRoot, input.platform, input.io),
      identify(input.folder, input.platform, input.io),
    ])
    if (input.isInPlace === true) {
      if (checkout.identity !== worker.identity) throw new MuseWorkerFolderError()
    } else {
      const [checkoutParents, workerParents] = await Promise.all([
        lineage(checkout, input.platform, input.io),
        lineage(worker, input.platform, input.io),
      ])
      if (
        workerParents.some((entry) => entry.identity === checkout.identity) ||
        checkoutParents.some((entry) => entry.identity === worker.identity)
      )
        throw new MuseWorkerFolderError()
    }
    const grant: WorkerRootGrant = Object.freeze({
      absolute: worker.absolute,
      [grantTag]: true as const,
    })
    grants.set(grant, worker)
    await recheckWorkerRoot(input, grant)
    return grant
  } catch {
    throw new MuseWorkerFolderError()
  }
}

export interface WorkerPathInput {
  readonly folder: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
  readonly workspaceRoot: string
  readonly isInPlace?: boolean
  readonly grant?: WorkerRootGrant
}

type WorkerPath =
  | {
      readonly ok: true
      readonly absolute: string
      readonly checkedAbsolute: string
      readonly relative: string
      readonly canonical: string
    }
  | { readonly ok: false }

function isWorkerPathNameAllowed(absolute: string, platform: NodeJS.Platform): boolean {
  const p = pathModule(platform)
  const segments = absolute.slice(p.parse(absolute).root.length).split(/[\\/]/)
  return (
    platform !== 'win32' ||
    segments.every(
      (segment) =>
        !segment.includes(':') &&
        !/[. ]$/.test(segment) &&
        !/^(?:con|prn|aux|nul|conin\$|conout\$|com\d|lpt\d)(?:\..*)?$/i.test(segment),
    )
  )
}

/** Unresolvable targets (including new files) refuse; there is no textual fallback. */
export async function confineWorkerPath(
  input: WorkerPathInput,
  given: string,
): Promise<WorkerPath> {
  try {
    if (given.trim() === '' || given.includes('\0')) return { ok: false }
    const p = pathModule(input.platform)
    const grant = input.grant ?? (await assertWorkerRoot(input))
    const root = await recheckWorkerRoot(input, grant)
    const expanded = /^~(?:[\\/]|$)/.test(given) ? p.join(homedir(), given.slice(1)) : given
    const absolute = p.resolve(root, expanded)
    if (!isWorkerPathNameAllowed(absolute, input.platform)) return { ok: false }
    const [base, target] = await Promise.all([
      identify(root, input.platform, input.io),
      identify(absolute, input.platform, input.io),
    ])
    if (base.identity !== grants.get(grant)?.identity) return { ok: false }
    const parents = await lineage(target, input.platform, input.io)
    const rootIndex = parents.findIndex((entry) => entry.identity === base.identity)
    if (rootIndex === -1) return { ok: false }
    const canonical = parents
      .slice(0, rootIndex)
      .toReversed()
      .map((entry) => p.basename(entry.absolute))
      .join('/')
    return {
      ok: true,
      absolute: target.absolute,
      checkedAbsolute: target.absolute,
      relative: p.relative(root, absolute).split(p.sep).join('/'),
      canonical,
    }
  } catch {
    return { ok: false }
  }
}

/** Check the handle's name and identity, then operate only on that handle. */
export async function withWorkerFile<T>(
  input: WorkerPathInput,
  given: string,
  isWrite: boolean,
  work: (handle: WorkerFileHandle, path: Extract<WorkerPath, { ok: true }>) => Promise<T>,
): Promise<T> {
  const grant = input.grant ?? (await assertWorkerRoot(input))
  const root = await recheckWorkerRoot(input, grant)
  if (input.io.openFile === undefined || given.trim() === '' || given.includes('\0'))
    throw new MuseWorkerFolderError()
  const p = pathModule(input.platform)
  const expanded = /^~(?:[\\/]|$)/.test(given) ? p.join(homedir(), given.slice(1)) : given
  const absolute = p.resolve(root, expanded)
  if (!isWorkerPathNameAllowed(absolute, input.platform)) throw new MuseWorkerFolderError()
  const handle = await input.io.openFile(absolute, isWrite)
  try {
    const target = await handle.identify()
    if (!p.isAbsolute(target.absolute) || !isWorkerPathNameAllowed(target.absolute, input.platform))
      throw new MuseWorkerFolderError()
    const parents = await lineage(target, input.platform, input.io)
    const rootIndex = parents.findIndex((entry) => entry.identity === grants.get(grant)?.identity)
    if (rootIndex === -1) throw new MuseWorkerFolderError()
    const relative = p.relative(root, target.absolute).split(p.sep).join('/')
    const canonical = parents
      .slice(0, rootIndex)
      .toReversed()
      .map((entry) => p.basename(entry.absolute))
      .join('/')
    const confined = {
      ok: true as const,
      absolute: target.absolute,
      checkedAbsolute: target.absolute,
      relative,
      canonical,
    }
    await recheckWorkerRoot(input, grant)
    return await work(handle, confined)
  } finally {
    await handle.close()
  }
}

/** M77's generic host resolves paths through the same worker admission authority. */
export function bindWorkerPathIo(
  input: WorkerPathInput & { readonly workspaceRoot: string },
): RealPathIo {
  return {
    realPath: async (given) => {
      const resolved = await confineWorkerPath(input, given)
      if (!resolved.ok) throw new MuseWorkerFolderError()
      return resolved.checkedAbsolute
    },
  }
}

export interface ExtractedRequestPaths {
  readonly paths: readonly string[]
  readonly isTruncated: boolean
}

/** Path keys and path-shaped values are checked recursively; unknown structure fails closed. */
export function extractRequestPaths(rawInput: unknown): ExtractedRequestPaths {
  const paths: string[] = []
  let isTruncated = false
  const visit = (value: unknown, depth: number, isPath = false): void => {
    if (isTruncated) return
    if (typeof value === 'string') {
      if (isPath || /^(?:[\\/~]|\.\.?[\\/]|[a-z]:[\\/])/i.test(value)) {
        if (paths.length >= WORKER_ACP_MAX_PERMISSION_PATHS) isTruncated = true
        else paths.push(value)
      }
      return
    }
    if (value === null || typeof value !== 'object') return
    if (depth <= 0) {
      isTruncated = true
      return
    }
    for (const [key, entry] of Object.entries(value))
      visit(
        entry,
        depth - 1,
        isPath ||
          /(?:path|file|directory|folder|root|cwd|^from$|^to$|^source$|^destination$)/i.test(key),
      )
  }
  visit(rawInput, 2)
  return { paths, isTruncated }
}

function gitRefused(
  command: string,
  reason: string,
): Extract<RefFenceVerdict, { readonly allowed: false }> {
  return { allowed: false, command, reason }
}

/** Global git options a worker may pass before the subcommand. */
const ALLOWED_GIT_GLOBALS = new Set([
  '--no-pager',
  '--no-optional-locks',
  '--no-replace-objects',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
])

/** A global option that smuggles repository configuration into the call. */
const CONFIG_OPTIONS = new Set(['-c', '--config', '--config-env'])
/** A global option that points git at another repository. */
const REPO_DIR_OPTIONS = ['--git-dir', '--work-tree', '--super-prefix']
/** Help and version output: no repository needed, nothing moved. */
const HELP_OPTIONS = new Set(['--help', '--version', 'help'])

/** Subcommands that never move a ref, reach another repository or write. */
const ALLOWED_GIT_COMMANDS = new Set([
  'status',
  'log',
  'show',
  'diff',
  'grep',
  'blame',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'rev-list',
  'cat-file',
  'show-ref',
  'for-each-ref',
  'count-objects',
  'fsck',
  'verify-pack',
  'verify-commit',
  'verify-tag',
  'hash-object',
  'check-ref-format',
  'check-ignore',
  'check-attr',
  'check-mailmap',
  'name-rev',
  'describe',
  'merge-base',
  'shortlog',
  'var',
  'version',
])

const REFUSED_COMMIT_COMMANDS = new Set([
  'commit',
  'merge',
  'rebase',
  'reset',
  'revert',
  'cherry-pick',
  'cherry',
  'checkout',
  'switch',
  'restore',
  'am',
  'apply', // `apply` writes the worktree from a patch; workers edit with tools.
])
const REFUSED_REF_COMMANDS = new Set([
  'branch',
  'tag',
  'update-ref',
  'symbolic-ref',
  'notes',
  'replace',
])
const REFUSED_REMOTE_COMMANDS = new Set([
  'fetch',
  'pull',
  'push',
  'remote',
  'clone',
  'ls-remote',
  'submodule',
  'archive', // `archive --remote=` reaches another repository.
  'bundle',
])
const REFUSED_STATE_COMMANDS = new Set(['stash', 'worktree', 'bisect', 'config'])

/** `branch`/`tag` list flags: anything else (a name, `-f`, `-d`) moves refs. */
const LIST_ONLY_FLAGS = new Set([
  '--list',
  '--show-current',
  '--all',
  '--remotes',
  '--verbose',
  '--color',
  '--no-color',
  '--column',
  '--no-column',
  '--sort',
  '--format',
  '--contains',
  '--no-contains',
  '--merged',
  '--no-merged',
  '--points-at',
])
const LIST_ONLY_SHORT = new Set(['-l', '-a', '-r', '-v', '-n'])

/**
 * A worker's `git` argument list, refused at call admission. Every git
 * command that commits, merges, rebases, resets, checks out or switches,
 * moves or deletes a branch or tag, edits a ref, adds or removes a
 * worktree, stashes, reaches another repository, or smuggles configuration
 * (`-c credential.helper=…`, `--git-dir`, `-C <elsewhere>`) is refused.
 * Unknown subcommands are refused too: the guard is fail-closed.
 */
export function classifyWorkerGitCommand(args: readonly string[]): RefFenceVerdict {
  const words = [...args]
  const command = words.join(' ')
  let index = 0
  // Global options before the subcommand.
  while (index < words.length) {
    const token = words[index] ?? ''
    if (CONFIG_OPTIONS.has(token)) {
      return gitRefused(command, 'gitConfig')
    }
    if (token === '-C' || REPO_DIR_OPTIONS.some((option) => token.startsWith(option))) {
      return gitRefused(command, 'outsideRepo')
    }
    if (token === '--' || token === '-' || !token.startsWith('-')) {
      break
    }
    if (token.startsWith('--')) {
      const name = token.split('=', 1)[0] ?? token
      if (!ALLOWED_GIT_GLOBALS.has(name)) {
        return gitRefused(command, 'gitOption')
      }
      index += 1
      continue
    }
    // All short globals, including `-p` (--paginate), are refused.
    return gitRefused(command, 'gitOption')
  }
  const subcommand = words[index] ?? ''
  if (subcommand === '' || HELP_OPTIONS.has(subcommand)) {
    return { allowed: true }
  }
  if (subcommand === '--') {
    return gitRefused(command, 'unknownGitCommand')
  }
  if (REFUSED_COMMIT_COMMANDS.has(subcommand)) {
    return gitRefused(command, 'gitCommit')
  }
  if (REFUSED_REF_COMMANDS.has(subcommand)) {
    const isListable = subcommand === 'branch' || subcommand === 'tag'
    return isListable && isListOnly(words.slice(index + 1))
      ? checkGitOptions(words.slice(index + 1), command)
      : gitRefused(command, 'gitRefMove')
  }
  if (REFUSED_REMOTE_COMMANDS.has(subcommand)) {
    return gitRefused(command, 'gitRemote')
  }
  if (subcommand === 'worktree' && words[index + 1] === 'list') {
    const rest = words.slice(index + 2)
    return rest.every((word) => ['--porcelain', '-z', '-v', '--verbose'].includes(word))
      ? checkGitOptions(rest, command)
      : gitRefused(command, 'gitState')
  }
  if (REFUSED_STATE_COMMANDS.has(subcommand)) {
    return gitRefused(command, 'gitState')
  }
  return ALLOWED_GIT_COMMANDS.has(subcommand)
    ? checkGitOptions(words.slice(index + 1), command)
    : gitRefused(command, 'unknownGitCommand')
}

/** `branch`/`tag` with only list flags and no ref names. */
function isListOnly(rest: readonly string[]): boolean {
  for (const token of rest) {
    if (token === '--' || token === '-' || !token.startsWith('-')) {
      return false
    }
    if (token.startsWith('--')) {
      const name = token.split('=', 1)[0] ?? token
      if (name !== '--list' && !LIST_ONLY_FLAGS.has(name)) {
        return false
      }
      continue
    }
    for (const flag of token.slice(1)) {
      if (!LIST_ONLY_SHORT.has(`-${flag}`)) {
        return false
      }
    }
  }
  return true
}

/** An option that writes a file (`git diff --output=…`) is refused. */
const WRITE_OPTIONS = new Set([
  '--output',
  '-o',
  '-w',
  '-O',
  '--lost-found',
  '--ext-diff',
  '--textconv',
  '--filters',
  '--open-files-in-pager',
  '--exec-path',
])

function checkGitOptions(rest: readonly string[], command: string): RefFenceVerdict {
  const end = rest.indexOf('--')
  const options = rest.slice(0, end === -1 ? undefined : end)
  for (const token of options) {
    if (token === '-' || !token.startsWith('-')) {
      continue
    }
    const name = token.split('=', 1)[0] ?? token
    if (
      WRITE_OPTIONS.has(name) ||
      (name.startsWith('--') && [...WRITE_OPTIONS].some((option) => option.startsWith(name)))
    ) {
      return gitRefused(command, 'refusedOption')
    }
    if (!token.startsWith('--')) {
      for (const flag of token.slice(1)) {
        if (WRITE_OPTIONS.has(`-${flag}`)) {
          return gitRefused(command, 'refusedOption')
        }
      }
    }
  }
  return { allowed: true }
}

function isGitExecutable(word: string): boolean {
  const name = word.split(/[/\\]/).at(-1)?.toLowerCase() ?? ''
  const suffixes = new Set([
    '.exe',
    '.cmd',
    '.bat',
    '.com',
    ...(process.env['PATHEXT'] ?? '').toLowerCase().split(';'),
  ])
  return (
    name === 'git' ||
    [...suffixes].some((suffix) => suffix.startsWith('.') && name === `git${suffix}`)
  )
}

/** The tokenizer supplies only argv after the executable. Unknown Git
 * commands and program-running options refuse through this one classifier. */
export function isRefMovingGitCommand(words: readonly string[]): boolean {
  const index = words.findIndex((word) => isGitExecutable(word))
  return index !== -1 && !classifyWorkerGitCommand(words.slice(index + 1)).allowed
}

export async function isWorkerWriteAllowed(
  input: {
    readonly role: WorkerRolePolicy
    readonly folder: string
    readonly platform: NodeJS.Platform
    readonly io: WorkerFenceIo
    readonly workspaceRoot: string
    readonly grant?: WorkerRootGrant
  },
  given: string,
): Promise<boolean> {
  if (
    given.trim() === '' ||
    input.role.workspaceMode === 'read-only' ||
    !input.role.toolGroups.includes('write')
  ) {
    return false
  }
  const confined = await confineWorkerPath(input, given)
  return confined.ok && isCheckedWorkerWriteAllowed(input.role, confined)
}

export function isCheckedWorkerWriteAllowed(
  role: WorkerRolePolicy,
  confined: Extract<WorkerPath, { ok: true }>,
): boolean {
  if (
    role.workspaceMode === 'read-only' ||
    !role.toolGroups.includes('write') ||
    isProtectedPath(confined.relative) ||
    isProtectedPath(confined.canonical)
  ) {
    return false
  }
  return (
    role.writePaths === undefined ||
    role.writePaths.some((pattern) => {
      try {
        return isGlobMatch(confined.canonical, pattern)
      } catch {
        // An invalid role glob cannot grant a write.
        return false
      }
    })
  )
}

/** Full role commands, plain syntax, and refused options bind both adapters. */
export async function isWorkerCommandAllowed(
  input: WorkerPathInput & {
    readonly workspaceRoot: string
    readonly role: WorkerRolePolicy
    readonly command: string
    readonly dialect: ShellDialect
    readonly readOnlyCommands: ReadonlySet<string>
    readonly testCommands?: ReadonlySet<string>
  },
): Promise<boolean> {
  const shape = commandShape(input.command, input.dialect)
  if (!shape.isPlain || shape.commands.length !== 1 || hasRefMove(input.command, input.dialect)) {
    return false
  }
  try {
    await assertWorkerRoot(input)
  } catch {
    return false
  }
  const words = shape.commands[0] ?? []
  const executable = words[0]
    ?.split(/[/\\]/)
    .at(-1)
    ?.replace(/\.(?:exe|cmd|bat|com)$/i, '')
    .toLowerCase()
  // Wrappers are inspected for Git, but never themselves admitted as plain tools.
  if (
    ['env', 'command', 'nice', 'xargs', 'bash', 'sh', 'cmd', 'pwsh', 'powershell'].includes(
      executable ?? '',
    )
  )
    return false
  for (const word of words.slice(1)) {
    if (
      /^(?:--(?:output|ext-diff|textconv|no-index|prefix|cwd|directory|work-tree|git-dir|exec-path)|-o)(?:=|$)/.test(
        word,
      ) ||
      /^-o.+/.test(word) ||
      word.startsWith('-C')
    )
      return false
    const value = word.includes('=') ? word.slice(word.indexOf('=') + 1) : word
    if (
      value !== '..' &&
      !/^(?:[\\/~]|\.\.?[\\/]|[a-z]:[\\/])/i.test(value) &&
      !value.includes('/') &&
      !value.includes('\\')
    )
      continue
    const resolved = await confineWorkerPath(input, value)
    if (!resolved.ok) return false
  }
  if (input.role.workspaceMode !== 'read-only' && input.role.toolGroups.includes('shell'))
    return true
  const hasMatchingCommand = (commands: ReadonlySet<string>): boolean =>
    [...commands].some((command) => {
      const permitted = commandShape(command, input.dialect)
      if (!permitted.isPlain || permitted.commands.length !== 1) return false
      const prefix = permitted.commands[0] ?? []
      return prefix.length > 0 && prefix.every((word, index) => words[index] === word)
    })
  return input.role.toolGroups.includes('readOnlyShell') &&
    hasMatchingCommand(input.readOnlyCommands)
    ? words.every((word) =>
        ['--output', '-o', '--ext-diff', '--textconv', '-c', '--exec-path'].every(
          (option) =>
            !(
              word === option ||
              word.startsWith(`${option}=`) ||
              (option === '-o' && word.startsWith('-o'))
            ),
        ),
      )
    : input.role.workspaceMode !== 'read-only' &&
        input.role.toolGroups.includes('testShell') &&
        hasMatchingCommand(input.testCommands ?? new Set())
}

/**
 * Whether any run of the command line moves a ref: `looseWords` reads
 * wider than the shell, so a nested `$(git push)` is seen too.
 */
export function hasRefMove(command: string, dialect: ShellDialect): boolean {
  const hasRefMoves = (text: string, depth: number): boolean =>
    looseWords(text, dialect).some(
      (words) =>
        isRefMovingGitCommand(words) ||
        (depth > 0 && words.some((word) => /\s/.test(word) && hasRefMoves(word, depth - 1))),
    )
  return hasRefMoves(command, 2)
}

const ACP_WRITE_KINDS: ReadonlySet<string> = new Set(['edit', 'delete', 'move'])
/**
 * Answers a `session/request_permission` by the role's policy. Rejected
 * without asking: paths outside the working copy (links followed), an edit
 * outside `write-paths`, an `execute` for a role without the shell, a git
 * command the ref guard refuses, a `fetch` for a role without the network,
 * and for a `read-only` role any edit and any command off the read-only
 * list. Everything else becomes the user's card.
 */
export async function answerAcpPermission(
  input: AcpPermissionInput,
): Promise<AcpPermissionVerdict> {
  try {
    await assertWorkerRoot(input)
  } catch {
    return { action: 'rejectOnce' }
  }
  const { role, toolCall } = input
  const extracted = extractRequestPaths(toolCall.rawInput)
  if (extracted.isTruncated) {
    return { action: 'rejectOnce' }
  }
  const candidates = [
    ...(toolCall.locations ?? []).map((location) => location.path),
    ...extracted.paths,
  ]
  for (const candidate of candidates) {
    const confined = await confineWorkerPath(input, candidate)
    if (!confined.ok) {
      return { action: 'rejectOnce' }
    }
  }
  const kind = toolCall.kind ?? 'other'
  const isWrite = ACP_WRITE_KINDS.has(kind)
  if (isWrite && (candidates.length === 0 || role.workspaceMode === 'read-only')) {
    return { action: 'rejectOnce' }
  }
  if (isWrite && !(await isWithinWritePaths(input, candidates))) {
    return { action: 'rejectOnce' }
  }
  if (kind === 'execute') {
    return { action: (await isCommandAllowed(input)) ? 'askUser' : 'rejectOnce' }
  }
  if (isWrite) return { action: 'askUser' }
  if (kind === 'fetch')
    return { action: role.toolGroups.includes('webFetch') ? 'askUser' : 'rejectOnce' }
  return {
    action:
      (kind === 'read' || kind === 'search') &&
      role.toolGroups.includes('read') &&
      candidates.length > 0
        ? 'askUser'
        : 'rejectOnce',
  }
}

async function isWithinWritePaths(
  input: Pick<AcpPermissionInput, 'role' | 'folder' | 'workspaceRoot' | 'platform' | 'io'>,
  candidates: readonly string[],
): Promise<boolean> {
  for (const candidate of candidates) {
    if (!(await isWorkerWriteAllowed(input, candidate))) return false
  }
  return candidates.length > 0
}

/** Whether the role may run the command in the request's raw input. */
async function isCommandAllowed(input: AcpPermissionInput): Promise<boolean> {
  const command = commandTextOf(input.toolCall.rawInput)
  return command !== undefined && (await isWorkerCommandAllowed({ ...input, command }))
}

/** The command a raw input carries, when it names one plainly. */
function commandTextOf(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null) {
    return undefined
  }
  return 'command' in rawInput && typeof rawInput.command === 'string'
    ? rawInput.command
    : undefined
}

export async function classifyMuseWorkerApproval(input: {
  readonly role: WorkerRolePolicy
  readonly request: MuseWorkerApprovalRequest
  readonly dialect: ShellDialect
  /** Lane 0's `TEAM_READ_ONLY_COMMANDS`, injected until it lands. */
  readonly readOnlyCommands: ReadonlySet<string>
  readonly folder: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
  readonly workspaceRoot: string
  readonly testCommands?: ReadonlySet<string>
  readonly grant?: WorkerRootGrant
}): Promise<MuseWorkerApprovalAnswer> {
  const { request } = input
  if (request.kind === 'writeFile') {
    return (await isWorkerWriteAllowed(input, request.path)) ? 'askUser' : 'deny'
  }
  if (request.kind === 'shellCommand') {
    return (await isWorkerCommandAllowed({ ...input, command: request.command }))
      ? 'askUser'
      : 'deny'
  }
  return 'deny'
}

/** Step 1 has not shown how a session switches a user server off. */
export class MuseWorkerCapturePendingError extends Error {
  public constructor() {
    super('Switching off a user server waits on the step 1 capture')
    this.name = 'MuseWorkerCapturePendingError'
  }
}

/**
 * Switches a user's exclusive servers off for one session. Step 1 captures
 * whether `config.mcpServers` can override or switch off a user-configured
 * server of the same name; until it does, this throws rather than running
 * the worker beside a second copy of a singleton server.
 */
export function userServerExclusion(names: readonly string[]): void {
  if (names.length > 0) {
    throw new MuseWorkerCapturePendingError()
  }
}

/** Native user-server exclusion is a required launcher admission condition. */
export class AcpNativeServersError extends Error {
  public constructor() {
    super('An ACP worker requires captured native-server isolation')
    this.name = 'AcpNativeServersError'
  }
}

export function requireAcpNativeIsolation(isExcluded: boolean): void {
  if (!isExcluded) throw new AcpNativeServersError()
}

/** Step 1 has not captured the preset's switch for leaving out the user's MCP servers. */
export class AcpUserServersSwitchError extends Error {
  public constructor(readonly preset: AcpPresetId) {
    super(`Starting ${preset} without the user's servers waits on the step 1 capture`)
    this.name = 'AcpUserServersSwitchError'
  }
}

export function acpSpawnArgs(input: {
  readonly preset: AcpPreset
  readonly extraArgs?: readonly string[]
}): readonly string[] {
  const presetSwitch = input.preset.withoutUserServersSwitch
  if (presetSwitch === undefined || presetSwitch.length === 0 || (input.extraArgs?.length ?? 0) > 0)
    throw new AcpUserServersSwitchError(input.preset.id)
  return [...input.preset.defaultArgs, ...presetSwitch]
}
