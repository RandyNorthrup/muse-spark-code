import { execResourceFile } from '../../core/resources/admission'
import { constants as fsConstants, existsSync } from 'node:fs'
import { open, opendir, realpath } from 'node:fs/promises'
import {
  EXEC_UNTRUSTED_FILE_MAX_BYTES,
  GIT_OUTPUT_MAX_BYTES,
  REPORT_MAX_ROWS,
  REPORT_STORAGE_LINK_COUNT,
  REPORT_SOURCE_TIMEOUT_MS,
  SESSION_EXPORT_MAX_BYTES,
} from '../../shared/constants'
import { isPrivateFileName } from '../../shared/privateFiles'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { resolveExecutable } from '../../core/executables'
import { handleIdentity, lstatIdentity, sameFile, statIdentity } from '../../core/fs/fileIdentity'
import { pathModule } from '../../core/workspaceRoot'
import { isBelow, resolveWorkspacePath } from '../../core/workspacePath'
import { createLocalReportSources, type LocalReportSourceDeps } from '../../core/reporting/sources'
import {
  LocalSourceError,
  reportWorkspaceKey,
  type LocalFileIo,
} from '../../core/reporting/sources/local'
import type { ReportGitIo } from '../../core/reporting/sources/git'
import {
  isAgentUsagePath,
  type AgentUsageAgent,
  type AgentUsageFile,
  type AgentUsageFiles,
} from '../../core/reporting/sources/agentUsage'

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
/** One confined, regular-file descriptor, size bound before and during the read. */
export function reportFileIo(
  root: string,
  platform: NodeJS.Platform,
  maxBytes = SESSION_EXPORT_MAX_BYTES,
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
      if (before.size > BigInt(maxBytes)) throw new LocalSourceError('limit')
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
        const buffer = Buffer.alloc(maxBytes + 1)
        let count = 0
        while (count <= maxBytes) {
          signal.throwIfAborted()
          const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null)
          if (bytesRead === 0) break
          count += bytesRead
        }
        if (count > maxBytes) throw new LocalSourceError('limit')
        if (!sameFile(held, await lstatIdentity(checked.absolute)))
          throw new LocalSourceError('refused')
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))
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
        if (isAgentUsagePath(agent, file)) files.push({ agent, file, io })
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
export function reportGitIo(
  root: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): ReportGitIo {
  const p = pathModule(platform)
  const program = resolveExecutable('git', {
    platform,
    pathVariable: env['PATH'] ?? env['Path'],
    fileExists: existsSync,
  })
  const childEnvironment = Object.fromEntries(
    Object.entries(withoutCredentials(env, [], platform)).filter(
      ([name]) => !/^(?:GIT_|GCM_)/iu.test(name),
    ),
  )
  // Only these read commands are admitted by the source port; no shell, check or hook.
  return {
    async run(args, signal) {
      if (program === undefined || !existsSync(p.join(root, '.git')))
        throw new LocalSourceError('missing')
      signal.throwIfAborted()
      try {
        const { stdout } = await execResourceFile(program, ['--no-pager', ...args], {
          cwd: root,
          env: {
            ...childEnvironment,
            GIT_OPTIONAL_LOCKS: '0',
            GIT_TERMINAL_PROMPT: '0',
          },
          encoding: 'utf8',
          windowsHide: true,
          timeout: REPORT_SOURCE_TIMEOUT_MS,
          maxBuffer: GIT_OUTPUT_MAX_BYTES,
          signal,
        })
        return { stdout, code: 0 }
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'number' &&
          'stdout' in error &&
          typeof error.stdout === 'string'
        )
          return { stdout: error.stdout, code: error.code }
        throw new LocalSourceError('failed')
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
