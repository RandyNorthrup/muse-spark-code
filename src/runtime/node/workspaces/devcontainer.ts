// devcontainer.json through the pinned reference CLI (M110b W2, D90.6
// §6 B6): the CLI parses (read-configuration, so no parser of ours can
// drift from what runs), this layer gates (trust, no compose, no
// host-side commands, no repo run-args, no host-escaping mounts), then
// merges the repo's definition with the node's own additions (proxy,
// network) into an override config the CLI runs instead of the repo
// file. Lifecycle commands run only inside the sandbox, only after the
// person trusts the workspace, under its egress policy. Pure builders
// below; the live drill carries version/read/up/exec against the real
// CLI, and digest recording follows on the drill's inspect evidence.
import { execFile } from 'node:child_process'
import path from 'node:path'
import * as z from 'zod/mini'
import { DEVCONTAINER_CLI_PIN } from '../../../shared/constants'
import { execCallback } from './spawn'

const lifecycleCommandSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
])

export const devcontainerResolvedSchema = z.looseObject({
  configuration: z.looseObject({
    name: z.optional(z.string()),
    image: z.optional(z.string()),
    dockerFile: z.optional(z.string()),
    dockerComposeFile: z.optional(z.union([z.string(), z.array(z.string())])),
    features: z.optional(z.record(z.string(), z.unknown())),
    initializeCommand: z.optional(lifecycleCommandSchema),
    onCreateCommand: z.optional(lifecycleCommandSchema),
    updateContentCommand: z.optional(lifecycleCommandSchema),
    postCreateCommand: z.optional(lifecycleCommandSchema),
    postStartCommand: z.optional(lifecycleCommandSchema),
    postAttachCommand: z.optional(lifecycleCommandSchema),
    mounts: z.optional(z.array(z.string())),
    runArgs: z.optional(z.array(z.string())),
    build: z.optional(z.record(z.string(), z.unknown())),
    context: z.optional(z.string()),
    containerEnv: z.optional(z.record(z.string(), z.string())),
    remoteUser: z.optional(z.string()),
    configFilePath: z.looseObject({ fsPath: z.string() }),
  }),
  // A compose definition resolves with no workspaceMount (recorded
  // read-config-evil-compose.json), so the mount stays optional: the
  // gate must see compose to refuse it, not a parse failure.
  workspace: z.looseObject({
    workspaceFolder: z.string(),
    workspaceMount: z.optional(z.string()),
  }),
})

export type DevcontainerResolved = z.infer<typeof devcontainerResolvedSchema>

export const devcontainerUpResultSchema = z.union([
  z.looseObject({
    outcome: z.literal('success'),
    containerId: z.string(),
    remoteUser: z.string(),
    remoteWorkspaceFolder: z.string(),
  }),
  z.looseObject({ outcome: z.literal('error'), message: z.string() }),
])

export type DevcontainerUpResult = z.infer<typeof devcontainerUpResultSchema>

/** Why a devcontainer definition is refused: the audit reads the code. */
export type DevcontainerRefusal =
  | 'untrusted'
  | 'no-source'
  | 'both-sources'
  | 'compose-refused'
  | 'host-command'
  | 'run-args'
  | 'host-mount'
  | 'host-context'
  | 'version-skew'
  | 'cli-failed'
  | 'bad-output'

export class DevcontainerRefusedError extends Error {
  public constructor(public readonly reason: DevcontainerRefusal) {
    super(`devcontainer refused: ${reason}`)
  }
}

export class DevcontainerError extends Error {
  public constructor(
    public readonly reason: DevcontainerRefusal,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
  }
}

/** One parsed `--mount` string: type, source, target. */
export interface DevcontainerMount {
  readonly type: string
  readonly source?: string
  readonly target?: string
}

/** Split `type=bind,source=x,target=y` on unescaped commas, keys on first `=`. */
export function parseMountString(mount: string): DevcontainerMount {
  const parts: string[] = []
  let current = ''
  for (let index = 0; index < mount.length; index += 1) {
    const char = mount.charAt(index)
    if (char === '\\' && index + 1 < mount.length) {
      current += mount.charAt(index + 1)
      index += 1
      continue
    }
    if (char === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  const fields: Record<string, string> = {}
  for (const part of parts) {
    const equals = part.indexOf('=')
    if (equals !== -1) fields[part.slice(0, equals)] = part.slice(equals + 1)
  }
  return {
    type: fields['type'] ?? 'volume',
    ...(fields['source'] !== undefined && { source: fields['source'] }),
    ...(fields['target'] !== undefined && { target: fields['target'] }),
  }
}

/**
Whether the path stays inside the root once resolved (no escape);
case folds on case-insensitive platforms so casing never escapes it.
*/
export function isPathInside(root: string, candidate: string, platform: NodeJS.Platform): boolean {
  const isFold = platform === 'win32' || platform === 'darwin'
  const from = isFold ? root.toLowerCase() : root
  const to = isFold ? candidate.toLowerCase() : candidate
  const relative = path.relative(from, to)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** Splice the resolved source into the mount string, every other field byte-kept. */
export function absolutizeMountSource(mount: string, resolved: string): string {
  const key = 'source='
  const at = mount.indexOf(key)
  if (at === -1) return mount
  let end = at + key.length
  while (end < mount.length) {
    if (mount[end] === '\\' && end + 1 < mount.length) {
      end += 2
      continue
    }
    if (mount[end] === ',') break
    end += 1
  }
  return `${mount.slice(0, at + key.length)}${resolved}${mount.slice(end)}`
}

/**
Whether the mount may ride: volumes and tmpfs carry no host paths
(a volume source that looks like a path is refused — docker would
fail it anyway); binds must resolve inside the workspace (relative
ones against the config dir); anything else is refused.
*/
export function gateMount(
  mount: string,
  workspaceDir: string,
  configDir: string,
  platform: NodeJS.Platform,
): { readonly ok: true; readonly absolutized?: string } | { readonly ok: false } {
  const parsed = parseMountString(mount)
  if (parsed.type === 'volume' || parsed.type === 'tmpfs') {
    const source = parsed.source
    const isPathSource =
      source !== undefined &&
      (path.isAbsolute(source) || source.includes('/') || source.includes('\\'))
    return { ok: !isPathSource }
  }
  if (parsed.type !== 'bind') return { ok: false }
  if (parsed.source === undefined) return { ok: false }
  if (!parsed.target) return { ok: false }
  const resolved = path.isAbsolute(parsed.source)
    ? path.normalize(parsed.source)
    : path.resolve(configDir, parsed.source)
  if (resolved !== workspaceDir && !isPathInside(workspaceDir, resolved, platform)) {
    return { ok: false }
  }
  return resolved === parsed.source
    ? { ok: true }
    : { ok: true, absolutized: absolutizeMountSource(mount, resolved) }
}

/**
Whether the resolved definition may run: trusted, exactly one of image
or dockerfile, no compose, no host-side initialize command, no repo
run-args, no escaping mounts, and the dockerfile and context
(top-level or under build) resolving inside the workspace.
Customizations and the rest ride dropped in the merge (a headless
node has no editor).
*/
export function gateDevcontainerConfig(
  resolved: DevcontainerResolved,
  workspaceDir: string,
  isTrusted: boolean,
  platform: NodeJS.Platform,
): { readonly ok: true } | { readonly ok: false; readonly reason: DevcontainerRefusal } {
  if (!isTrusted) return { ok: false, reason: 'untrusted' }
  const config = resolved.configuration
  if (config.dockerComposeFile !== undefined) return { ok: false, reason: 'compose-refused' }
  if (config.image === undefined && config.dockerFile === undefined) {
    return { ok: false, reason: 'no-source' }
  }
  if (config.image !== undefined && config.dockerFile !== undefined) {
    return { ok: false, reason: 'both-sources' }
  }
  if (config.initializeCommand !== undefined) return { ok: false, reason: 'host-command' }
  if (config.runArgs !== undefined) return { ok: false, reason: 'run-args' }
  const configDir = path.dirname(config.configFilePath.fsPath)
  const mounts = config.mounts ?? []
  for (const mount of mounts) {
    if (!gateMount(mount, workspaceDir, configDir, platform).ok) {
      return { ok: false, reason: 'host-mount' }
    }
  }
  // The build reads only workspace files: the dockerfile and the
  // context (top-level or under build) resolve inside it, so a
  // trusted repo can never point the daemon at host files.
  const buildDockerfile: unknown = config.build?.['dockerfile']
  const dockerfiles = [
    config.dockerFile,
    ...(typeof buildDockerfile === 'string' ? [buildDockerfile] : []),
  ]
  for (const dockerfile of dockerfiles) {
    if (dockerfile === undefined) continue
    const resolved = path.isAbsolute(dockerfile)
      ? path.normalize(dockerfile)
      : path.resolve(configDir, dockerfile)
    if (resolved !== workspaceDir && !isPathInside(workspaceDir, resolved, platform)) {
      return { ok: false, reason: 'host-context' }
    }
  }
  const buildContext: unknown = config.build?.['context']
  const contexts = [config.context, ...(typeof buildContext === 'string' ? [buildContext] : [])]
  for (const context of contexts) {
    if (context === undefined) continue
    const contextDir = path.isAbsolute(context)
      ? path.normalize(context)
      : path.resolve(configDir, context)
    if (contextDir !== workspaceDir && !isPathInside(workspaceDir, contextDir, platform)) {
      return { ok: false, reason: 'host-context' }
    }
  }
  return { ok: true }
}

/** The node's additions to the merged override config. */
export interface DevcontainerNodeAdditions {
  /** Proxy URL for the sandbox egress proxy; container env when set. */
  readonly proxyUrl?: string
  /** Workspace network the box must join; node run-args when set. */
  readonly network?: string
}

/**
Merge the gated repo definition with the node's additions into the
override config the CLI runs instead of the repo file: sources
absolute, bind mounts absolutized, proxy and network injected,
customizations dropped. The repo file is never read at up time.
*/
export function mergeDevcontainerConfig(
  resolved: DevcontainerResolved,
  workspaceDir: string,
  additions: DevcontainerNodeAdditions,
): Record<string, unknown> {
  const config = resolved.configuration
  const configDir = path.dirname(config.configFilePath.fsPath)
  const merged: Record<string, unknown> = {}
  if (config.name !== undefined) merged['name'] = config.name
  if (config.image !== undefined) merged['image'] = config.image
  if (config.dockerFile !== undefined) {
    merged['dockerFile'] = path.isAbsolute(config.dockerFile)
      ? config.dockerFile
      : path.resolve(configDir, config.dockerFile)
  }
  if (config.features !== undefined) merged['features'] = config.features
  for (const key of [
    'onCreateCommand',
    'updateContentCommand',
    'postCreateCommand',
    'postStartCommand',
    'postAttachCommand',
  ] as const) {
    if (config[key] !== undefined) merged[key] = config[key]
  }
  if (config.mounts !== undefined) {
    merged['mounts'] = config.mounts.map((mount) => {
      const gated = gateMount(mount, workspaceDir, configDir, process.platform)
      if (!gated.ok) throw new DevcontainerRefusedError('host-mount')
      return gated.absolutized ?? mount
    })
  }
  if (config.build !== undefined) {
    const build: Record<string, unknown> = { ...config.build }
    for (const key of ['dockerfile', 'context'] as const) {
      const value = build[key]
      if (typeof value === 'string' && !path.isAbsolute(value)) {
        build[key] = path.resolve(configDir, value)
      }
    }
    merged['build'] = build
  }
  if (config.context !== undefined) {
    merged['context'] = path.isAbsolute(config.context)
      ? config.context
      : path.resolve(configDir, config.context)
  }
  if (config.remoteUser !== undefined) merged['remoteUser'] = config.remoteUser
  const containerEnv: Record<string, string> = { ...config.containerEnv }
  if (additions.proxyUrl !== undefined) {
    containerEnv['http_proxy'] = additions.proxyUrl
    containerEnv['https_proxy'] = additions.proxyUrl
  }
  if (Object.keys(containerEnv).length > 0) merged['containerEnv'] = containerEnv
  if (additions.network !== undefined) merged['runArgs'] = ['--network', additions.network]
  return merged
}

/** A CLI failure's stderr tail carried in the typed error. */
const DEVCONTAINER_ERROR_SNIPPET_CHARS = 200

/**
Run the CLI: spawn failures throw typed; exits (even failing ones)
resolve, because `up` errors ride non-zero with JSON on stdout —
the caller parses the output before judging the code.
*/
function runCli(
  cliPath: string,
  argv: readonly string[],
  cwd: string,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cliPath,
      [...argv],
      { cwd },
      execCallback(
        resolve,
        reject,
        (_cause, _stdout, stderr) =>
          new DevcontainerError(
            'cli-failed',
            `devcontainer ${argv[0] ?? ''} failed to spawn: ${stderr.slice(0, DEVCONTAINER_ERROR_SNIPPET_CHARS)}`,
          ),
      ),
    )
    child.on('error', () => {
      /* the callback above already typed it */
    })
  })
}

/** The CLI on PATH must be exactly the pin — any other version is refused. */
export async function checkDevcontainerVersion(cliPath: string, cwd: string): Promise<void> {
  const { exitCode, stdout, stderr } = await runCli(cliPath, ['--version'], cwd)
  if (exitCode !== 0) {
    throw new DevcontainerError(
      'cli-failed',
      `devcontainer --version exited ${String(exitCode)}: ${stderr.slice(0, DEVCONTAINER_ERROR_SNIPPET_CHARS)}`,
    )
  }
  const found = stdout.split('\n', 1)[0]?.trim() ?? ''
  if (found !== DEVCONTAINER_CLI_PIN) {
    throw new DevcontainerRefusedError('version-skew')
  }
}

/** Read and resolve the workspace's config through the CLI (parse only, never runs). */
export async function readDevcontainerConfig(
  cliPath: string,
  workspaceDir: string,
): Promise<DevcontainerResolved> {
  const { stdout } = await runCli(
    cliPath,
    ['read-configuration', '--workspace-folder', workspaceDir],
    workspaceDir,
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch (error: unknown) {
    throw new DevcontainerError('bad-output', 'devcontainer read-configuration printed no JSON', {
      cause: error,
    })
  }
  try {
    return devcontainerResolvedSchema.parse(parsed)
  } catch (error: unknown) {
    throw new DevcontainerError('bad-output', 'devcontainer read-configuration changed shape', {
      cause: error,
    })
  }
}

export function devcontainerUpArgv(options: {
  readonly workspaceDir: string
  readonly overrideConfig: string
  readonly idLabels: Readonly<Record<string, string>>
  readonly dockerPath?: string
}): readonly string[] {
  return [
    'up',
    '--workspace-folder',
    options.workspaceDir,
    '--override-config',
    options.overrideConfig,
    ...Object.entries(options.idLabels).flatMap(([key, value]) => [
      '--id-label',
      `${key}=${value}`,
    ]),
    ...(options.dockerPath === undefined ? [] : ['--docker-path', options.dockerPath]),
  ]
}

export function devcontainerExecArgv(options: {
  readonly containerId: string
  readonly command: readonly [string, ...string[]]
}): readonly string[] {
  return ['exec', '--container-id', options.containerId, ...options.command]
}

/**
Bring the workspace box up from the merged override config: the CLI's
result JSON parsed through zod whatever the exit code (success
carries the box; error carries its message, never a box).
*/
export async function devcontainerUp(
  cliPath: string,
  options: {
    readonly workspaceDir: string
    readonly overrideConfig: string
    readonly idLabels: Readonly<Record<string, string>>
    readonly dockerPath?: string
  },
): Promise<DevcontainerUpResult> {
  const { exitCode, stdout, stderr } = await runCli(
    cliPath,
    devcontainerUpArgv(options),
    options.workspaceDir,
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch (error: unknown) {
    throw new DevcontainerError(
      'bad-output',
      `devcontainer up printed no JSON (exit ${String(exitCode)}): ${stderr.slice(0, DEVCONTAINER_ERROR_SNIPPET_CHARS)}`,
      { cause: error },
    )
  }
  try {
    return devcontainerUpResultSchema.parse(parsed)
  } catch (error: unknown) {
    throw new DevcontainerError('bad-output', 'devcontainer up changed shape', { cause: error })
  }
}

/** Run a command in the box; without `maxBytes` the platform bound applies. */
export async function devcontainerExec(
  cliPath: string,
  cwd: string,
  options: {
    readonly containerId: string
    readonly command: readonly [string, ...string[]]
    readonly maxBytes?: number
  },
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = execFile(
      cliPath,
      [...devcontainerExecArgv(options)],
      {
        cwd,
        ...(options.maxBytes !== undefined && { maxBuffer: options.maxBytes }),
      },
      execCallback(
        resolve,
        reject,
        (_cause, _stdout, stderr) =>
          new DevcontainerError(
            'cli-failed',
            `devcontainer exec failed to run: ${stderr.slice(0, DEVCONTAINER_ERROR_SNIPPET_CHARS)}`,
          ),
      ),
    )
    child.on('error', () => {
      /* the callback above already typed it */
    })
  })
}
