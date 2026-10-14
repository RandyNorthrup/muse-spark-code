import type { RefFenceVerdict } from '../refFence'
import type { AcpPreset, AcpPresetId } from './acpWorker'
// One admission authority for every team worker (PLAN.md M96 W-F1-W-F3).
// Names locate objects; only native identities establish containment.
import { open, realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { handleIdentity } from '../../fs/fileIdentity'
import { scrubWorkerEnv } from './workerEnv'
import { fileIdentityKey, statIdentity } from '../../fs/fileIdentity'
import { pathModule } from '../../workspaceRoot'
import type { RealPathIo } from '../../workspacePath'
import { looseWords, type ShellDialect } from '../../backends/modelapi/shellSyntax'
import { WORKER_FILE_PATH_TIMEOUT_MS } from '../../../shared/constants'
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

async function openWorkerFile(absolute: string, isWrite: boolean): Promise<WorkerFileHandle> {
  const handle = await open(absolute, isWrite ? 'r+' : 'r')
  return {
    identify: async () => {
      const identity = fileIdentityKey(await handleIdentity(handle))
      if (identity === undefined) throw new MuseWorkerFolderError()
      let final: string
      // Windows: libuv's native realpath resolves through GetFinalPathNameByHandle
      // (long names, no 8.3 aliases) without starting a process; the identity
      // check below proves the resolved name still denotes this open handle.
      if (process.platform === 'win32') final = await realpath(absolute)
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
