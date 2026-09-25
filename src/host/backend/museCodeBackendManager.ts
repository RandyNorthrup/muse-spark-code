// Owns the single `muse serve` process for this extension host: locates the
// CLI, shapes its environment, spawns it through the SDK, and hands out the
// MuseCodeHost wrapper. Everything platform-specific is delegated to the pure
// resolver in src/core; this module supplies the real filesystem and process
// facts.
//
// Lifecycle (PLAN.md D25): the handshake has a deadline and a host that
// misses it is killed; each spawn attempt owns the slot it was started in,
// so the late exit of a replaced host never forgets the new one; a host
// whose wrapper cannot be built is closed rather than orphaned; and the CLI
// location is resolved once per set of inputs instead of probing PATH on
// every message.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawnMspConnection } from '@muse-code/sdk'
import { MuseCodeHost, type MspHost } from '../../core/backends/musecode/MuseCodeHost'
import {
  buildChildEnvironment,
  credentialFilePath,
  environmentValue,
  type LaunchResolution,
  type MuseLaunch,
  resolveMuseLaunch,
} from '../../core/backends/musecode/launch'
import {
  resolveShellSandbox,
  serveArguments,
  type ShellSandboxPosture,
} from '../../core/backends/musecode/sandbox'
import { clipForLog } from '../../core/logging'
import { withDeadline } from '../../core/timeouts'
import {
  MILLISECONDS_PER_SECOND,
  MSP_CLIENT_NAME,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MSP_REQUESTED_CAPABILITIES,
  MUSE_VERSION_FILE,
  type EnvironmentVariable,
  type ShellSandboxMode,
} from '../../shared/constants'
import type { Logger } from '../logger'

/** VS Code's proxy settings (`http.proxy`, `http.noProxy`), handed to the CLI when its environment has none. */
export interface ProxySettings {
  readonly proxy: string
  readonly noProxy: readonly string[]
}

export interface BackendManagerDeps {
  readonly log: Logger
  readonly extensionVersion: string
  readonly getConfiguredBinaryPath: () => string
  readonly getEnvironmentVariables: () => readonly EnvironmentVariable[]
  readonly workspaceRoot: string | undefined
  /** `museSpark.shellSandbox`; read at each spawn (a host keeps its posture). */
  readonly getShellSandbox: () => ShellSandboxMode
  /** `%USERPROFILE%`; undefined off Windows. */
  readonly userProfileDir: string | undefined
  /** `vscode.workspace.isTrusted`; read at each spawn (PLAN.md D13). */
  readonly isWorkspaceTrusted: () => boolean
  /** VS Code's proxy settings, read at each spawn. */
  readonly getProxySettings: () => ProxySettings
  /** The handshake's deadline; the constant unless a test shortens it. */
  readonly handshakeTimeoutMs?: number
}

const [IDE_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES
const XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'
const META_API_KEY = 'META_API_KEY'
const PROXY_VARIABLES = ['HTTPS_PROXY', 'HTTP_PROXY'] as const
// POSIX tools read the lower-case spellings too; any of them means "configured".
const PROXY_SPELLINGS = ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'] as const
const NO_PROXY_VARIABLE = 'NO_PROXY'
const NO_PROXY_SPELLINGS = [NO_PROXY_VARIABLE, 'no_proxy'] as const
const NO_PROXY_SEPARATOR = ','

// A path that is not there, as opposed to one that is there and unreadable.
const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

/**
 * The CLI lookup's reads (M39): a missing file or folder is simply absent,
 * but one that cannot be read is said in the log, or "CLI not found" would
 * hide a permission problem.
 */
function unlessMissing<T>(log: Logger, what: string, read: () => T, absent: T): T {
  try {
    return read()
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (!MISSING_CODES.has(code)) {
      log.warn(`Could not read ${what} while looking for the Muse Code CLI: ${String(error)}`)
    }
    return absent
  }
}

function readTextFileOrUndefined(log: Logger, filePath: string): string | undefined {
  return unlessMissing(log, filePath, () => readFileSync(filePath, 'utf8'), undefined)
}

function listDirectoryOrEmpty(log: Logger, directory: string): readonly string[] {
  return unlessMissing(log, directory, () => readdirSync(directory), [])
}

export class MuseCodeBackendManager {
  private hostPromise: Promise<MuseCodeHost> | undefined
  /** Bumped by every spawn and every dispose: an attempt only clears its own slot. */
  private generation = 0
  private launchCache: { readonly key: string; readonly resolution: LaunchResolution } | undefined

  public constructor(private readonly deps: BackendManagerDeps) {}

  /** `http.proxy` as HTTPS_PROXY / HTTP_PROXY (and `http.noProxy` as NO_PROXY) when unset. */
  private proxyVariables(): readonly EnvironmentVariable[] {
    const { proxy, noProxy } = this.deps.getProxySettings()
    if (proxy === '') {
      return []
    }
    // What the CLI would see without VS Code's proxy: the inherited
    // environment and `museSpark.environmentVariables`, in either case on
    // POSIX, so a lowercase `https_proxy` set either way is never contradicted.
    const own = buildChildEnvironment({
      platform: process.platform,
      baseEnv: process.env,
      extraVariables: this.deps.getEnvironmentVariables(),
      systemRoot: process.env['SystemRoot'],
      programFiles: process.env['ProgramFiles'],
    })
    const isSet = (names: readonly string[]) =>
      names.some((name) => (environmentValue(own, process.platform, name) ?? '') !== '')
    if (isSet(PROXY_SPELLINGS)) {
      return []
    }
    const variables: EnvironmentVariable[] = PROXY_VARIABLES.map((name) => ({ name, value: proxy }))
    if (noProxy.length > 0 && !isSet(NO_PROXY_SPELLINGS)) {
      variables.push({ name: NO_PROXY_VARIABLE, value: noProxy.join(NO_PROXY_SEPARATOR) })
    }
    return variables
  }

  private async spawn(generation: number): Promise<MuseCodeHost> {
    const resolution = this.resolveLaunch()
    if (!resolution.ok) {
      throw new Error(`${resolution.reason} Searched: ${resolution.searched.join(', ')}`)
    }
    const launch: MuseLaunch = resolution.launch
    const posture = this.shellSandboxPosture()
    this.deps.log.info(
      `Shell sandbox ${posture.isSandboxed ? 'on' : 'off'} (${posture.reason}) for this host`,
    )
    const env = this.childEnvironment()
    // The CLI's own credential pays (its login or its own key); the key the
    // panel stores is for the Model API backend and is never passed here.
    this.deps.log.info(
      `muse serve credentials: the CLI's own (credential file ${this.credentialFileExists() ? 'present' : 'absent'}, META_API_KEY in the environment ${this.hasEnvironmentKey() ? 'present' : 'absent'}); the extension's stored key is not passed`,
    )
    this.deps.log.info(`Spawning ${launch.command} ${launch.args.join(' ')}`)
    // Spawn to handshake, for the log (M39).
    const spawnedAt = Date.now()
    const handshake = spawnMspConnection({
      command: launch.command,
      args: [...launch.args],
      ...(this.deps.workspaceRoot !== undefined && { cwd: this.deps.workspaceRoot }),
      env,
      onStderr: (chunk) => {
        // A chatty or looping CLI must not flood the log (PLAN.md D24).
        this.deps.log.warn(`muse serve stderr: ${clipForLog(chunk.trimEnd())}`)
      },
    })
    const timeoutMs = this.deps.handshakeTimeoutMs ?? MSP_HANDSHAKE_TIMEOUT_MS
    let spawned: Awaited<ReturnType<typeof handshake.initialize>>
    try {
      spawned = await withDeadline(
        handshake.initialize({
          clientInfo: { name: MSP_CLIENT_NAME, version: this.deps.extensionVersion },
          // The panel renders question cards (M4), so the host may send
          // `userInput/requested` instead of answering questions itself; the IDE
          // tool server (M5) needs the `sessionMcp` grant.
          capabilities: {
            userInputDialogs: true,
            requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
          },
        }),
        timeoutMs,
        `Muse Code did not finish starting within ${String(Math.round(timeoutMs / MILLISECONDS_PER_SECOND))} s`,
      )
    } catch (error: unknown) {
      // A process that never finished its handshake is ended, not left behind.
      try {
        await handshake.close()
      } catch (closeError: unknown) {
        this.deps.log.warn(`Closing the unstarted muse serve failed: ${String(closeError)}`)
      }
      throw error
    }
    if (!spawned.initializeResult.grantedCapabilities.includes(IDE_MCP_CAPABILITY)) {
      this.deps.log.warn(
        `muse serve did not grant ${IDE_MCP_CAPABILITY}; the IDE diagnostics tool is unavailable (granted: ${spawned.initializeResult.grantedCapabilities.join(', ')})`,
      )
    }
    if (spawned.fingerprintWarning !== undefined) {
      this.deps.log.warn(
        `MSP schema fingerprint mismatch: ${JSON.stringify(spawned.fingerprintWarning)}`,
      )
    }
    const mspHost: MspHost = {
      connection: spawned.connection,
      initializeResult: spawned.initializeResult,
      exited: spawned.exited,
      close: () => spawned.close(),
    }
    let host: MuseCodeHost
    try {
      host = new MuseCodeHost(mspHost, this.deps.log)
    } catch (error: unknown) {
      // An initialize result the wrapper cannot read: the process goes too.
      await spawned.close()
      throw error
    }
    this.deps.log.info(
      `Connected to ${host.info.serverName} ${host.info.serverVersion} in ${String(Date.now() - spawnedAt)} ms (museHome ${host.info.museHome})`,
    )
    host.onExit(() => {
      if (this.generation === generation) {
        this.hostPromise = undefined
      }
    })
    return host
  }

  /** A spawn that frees the slot when it fails, unless a newer attempt holds it. */
  private async spawnOwned(generation: number): Promise<MuseCodeHost> {
    try {
      return await this.spawn(generation)
    } catch (error: unknown) {
      if (this.generation === generation) {
        this.hostPromise = undefined
      }
      throw error
    }
  }

  /**
   * The environment `muse serve` runs in: the extension host's, the
   * Windows PowerShell module path, VS Code's proxy when none is set, and
   * `museSpark.environmentVariables` on top.
   */
  public childEnvironment(): NodeJS.ProcessEnv {
    return buildChildEnvironment({
      platform: process.platform,
      baseEnv: process.env,
      extraVariables: [...this.proxyVariables(), ...this.deps.getEnvironmentVariables()],
      systemRoot: process.env['SystemRoot'],
      programFiles: process.env['ProgramFiles'],
    })
  }

  /** The sandbox posture the next spawn installs (PLAN.md D12). */
  public shellSandboxPosture(): ShellSandboxPosture {
    return resolveShellSandbox({
      mode: this.deps.getShellSandbox(),
      platform: process.platform,
      workspaceRoot: this.deps.workspaceRoot,
      userProfileDir: this.deps.userProfileDir,
    })
  }

  /**
   * Where the CLI is, or why it could not be found. Resolved once per set of
   * inputs (the setting, PATH, the serve flags); a found CLI is re-checked
   * with one file probe, so an uninstall is noticed. `invalidateLaunch`
   * forgets the answer (a retry, a sign-in).
   */
  public resolveLaunch(): LaunchResolution {
    const env = process.env
    const pathValue = environmentValue(env, process.platform, 'PATH') ?? ''
    const configuredPath = this.deps.getConfiguredBinaryPath()
    const serveArgs = serveArguments(this.shellSandboxPosture(), this.deps.isWorkspaceTrusted())
    const key = JSON.stringify([configuredPath, pathValue, serveArgs])
    const cached = this.launchCache
    if (
      cached?.key === key &&
      (!cached.resolution.ok || existsSync(cached.resolution.launch.command))
    ) {
      return cached.resolution
    }
    const resolution = resolveMuseLaunch({
      platform: process.platform,
      configuredPath,
      pathEntries: pathValue.split(process.platform === 'win32' ? ';' : ':'),
      homeDir: homedir(),
      localAppData: env['LOCALAPPDATA'],
      fileExists: existsSync,
      readTextFile: (filePath) => readTextFileOrUndefined(this.deps.log, filePath),
      listDirectory: (directory) => listDirectoryOrEmpty(this.deps.log, directory),
      serveArgs,
    })
    this.launchCache = { key, resolution }
    return resolution
  }

  /** Forget the resolved CLI location: the next call probes again. */
  public invalidateLaunch(): void {
    this.launchCache = undefined
  }

  /** The version the installer recorded beside the CLI, for the diagnostics report. */
  public installedVersion(installDir: string): string | undefined {
    return readTextFileOrUndefined(this.deps.log, path.join(installDir, MUSE_VERSION_FILE))?.trim()
  }

  /**
   * Where the CLI keeps its sign-in, as `muse serve` will see it: an
   * `XDG_CONFIG_HOME` in `museSpark.environmentVariables` moves it (the
   * check and the CLI would otherwise disagree, Claude Code #66499).
   */
  public credentialFilePath(): string {
    return credentialFilePath({
      platform: process.platform,
      homeDir: homedir(),
      xdgConfigHome: environmentValue(this.childEnvironment(), process.platform, XDG_CONFIG_HOME),
    })
  }

  public credentialFileExists(): boolean {
    return existsSync(this.credentialFilePath())
  }

  /** A META_API_KEY in the CLI's environment (the user's own, or one the settings add). */
  public hasEnvironmentKey(): boolean {
    const key = environmentValue(this.childEnvironment(), process.platform, META_API_KEY)
    return key !== undefined && key !== ''
  }

  /** The running host, spawning it on first use. Rejects when the CLI is absent. */
  public ensureHost(): Promise<MuseCodeHost> {
    if (this.hostPromise !== undefined) {
      return this.hostPromise
    }
    this.generation += 1
    this.hostPromise = this.spawnOwned(this.generation)
    return this.hostPromise
  }

  public get isRunning(): boolean {
    return this.hostPromise !== undefined
  }

  public async dispose(): Promise<void> {
    const pending = this.hostPromise
    this.hostPromise = undefined
    this.generation += 1
    if (pending === undefined) {
      return
    }
    try {
      const host = await pending
      await host.close()
    } catch (error: unknown) {
      this.deps.log.warn(`Ignoring error while closing muse serve: ${String(error)}`)
    }
  }
}
