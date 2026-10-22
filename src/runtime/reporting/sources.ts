import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  EXEC_UNTRUSTED_FILE_MAX_BYTES,
  GIT_OUTPUT_MAX_BYTES,
  REPORT_MAX_ROWS,
  REPORT_STORAGE_LINK_COUNT,
} from '../../shared/constants'
import {
  LocalSourceError,
  reportWorkspaceKey,
  type LocalFileIo,
} from '../../core/reporting/sources/local'
import {
  XcodeStubGitError,
  isXcodeStubGitFailure,
  type ReportGitIo,
} from '../../core/reporting/sources/git'
import {
  isAgentUsagePath,
  type AgentUsageAgent,
  type AgentUsageFile,
  type AgentUsageFiles,
} from '../../core/reporting/sources/agentUsage'
import { resolveAllExecutables, workspaceChildEnvironment } from '../../core/execGuard'
import { execResourceFile } from '../../core/resources/launcher'
import { constants as fsConstants, existsSync, realpathSync } from 'node:fs'
import { open, opendir, realpath } from 'node:fs/promises'
import { isPrivateFileName } from '../../shared/privateFiles'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { handleIdentity, lstatIdentity, sameFile, statIdentity } from '../../core/fs/fileIdentity'
import { pathModule } from '../../core/workspaceRoot'
import { isBelow, resolveWorkspacePath } from '../../core/workspacePath'
import { createLocalReportSources, type LocalReportSourceDeps } from '../../core/reporting/sources'

function isPrivatePath(file: string): boolean {
  return file
    .replaceAll('\\', '/')
    .split('/')
    .some(
      (name) =>
        isPrivateFileName(name) ||
        /^(?:\.?credentials?|auth|secrets?|tokens?)(?:\.|$)/iu.test(name),
    )
}
/**
One confined, regular-file descriptor. NOLIMITS1FIX: the removed 16 MiB
bound was invented — the default reads at any size. The chunks decode
straight into the returned string through one streaming decoder, so a
large source is never held as retained chunks plus a second concatenated
buffer plus the string on top. An explicit finite `maxBytes` (the
untrusted-file bound one caller passes) still refuses past itself.
*/
export function reportFileIo(
  root: string,
  platform: NodeJS.Platform,
  maxBytes = Infinity,
): LocalFileIo {
  const p = pathModule(platform)
  async function target(
    file: string,
    signal: AbortSignal,
  ): Promise<{ absolute: string; root: string }> {
    signal.throwIfAborted()
    if (isPrivatePath(file)) throw new LocalSourceError('refused')
    const resolved = resolveWorkspacePath(root, file.replaceAll('\\', '/'), platform)
    if (!resolved.ok) throw new LocalSourceError('refused')
    try {
      const canonicalRoot = await realpath(root)
      const absolute = await realpath(resolved.absolute)
      if (!isBelow(p.relative(canonicalRoot, absolute), p) || isPrivatePath(absolute))
        throw new LocalSourceError('refused')
      signal.throwIfAborted()
      return { absolute, root: canonicalRoot }
    } catch (error) {
      if (error instanceof LocalSourceError) throw error
      throw new LocalSourceError(
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
          ? 'missing'
          : 'failed',
      )
    }
  }
  return {
    async read(file, signal) {
      const checked = await target(file, signal)
      const before = await lstatIdentity(checked.absolute)
      const rootBefore = await statIdentity(checked.root)
      if (!before.isFile() || Number(before.nlink) !== REPORT_STORAGE_LINK_COUNT)
        throw new LocalSourceError('refused')
      if (Number.isFinite(maxBytes) && before.size > BigInt(maxBytes))
        throw new LocalSourceError('limit')
      const handle = await open(checked.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
      try {
        const held = await handleIdentity(handle)
        const rechecked = await target(file, signal)
        if (
          !held.isFile() ||
          !sameFile(before, held) ||
          !sameFile(rootBefore, await statIdentity(rechecked.root)) ||
          rechecked.absolute !== checked.absolute
        )
          throw new LocalSourceError('refused')
        const decoder = new TextDecoder('utf-8', { fatal: true })
        const pieces: string[] = []
        let count = 0
        let position = 0
        for (;;) {
          signal.throwIfAborted()
          const chunk = Buffer.alloc(BOUNDED_FILE_READ_CHUNK_BYTES)
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
          if (bytesRead === 0) break
          position += bytesRead
          count += bytesRead
          if (count > maxBytes) throw new LocalSourceError('limit')
          try {
            pieces.push(decoder.decode(chunk.subarray(0, bytesRead), { stream: true }))
          } catch {
            throw new LocalSourceError('invalid')
          }
        }
        if (!sameFile(held, await lstatIdentity(checked.absolute)))
          throw new LocalSourceError('refused')
        try {
          // The flush completes a character split across the last chunk, or
          // throws on truncated bytes, exactly as one whole decode does.
          const text = `${pieces.join('')}${decoder.decode()}`
          if (text.includes('\0')) throw new LocalSourceError('invalid')
          return text
        } catch {
          throw new LocalSourceError('invalid')
        }
      } finally {
        await handle.close()
      }
    },
    async list(directory, signal) {
      const checked = await target(directory, signal)
      const folder = await opendir(checked.absolute)
      const entries: { name: string; directory: boolean }[] = []
      for await (const entry of folder) {
        signal.throwIfAborted()
        if (entries.length >= REPORT_MAX_ROWS) throw new LocalSourceError('limit')
        entries.push({ name: entry.name, directory: entry.isDirectory() })
      }
      return entries
    },
  }
}
interface RuntimeSourcesInput extends Omit<
  LocalReportSourceDeps,
  'files' | 'git' | 'roots' | 'agentFiles'
> {
  readonly workspaceRoot: string
  readonly homeDir: string
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly agentFiles?: AgentUsageFiles
  readonly agentRoots?: Partial<Record<AgentUsageAgent, string>>
}
/** A project's accepted child-session folder, using the usage-path normalization. */
function isSubagentsFolder(directory: string, name: string): boolean {
  return (
    /^projects\/[^/]+$/u.test(directory.replaceAll('\\', '/').toLowerCase()) &&
    name.replaceAll('\\', '/').toLowerCase() === 'subagents'
  )
}
async function discoverAgentFiles(
  input: Pick<RuntimeSourcesInput, 'homeDir' | 'platform' | 'enabledAgents' | 'agentRoots'>,
  signal: AbortSignal,
): Promise<readonly AgentUsageFile[]> {
  const files: AgentUsageFile[] = []
  const p = pathModule(input.platform)
  let visited = 0
  for (const agent of input.enabledAgents) {
    const root =
      input.agentRoots?.[agent] ?? p.join(input.homeDir, agent === 'codex' ? '.codex' : '.claude')
    const io = reportFileIo(root, input.platform)
    async function walk(directory: string): Promise<void> {
      const entries = await io.list(directory, signal)
      for (const entry of entries) {
        signal.throwIfAborted()
        if (visited >= REPORT_MAX_ROWS) throw new LocalSourceError('limit')
        visited += 1
        const file = `${directory}/${entry.name}`
        if (!entry.directory && isAgentUsagePath(agent, file)) files.push({ agent, file, io })
        else if (
          entry.directory &&
          (agent === 'claudeCode'
            ? directory === 'projects' || isSubagentsFolder(directory, entry.name)
            : /^sessions(?:\/\d{4}(?:\/\d{2})?)?$/u.test(directory))
        )
          await walk(file)
      }
    }
    try {
      await walk(agent === 'codex' ? 'sessions' : 'projects')
    } catch (error) {
      if (!(error instanceof LocalSourceError) || error.code !== 'missing') throw error
    }
  }
  return files
}
/** An exec failure with an exit code (as opposed to an abort or a spawn breakdown). */
function isExecExit(error: unknown): error is Error & { code: number } {
  return error instanceof Error && 'code' in error && typeof error.code === 'number'
}
export function reportGitIo(
  root: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): ReportGitIo {
  const p = pathModule(platform)
  // Every absolute PATH entry's git, in order: the first file need not run
  // (macOS's Xcode stub exists while its tools are missing), so the first
  // candidate whose `--version` answers is the git that runs. The guard is
  // unchanged: absolute PATH entries only, never the working directory.
  const candidates = resolveAllExecutables('git', {
    platform,
    pathVariable: env['PATH'] ?? env['Path'],
    fileExists: existsSync,
    scope: { workspaceRoot: root, realpath: realpathSync },
  })
  const childEnvironment = workspaceChildEnvironment(
    platform,
    Object.fromEntries(
      Object.entries(withoutCredentials(env, [], platform)).filter(
        ([name]) => !/^(?:GIT_|GCM_)/iu.test(name),
      ),
    ),
    { workspaceRoot: root, realpath: realpathSync },
  )
  const commandEnvironment = {
    ...childEnvironment,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  }
  // Settled once per sources object: one probe round serves the whole
  // generation, and a stub-only PATH stays a stub verdict.
  let winner: string | undefined
  let hasProbed = false
  let hasSeenStub = false
  async function workingGit(signal: AbortSignal): Promise<string> {
    if (winner !== undefined) return winner
    if (hasProbed) {
      if (hasSeenStub) throw new XcodeStubGitError()
      const first = candidates.at(0)
      if (first === undefined) throw new LocalSourceError('missing')
      return first
    }
    hasProbed = true
    for (const candidate of candidates) {
      signal.throwIfAborted()
      try {
        await execResourceFile('probe', candidate, ['--version'], {
          cwd: root,
          env: commandEnvironment,
          encoding: 'utf8',
          windowsHide: true,
          // No deadline of ours (D121/D208): git's own exit or the caller's
          // signal ends the probe.
          timeout: Infinity,
          maxBuffer: GIT_OUTPUT_MAX_BYTES,
          signal,
        })
        winner = candidate
        return candidate
      } catch (error: unknown) {
        // A failed probe is not the git: an exec failure records a stub
        // sighting and tries the next candidate; anything else (an abort,
        // a spawn breakdown) stops the round with its cause.
        if (!isExecExit(error)) throw error
        const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : ''
        if (isXcodeStubGitFailure(platform, error.code, stderr)) hasSeenStub = true
      }
    }
    if (hasSeenStub) throw new XcodeStubGitError()
    const first = candidates.at(0)
    if (first === undefined) throw new LocalSourceError('missing')
    return first
  }
  // Only these read commands are admitted by the source port; no shell, check or hook.
  return {
    async run(args, signal) {
      if (!existsSync(p.join(root, '.git'))) throw new LocalSourceError('missing')
      const program = await workingGit(signal)
      signal.throwIfAborted()
      try {
        const { stdout } = await execResourceFile('probe', program, ['--no-pager', ...args], {
          cwd: root,
          env: commandEnvironment,
          encoding: 'utf8',
          windowsHide: true,
          // No deadline of ours (D121/D208): git's own exit or the caller's
          // signal ends the read.
          timeout: Infinity,
          maxBuffer: GIT_OUTPUT_MAX_BYTES,
          signal,
        })
        return { stdout, code: 0 }
      } catch (error: unknown) {
        // A failed read keeps what the command printed: the exit code and
        // the partial stdout travel with the failure. Anything that is not
        // an exec failure stops the read with its cause.
        if (!isExecExit(error)) throw error
        if (!('stdout' in error) || typeof error.stdout !== 'string')
          throw new LocalSourceError('failed')
        return { stdout: error.stdout, code: error.code }
      }
    },
  }
}
/** Called only by the lazy report dispatcher; never reads process.env or a credential store. */
export function createRuntimeReportSources(input: RuntimeSourcesInput) {
  const { workspaceRoot, homeDir, platform, env, agentRoots, agentFiles, ...deps } = input
  const discovery = {
    homeDir,
    platform,
    enabledAgents: deps.enabledAgents,
    ...(agentRoots !== undefined && { agentRoots }),
  }
  return {
    workspaceKey: reportWorkspaceKey(workspaceRoot, platform),
    sources: createLocalReportSources({
      ...deps,
      agentFiles: agentFiles ?? ((signal) => discoverAgentFiles(discovery, signal)),
      roots: [workspaceRoot, homeDir],
      files: reportFileIo(workspaceRoot, platform, EXEC_UNTRUSTED_FILE_MAX_BYTES),
      git: reportGitIo(workspaceRoot, platform, env),
    }),
  }
}
