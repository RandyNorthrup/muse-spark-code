import { constants as fsConstants, type Stats } from 'node:fs'
import { chmod, mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import path from 'node:path'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { canonicalPath } from '../canonicalPath'
import { renameReplacing } from '../fsAtomic'
import { storeErrorCode } from '../backend/storeErrors'
import { runProgram, windowsPowerShell } from '../processTree'
import { powerShellQuoted } from '../../core/shellQuote'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../shared/constants'

/** Personal state home, never workspace contents or credential storage. */
export function windowHintsDirectory(
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string {
  let root: string | undefined
  if (platform === 'win32') root = env['LOCALAPPDATA']
  else if (platform === 'darwin') root = path.join(home, 'Library', 'Application Support')
  else root = env['XDG_STATE_HOME'] ?? path.join(home, '.local', 'state')
  if (root === undefined || !path.isAbsolute(root))
    throw new Error('TEAM_HINT_STATE_HOME_UNAVAILABLE')
  return path.join(root, 'muse-spark-code', 'hints')
}

async function secureNativeWindowsDirectory(directory: string): Promise<void> {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) throw new Error('TEAM_HINT_ACL_UNAVAILABLE')
  const powershell = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
  const script = `$ErrorActionPreference='Stop'; $directory = New-Object IO.DirectoryInfo(${powerShellQuoted(directory)}); $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User; $acl = New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); $directory.SetAccessControl($acl); $read = $directory.GetAccessControl(); $rules = @($read.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); if (!$read.AreAccessRulesProtected -or $read.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'TEAM_HINT_ACL_UNVERIFIED' }; 'secured'`
  const result = await runProgram(
    powershell.file,
    [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
    powershell.env,
  )
  if (result.trim() !== 'secured') throw new Error('TEAM_HINT_ACL_UNVERIFIED')
}

async function assertNativeWindowsHintFile(target: string): Promise<void> {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) throw new Error('TEAM_HINT_ACL_UNAVAILABLE')
  const powershell = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
  const script = `$ErrorActionPreference='Stop'; $file = New-Object IO.FileInfo(${powerShellQuoted(target)}); $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User; $acl = $file.GetAccessControl(); $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'TEAM_HINT_FILE_UNSAFE' }; 'verified'`
  const result = await runProgram(
    powershell.file,
    [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
    powershell.env,
  )
  if (result.trim() !== 'verified') throw new Error('TEAM_HINT_FILE_UNSAFE')
}

const OWNER_DIRECTORY_MODE = 0o700
const OWNER_FILE_MODE = 0o600
const DIRECTORY_PERMISSION_MASK = 0o777
const UNSAFE_FILE_WRITE_MASK = 0o022
function assertSafeHintFile(
  information: Stats,
  platform: NodeJS.Platform,
  shouldBePrivate: boolean,
) {
  if (!information.isFile() || information.nlink !== 1) throw new Error('TEAM_HINT_FILE_UNSAFE')
  if (platform === 'win32') return
  const hasUnsafeMode = shouldBePrivate
    ? (information.mode & DIRECTORY_PERMISSION_MASK) !== OWNER_FILE_MODE
    : (information.mode & UNSAFE_FILE_WRITE_MASK) !== 0
  if (hasUnsafeMode || information.uid !== process.getuid?.())
    throw new Error('TEAM_HINT_FILE_UNSAFE')
}
const countSchema = z.number().check(z.int(), z.nonnegative())
const hintSchema = z.strictObject({
  instanceId: z.uuid(),
  workspaceName: z.string(),
  at: countSchema,
  trees: z.array(
    z.strictObject({
      commonDirectory: z.string(),
      branch: z.string(),
      worktree: z.string(),
      paths: z.array(z.string()),
    }),
  ),
  exclusiveServers: z.array(z.string()),
  workers: countSchema,
  processWorkers: countSchema,
  heavyCommands: countSchema,
})

export type WindowHint = z.infer<typeof hintSchema>
export type HintCollision =
  | {
      readonly kind: 'paths'
      readonly instanceId: string
      readonly repository: string
      readonly branch: string
      readonly paths: readonly string[]
    }
  | { readonly kind: 'server'; readonly instanceId: string; readonly server: string }

export interface HintIntent {
  readonly repository: string
  readonly paths: readonly string[]
  readonly exclusiveServers: readonly string[]
}

async function assertHintPath(target: string) {
  if ((await canonicalPath(target)) !== target) throw new Error('TEAM_HINT_PATH_CHANGED')
}

/** Advisory only. The caller still performs trust, caps, leases and paid admission. */
export function createWindowHints(options: {
  readonly directory: string
  readonly instanceId: string
  readonly platform: NodeJS.Platform
  readonly freshMs: number
  readonly writeMs: number
  readonly maxHintBytes: number
  readonly now: () => number
  /** Windows mode bits do not set ACLs: the native host must secure and verify this folder. */
  readonly secureWindowsDirectory?: (directory: string) => Promise<void>
  readonly disabled: () => void
  readonly question: (collision: HintCollision) => Promise<'continue' | 'wait' | 'openWindow'>
  /** Lane I expands globs and excludes json-table/changelog files before calling. */
  readonly overlap: (mine: readonly string[], theirs: readonly string[]) => readonly string[]
}) {
  const instanceId = z.uuid().parse(options.instanceId)
  const directory = path.resolve(options.directory)
  const file = path.join(directory, `${instanceId}.json`)
  const lifecycle = { isDisabled: false, isClosed: false, isStarting: false }
  // Read again after awaits: dispose/disable may run while filesystem work is pending.
  const isUnavailable = () => lifecycle.isDisabled || lifecycle.isClosed
  let timer: ReturnType<typeof setInterval> | undefined
  let pending = Promise.resolve()
  const answers = new Map<
    string,
    {
      readonly collision: HintCollision
      readonly answer: Promise<'continue' | 'wait' | 'openWindow'>
    }
  >()
  const disable = () => {
    if (lifecycle.isDisabled) return
    lifecycle.isDisabled = true
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    options.disabled()
  }
  const prepare = async () => {
    await assertHintPath(directory)
    await mkdir(directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
    await assertHintPath(directory)
    if (options.platform === 'win32') {
      await (options.secureWindowsDirectory ?? secureNativeWindowsDirectory)(directory)
    } else {
      await chmod(directory, OWNER_DIRECTORY_MODE)
      const information = await stat(directory)
      const getuid = process.getuid
      if (
        !information.isDirectory() ||
        information.uid !== getuid?.() ||
        (information.mode & DIRECTORY_PERMISSION_MASK) !== OWNER_DIRECTORY_MODE
      )
        throw new Error('TEAM_HINT_MODE_UNVERIFIED')
    }
  }
  const readFresh = async (): Promise<readonly WindowHint[]> => {
    if (lifecycle.isDisabled || lifecycle.isClosed) return []
    try {
      await prepare()
      const names = await readdir(directory)
      const hints: WindowHint[] = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const target = path.join(directory, name)
        try {
          if (options.platform === 'win32') await assertHintPath(target)
          const handle = await open(
            target,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
          )
          let text: string
          try {
            const information = await handle.stat()
            assertSafeHintFile(information, options.platform, false)
            if (information.size > options.maxHintBytes) continue
            if (options.platform === 'win32') {
              try {
                await assertNativeWindowsHintFile(target)
              } catch (error: unknown) {
                throw new Error('TEAM_HINT_FILE_UNSAFE', { cause: error })
              }
            }
            text = await handle.readFile('utf8')
          } finally {
            await handle.close()
          }
          if (Buffer.byteLength(text) > options.maxHintBytes) continue
          const parsed = hintSchema.safeParse(JSON.parse(text))
          if (!parsed.success || name !== `${parsed.data.instanceId}.json`) continue
          const age = options.now() - parsed.data.at
          if (age >= 0 && age < options.freshMs) hints.push(parsed.data)
        } catch (error: unknown) {
          // A torn, malformed, linked or concurrently removed hint carries no authority.
          if (
            storeErrorCode(error) === 'EACCES' ||
            storeErrorCode(error) === 'ELOOP' ||
            (error instanceof Error &&
              (error.message === 'TEAM_HINT_FILE_UNSAFE' ||
                error.message === 'TEAM_HINT_PATH_CHANGED'))
          )
            throw error
        }
      }
      return hints
    } catch {
      disable()
      return []
    }
  }
  const publish = (state: Omit<WindowHint, 'instanceId' | 'at'>): Promise<void> => {
    const previous = pending
    pending = (async () => {
      await previous
      if (lifecycle.isDisabled || lifecycle.isClosed) return
      try {
        await prepare()
        const hint = hintSchema.parse({ ...state, instanceId, at: options.now() })
        const text = JSON.stringify(hint)
        if (Buffer.byteLength(text) > options.maxHintBytes) throw new Error('TEAM_HINT_TOO_LARGE')
        if (isUnavailable()) return
        // Do not inherit an unsafe destination's mode, links, owner or ACL.
        // A fresh exclusive inode is checked before it receives any metadata.
        const temporary = path.join(directory, `.${instanceId}.${randomUUID()}.tmp`)
        try {
          const handle = await open(temporary, 'wx', OWNER_FILE_MODE)
          try {
            const information = await handle.stat()
            assertSafeHintFile(information, options.platform, true)
            await handle.writeFile(text, 'utf8')
          } finally {
            await handle.close()
          }
          await renameReplacing(
            temporary,
            file,
            {
              sleep: delay,
              beforeCommit: () => {
                if (isUnavailable()) throw new Error('TEAM_HINT_CLOSED')
              },
            },
            async () => {
              await assertHintPath(directory)
            },
          )
        } finally {
          await assertHintPath(directory)
          await rm(temporary, { force: true })
        }
      } catch {
        disable()
      }
    })()
    return pending
  }
  const collisionsFor = (intent: HintIntent, hints: readonly WindowHint[]) => {
    const collisions: HintCollision[] = []
    for (const hint of hints) {
      if (hint.instanceId === instanceId) continue
      for (const tree of hint.trees) {
        if (tree.commonDirectory !== intent.repository) continue
        const paths = [...new Set(options.overlap(intent.paths, tree.paths))].toSorted(
          (left, right) => left.localeCompare(right),
        )
        if (paths.length > 0)
          collisions.push({
            kind: 'paths',
            instanceId: hint.instanceId,
            repository: intent.repository,
            branch: tree.branch,
            paths,
          })
      }
      for (const server of intent.exclusiveServers) {
        if (hint.exclusiveServers.includes(server)) {
          collisions.push({ kind: 'server', instanceId: hint.instanceId, server })
        }
      }
    }
    return collisions
  }
  const collisionKey = (collision: HintCollision) =>
    JSON.stringify(
      collision.kind === 'server'
        ? [collision.kind, collision.instanceId, collision.server]
        : [collision.kind, collision.instanceId, collision.repository, collision.paths],
    )
  const isPresent = (collision: HintCollision, hints: readonly WindowHint[]) =>
    hints.some(
      (hint) =>
        hint.instanceId === collision.instanceId &&
        (collision.kind === 'server'
          ? hint.exclusiveServers.includes(collision.server)
          : hint.trees.some(
              (tree) =>
                tree.commonDirectory === collision.repository &&
                collision.paths.every((leased) => options.overlap([leased], tree.paths).length > 0),
            )),
    )
  return {
    readFresh,
    publish,
    async check(intent: HintIntent): Promise<'continue' | 'wait' | 'openWindow'> {
      const hints = await readFresh()
      const collisions = collisionsFor(intent, hints)
      // Answers survive rewrites, but lapse when the other window drops their paths/server.
      for (const [key, saved] of answers) {
        if (!isPresent(saved.collision, hints)) answers.delete(key)
      }
      let result: 'continue' | 'wait' | 'openWindow' = 'continue'
      for (const collision of collisions) {
        const key = collisionKey(collision)
        let saved = answers.get(key)
        if (saved === undefined) {
          saved = { collision, answer: options.question(collision) }
          answers.set(key, saved)
        }
        const choice = await saved.answer
        if (choice !== 'continue') result = choice
      }
      return result
    },
    async advisory() {
      const hints = await readFresh()
      const sum = { windows: 0, workers: 0, processWorkers: 0, heavyCommands: 0 }
      for (const hint of hints) {
        sum.windows += 1
        sum.workers += hint.workers
        sum.processWorkers += hint.processWorkers
        sum.heavyCommands += hint.heavyCommands
      }
      return sum
    },
    async start(state: () => Omit<WindowHint, 'instanceId' | 'at'>) {
      if (timer !== undefined || lifecycle.isStarting || lifecycle.isDisabled || lifecycle.isClosed)
        return
      lifecycle.isStarting = true
      try {
        await publish(state())
        if (isUnavailable()) return
        timer = setInterval(() => {
          try {
            void publish(state())
          } catch {
            disable()
          }
        }, options.writeMs)
        timer.unref()
      } finally {
        lifecycle.isStarting = false
      }
    },
    async dispose() {
      lifecycle.isClosed = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      answers.clear()
      await pending
      try {
        await assertHintPath(file)
        await rm(file, { force: true })
      } catch {
        disable()
      }
    },
  }
}
