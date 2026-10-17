import { resourceEnvironment, type ResourceLease } from '../../core/resources/launch'
// Owns the single `muse serve` process for this extension host: locates the
// CLI, shapes its environment, spawns it through the SDK, and hands out the
// MuseCodeHost wrapper. Everything platform-specific is delegated to the pure
// resolver in src/core; this module supplies the real filesystem and process
// facts.
//
// Lifecycle (PLAN.md D25): the handshake has a deadline, stretched once
// while the process still runs, and a host that misses it is killed; one
// that exits fails at once; each spawn attempt owns the slot it was started in,
// so the late exit of a replaced host never forgets the new one; a host
// whose wrapper cannot be built is closed rather than orphaned; and the CLI
// location is resolved once per set of inputs instead of probing PATH on
// every message.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { type FingerprintWarning } from '@muse-code/sdk'
import type { CredentialFileVerdict } from '../../core/backends/musecode/credentialFile'
import type { MuseCodeAccountHome } from '../../core/backends/musecode/accountHomes'
import {
  type CommandTimeouts,
  type MuseCodeFeaturePorts,
  MuseCodeHost,
  type spawnAccountMspConnection,
  type MspHost,
} from '../../core/backends/musecode/MuseCodeHost'
import {
  buildChildEnvironment,
  credentialFilePath,
  environmentValue,
  type LaunchResolution,
  type MuseLaunch,
  resolveMuseLaunch,
  withLoopbackBypass,
} from '../../core/backends/musecode/launch'
import {
  isSandboxNetworkApplied,
  resolveShellSandbox,
  serveArguments,
  type ShellSandboxPosture,
} from '../../core/backends/musecode/sandbox'
import { failureForLog, stderrForLog } from '../../core/backends/musecode/logText'
import { clipForLog } from '../../core/logging'
import { isSamePath } from '../../core/paths'
import { withSlowDeadline } from '../../core/timeouts'
import { resolveWorkspacePath } from '../../core/workspacePath'
import {
  MILLISECONDS_PER_SECOND,
  MSP_CLIENT_NAME,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MSP_KNOWN_SCHEMA_FINGERPRINTS,
  MSP_REQUESTED_CAPABILITIES,
  MSP_SLOW_HANDSHAKE_TIMEOUT_MS,
  MUSE_VERSION_FILE,
  type EnvironmentVariable,
  MUSE_CERTIFICATE_VARIABLES,
  NO_PROXY_SEPARATOR,
  NO_PROXY_SPELLINGS,
  NO_PROXY_VARIABLE,
  PROXY_VARIABLE_SPELLINGS,
  type SandboxNetworkMode,
  type ShellSandboxMode,
  UI_TEXT,
} from '../../shared/constants'
import { readCredentialFile } from '../auth/cliAccount'
import type { Logger } from '../logger'
import { systemPath } from './memoryIo'
import { admitResource } from '../../core/resources/admission'
import {
  spawnResourceMuseConnection,
  spawnResourceAccountConnection,
} from '../resources/museResourceLaunch'
import { vaultFenceEnvironment, type VaultFenceOptions } from '../../core/vault/exec/fence'

/** VS Code's proxy settings (`http.proxy`, `http.noProxy`), handed to the CLI when its environment has none. */
export interface ProxySettings {
  readonly proxy: string
  readonly noProxy: readonly string[]
}

/**
 * What the window does when Muse Code stops answering (the watchdog, CLI
 * recovery 2026-10-03): whether a turn runs on Muse Code in any of its
 * conversations, Muse Code's own restart (the conversations hear it first,
 * then the next message resumes them), and what the panels on it say.
 */
export interface UnresponsiveHostDeps {
  readonly isTurnRunning: () => boolean
  readonly restart: () => Promise<void>
  /** Restarted, no turn having run: a plain notice. */
  readonly sayRestarted: () => void
  /** A turn runs: the notice whose Restart (D26's action) the user may choose. */
  readonly offerRestart: () => void
}

export interface BackendManagerDeps {
  readonly shellJobAssembly?: (() => Promise<string | undefined>) | undefined
  /** One manager per capture-gated CLI account. Absent preserves today's single account. */
  readonly accountHome?: MuseCodeAccountHome
  /** Awaited before any agent host process can edit this workspace. */
  readonly beforeWorkspaceHostStart: () => Promise<void>
  /**
   * The window's answer to a Muse Code that stopped answering. The ACP agent
   * has none (its editor owns its lifetime): there, while Muse Code answers
   * nothing, commands fail at once and the log says why.
   */
  readonly unresponsive?: UnresponsiveHostDeps
  readonly log: Logger
  readonly extensionVersion: string
  readonly getConfiguredBinaryPath: () => string
  readonly getEnvironmentVariables: () => readonly EnvironmentVariable[]
  /** Main conversation only; every worker remains fenced. */
  readonly getAgentFence?: () => boolean
  /** S binds this host's own requester socket, never the user's ambient socket. */
  readonly getVaultFence?: () => VaultFenceOptions
  readonly workspaceRoot: string | undefined
  /** `museSpark.shellSandbox`; read at each spawn (a host keeps its posture). */
  readonly getShellSandbox: () => ShellSandboxMode
  /** `museSpark.sandboxNetwork`; read at each spawn, like the sandbox (M56). */
  readonly getSandboxNetwork: () => SandboxNetworkMode
  /** `%USERPROFILE%`; undefined off Windows. */
  readonly userProfileDir: string | undefined
  /** `vscode.workspace.isTrusted`; read at each spawn (PLAN.md D13). */
  readonly isWorkspaceTrusted: () => boolean
  /** VS Code's proxy settings, read at each spawn. */
  readonly getProxySettings: () => ProxySettings
  /** The handshake's deadline; the constant unless a test shortens it. */
  readonly handshakeTimeoutMs?: number
  /** The whole wait for a slow start whose process still runs; likewise. */
  readonly slowHandshakeTimeoutMs?: number
  /** The commands' deadlines and the watchdog's silence; the constants unless a test shortens them. */
  readonly featurePorts?: MuseCodeFeaturePorts | undefined
  readonly commandTimeouts?: CommandTimeouts
}

const [IDE_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES
const XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'
const META_API_KEY = 'META_API_KEY'
// The variables VS Code's `http.proxy` is handed over as.
const PROXY_VARIABLES = ['HTTPS_PROXY', 'HTTP_PROXY'] as const

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
  private resourceStop = new AbortController()
  private launchCache: { readonly key: string; readonly resolution: LaunchResolution } | undefined

  public constructor(private readonly deps: BackendManagerDeps) {}

  /**
   * Whether any of `names` is set, non-empty, in what the CLI would see
   * without VS Code's proxy: the inherited environment and
   * `museSpark.environmentVariables`, in either case on POSIX, so a
   * lowercase `https_proxy` set either way is never contradicted.
   */
  private isOwnVariableSet(names: readonly string[]): boolean {
    const own = buildChildEnvironment({
      platform: process.platform,
      baseEnv: process.env,
      extraVariables: this.deps.getEnvironmentVariables(),
      systemRoot: process.env['SystemRoot'],
      programFiles: process.env['ProgramFiles'],
    })
    return names.some((name) => (environmentValue(own, process.platform, name) ?? '') !== '')
  }

  /** `http.proxy` as HTTPS_PROXY / HTTP_PROXY (and `http.noProxy` as NO_PROXY) when unset. */
  private proxyVariables(): readonly EnvironmentVariable[] {
    const { proxy, noProxy } = this.deps.getProxySettings()
    if (proxy === '' || this.isOwnVariableSet(PROXY_VARIABLE_SPELLINGS)) {
      return []
    }
    const variables: EnvironmentVariable[] = PROXY_VARIABLES.map((name) => ({ name, value: proxy }))
    if (noProxy.length > 0 && !this.isOwnVariableSet(NO_PROXY_SPELLINGS)) {
      variables.push({ name: NO_PROXY_VARIABLE, value: noProxy.join(NO_PROXY_SEPARATOR) })
    }
    return variables
  }

  /**
   * The SDK reports a host whose schema fingerprint differs from its pin. A
   * build known to be an additive successor is an info line naming it; any
   * other difference stays a warning (0.9.1: every 1.4.0 start warned).
   */
  private logFingerprint(warning: FingerprintWarning | undefined): void {
    if (warning === undefined) {
      return
    }
    const build = MSP_KNOWN_SCHEMA_FINGERPRINTS[warning.served]
    if (build === undefined) {
      this.deps.log.warn(`MSP schema fingerprint mismatch: ${JSON.stringify(warning)}`)
      return
    }
    this.deps.log.info(
      `MSP schema ${warning.served} is Muse Code ${build}'s, an additive successor of the SDK's ${warning.pinned}`,
    )
  }

  /** A capture-gated account's host: the same admission, with its tree registered on the lease. */
  private async spawnAccountHost(
    options: Parameters<typeof spawnAccountMspConnection>[0],
    accountHome: MuseCodeAccountHome,
    resource: ResourceLease | undefined,
    assertCanRun: () => Promise<void>,
  ): Promise<ReturnType<typeof spawnAccountMspConnection>> {
    return await spawnResourceAccountConnection(
      options,
      accountHome,
      resource,
      () => this.deps.shellJobAssembly?.() ?? Promise.resolve(undefined),
      environmentValue(options.env ?? {}, process.platform, 'SystemRoot'),
      async () => {
        await assertCanRun()
        accountHome.assertCurrent()
      },
    )
  }

  private async spawn(generation: number): Promise<MuseCodeHost> {
    const resolution = this.resolveLaunch()
    if (!resolution.ok) {
      throw new Error(`${resolution.reason} Searched: ${resolution.searched.join(', ')}`)
    }
    const launch: MuseLaunch = resolution.launch
    await this.admitWorkspaceHost()
    const resource = await admitResource('museServe', this.resourceStop.signal)
    if (this.generation !== generation) {
      resource?.complete(true)
      throw new Error(UI_TEXT.questionCancelled)
    }
    const posture = this.shellSandboxPosture()
    this.deps.log.info(
      `Shell sandbox ${posture.isSandboxed ? 'on' : 'off'} (${posture.reason}) for this host`,
    )
    if (!posture.isSandboxed) {
      // Meta's permissions page: --disable-sandbox "also removes workspace
      // confinement from the file tools" (musecode-write-asks, 2026-10-04).
      this.deps.log.warn(
        'Without the sandbox, Muse Code’s file tools can write outside the workspace without asking',
      )
    }
    const network = this.deps.getSandboxNetwork()
    if (network !== 'default' && !isSandboxNetworkApplied(network, posture)) {
      this.deps.log.warn(
        `museSpark.sandboxNetwork is ${network}, but the shell sandbox is off for this host, so commands have the network you have`,
      )
    }
    const env = resourceEnvironment(this.childEnvironment(), resource)
    // The CLI's own credential pays (its login or its own key); the key the
    // panel stores is for the Model API backend and is never passed here.
    this.deps.log.info(
      `muse serve credentials: the CLI's own (credential file ${this.credentialFileVerdict()}, META_API_KEY in the environment ${this.hasEnvironmentKey() ? 'present' : 'absent'}); the extension's stored key is not passed`,
    )
    this.deps.log.info(`Spawning ${launch.command} ${launch.args.join(' ')}`)
    // Spawn to handshake, for the log (M39).
    const spawnedAt = Date.now()
    const spawnOptions = {
      command: launch.command,
      args: [...launch.args],
      ...(this.deps.workspaceRoot !== undefined && { cwd: this.deps.workspaceRoot }),
      env,
      onStderr: (chunk: string) => {
        // A chatty or looping CLI must not flood the log (PLAN.md D24), and
        // its free text is named in fixed words (the review of PR #49).
        this.deps.log.warn(`muse serve stderr: ${clipForLog(stderrForLog(chunk))}`)
      },
    }
    const assertCanRun = async () => {
      await this.admitWorkspaceHost()
      if (this.generation !== generation) throw new Error(UI_TEXT.questionCancelled)
    }
    const accountHome = this.deps.accountHome
    const handshake =
      accountHome === undefined
        ? await spawnResourceMuseConnection(
            spawnOptions,
            resource,
            () => this.deps.shellJobAssembly?.() ?? Promise.resolve(undefined),
            environmentValue(env, process.platform, 'SystemRoot'),
            assertCanRun,
          )
        : await this.spawnAccountHost(spawnOptions, accountHome, resource, assertCanRun)
    const firstMs = this.deps.handshakeTimeoutMs ?? MSP_HANDSHAKE_TIMEOUT_MS
    const totalMs = this.deps.slowHandshakeTimeoutMs ?? MSP_SLOW_HANDSHAKE_TIMEOUT_MS
    const seconds = (ms: number) => String(Math.round(ms / MILLISECONDS_PER_SECOND))
    // A process that exits fails the handshake at once; one still running at
    // the first deadline is starting slowly, and is waited for once more.
    let hasExited = false
    const noteExit = () => {
      hasExited = true
    }
    void handshake.exited.then(noteExit).catch(noteExit)
    let spawned: Awaited<ReturnType<typeof handshake.initialize>>
    try {
      spawned = await withSlowDeadline<Awaited<ReturnType<typeof handshake.initialize>>>(
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
        {
          firstMs,
          totalMs,
          isRunning: () => !hasExited,
          message: (ms) => `Muse Code did not finish starting within ${seconds(ms)} s`,
          onSlow: () => {
            this.deps.log.info(
              `muse serve is still starting after ${seconds(firstMs)} s and its process runs; waiting up to ${seconds(totalMs)} s in all`,
            )
          },
        },
      )
    } catch (error: unknown) {
      // A process that never finished its handshake is ended, not left behind.
      try {
        await handshake.close()
      } catch (closeError: unknown) {
        this.deps.log.warn(`Closing the unstarted muse serve failed: ${failureForLog(closeError)}`)
      }
      throw error
    }
    this.logFingerprint(spawned.fingerprintWarning)
    const mspHost: MspHost = {
      connection: spawned.connection,
      ...('commandOwner' in spawned && { commandOwner: spawned.commandOwner }),
      initializeResult: spawned.initializeResult,
      exited: spawned.exited,
      close: () => spawned.close(),
    }
    let host: MuseCodeHost
    try {
      this.deps.accountHome?.assertCurrent()
      host = new MuseCodeHost(
        mspHost,
        this.deps.log,
        this.deps.commandTimeouts,
        this.deps.featurePorts,
        undefined,
        this.deps.accountHome,
      )
    } catch (error: unknown) {
      // An initialize result the wrapper cannot read: the process goes too.
      await spawned.close()
      throw error
    }
    if (!host.info.grantedCapabilities.includes(IDE_MCP_CAPABILITY)) {
      this.deps.log.warn(
        `muse serve did not grant ${IDE_MCP_CAPABILITY}; the IDE diagnostics tool is unavailable (granted: ${host.info.grantedCapabilities.join(', ')})`,
      )
    }
    this.deps.log.info(
      `Connected to ${host.info.serverName} ${host.info.serverVersion} in ${String(Date.now() - spawnedAt)} ms (museHome ${host.info.museHome})`,
    )
    host.onExit(() => {
      if (this.generation === generation) {
        this.hostPromise = undefined
      }
    })
    const { unresponsive } = this.deps
    if (unresponsive !== undefined) {
      host.onUnresponsive(() => {
        if (this.generation === generation) {
          void this.hostUnresponsive(unresponsive)
        }
      })
    }
    return host
  }

  /**
   * Muse Code stopped answering (the watchdog, CLI recovery), told once an
   * episode: new commands already fail at once. With no turn running in any
   * conversation of this window, it is restarted now and that is said;
   * while one runs, its panel offers the restart, which stops that turn.
   */
  private async hostUnresponsive(unresponsive: UnresponsiveHostDeps): Promise<void> {
    if (unresponsive.isTurnRunning()) {
      this.deps.log.warn('Muse Code is not answering while a turn runs: its panel offers a restart')
      unresponsive.offerRestart()
      return
    }
    this.deps.log.warn('Muse Code is not answering and no turn runs: restarting it')
    try {
      await unresponsive.restart()
    } catch (error: unknown) {
      this.deps.log.warn(`Restarting the unanswering Muse Code failed: ${failureForLog(error)}`)
      return
    }
    unresponsive.sayRestarted()
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
   * `museSpark.environmentVariables` on top; with any proxy, loopback
   * bypasses it so Muse Code reaches the extension's `ide` server (M56).
   */
  public childEnvironment(): NodeJS.ProcessEnv {
    const env = withLoopbackBypass(
      buildChildEnvironment({
        platform: process.platform,
        baseEnv: process.env,
        extraVariables: [...this.proxyVariables(), ...this.deps.getEnvironmentVariables()],
        systemRoot: process.env['SystemRoot'],
        programFiles: process.env['ProgramFiles'],
        ...(this.deps.accountHome !== undefined && { accountHome: this.deps.accountHome }),
      }),
      process.platform,
    )
    return this.deps.getAgentFence?.() === false
      ? env
      : vaultFenceEnvironment(env, { ...this.deps.getVaultFence?.(), museCode: true })
  }

  /**
   * Where `muse serve` gets its proxy, for the Diagnostics report (M56):
   * its own environment (inherited or `environmentVariables`), VS Code's
   * `http.proxy`, or nowhere. Muse Code reads the proxy variables only; a
   * proxy VS Code finds in the system settings or a PAC file does not reach it.
   */
  public proxySource(): 'environment' | 'vscode' | 'none' {
    if (this.isOwnVariableSet(PROXY_VARIABLE_SPELLINGS)) {
      return 'environment'
    }
    return this.deps.getProxySettings().proxy === '' ? 'none' : 'vscode'
  }

  /** SSL_CERT_FILE or SSL_CERT_DIR is set for `muse serve`: they replace the system store (M56). */
  public hasCertificateOverride(): boolean {
    return this.isOwnVariableSet(MUSE_CERTIFICATE_VARIABLES)
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
    const serveArgs = serveArguments(
      this.shellSandboxPosture(),
      this.deps.isWorkspaceTrusted(),
      this.deps.getSandboxNetwork(),
    )
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

  /** What the credential file's structure says, never a value in it (D26): the log and Diagnostics. */
  public credentialFileVerdict(): CredentialFileVerdict | 'absent' {
    return readCredentialFile(this.credentialFilePath(), process.platform)?.verdict ?? 'absent'
  }

  /** A META_API_KEY in the CLI's environment (the user's own, or one the settings add). */
  public hasEnvironmentKey(): boolean {
    const key = environmentValue(this.childEnvironment(), process.platform, META_API_KEY)
    return key !== undefined && key !== ''
  }

  /** The running host, spawning it on first use. Rejects when the CLI is absent. */
  public ensureHost(): Promise<MuseCodeHost> {
    try {
      this.deps.accountHome?.assertCurrent()
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : new Error(UI_TEXT.accounts.invalidAccount),
      )
    }
    if (this.hostPromise !== undefined) {
      return this.hostPromise
    }
    this.generation += 1
    this.hostPromise = this.spawnOwned(this.generation)
    return this.hostPromise
  }

  /** Shared by agent and account-only serve startups in this workspace. */
  public async admitWorkspaceHost(): Promise<void> {
    await this.deps.beforeWorkspaceHostStart()
  }

  /** Server-owned lifetime/generation check reused by explicit file edits. */
  public workspaceActionGuard(signal: AbortSignal, cwd?: string): () => void {
    const generation = this.generation
    return () => {
      if (signal.aborted || this.generation !== generation) {
        throw new Error(UI_TEXT.questionCancelled)
      }
      if (
        cwd !== undefined &&
        (!this.deps.isWorkspaceTrusted() ||
          this.deps.workspaceRoot === undefined ||
          !isSamePath(cwd, this.deps.workspaceRoot, process.platform))
      ) {
        throw new Error(UI_TEXT.checkpointFailed)
      }
    }
  }

  /** CLI commands and terminal shells share the native startup fence. */
  public async startWorkspaceCommand<T>(
    start: () => T | Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    const check = this.workspaceActionGuard(signal)
    check()
    await this.admitWorkspaceHost()
    check()
    return await start()
  }

  /** Worktree mutation may run normal repository hooks; its cwd must own this workspace. */
  public async startWorktreeMutation(
    cwd: string,
    start: (ownedCwd: string) => Promise<string>,
    signal: AbortSignal,
  ): Promise<string> {
    const check = this.workspaceActionGuard(signal)
    return await this.startWorkspaceCommand(async () => {
      const workspaceRoot = this.deps.workspaceRoot
      if (workspaceRoot === undefined) {
        throw new Error(UI_TEXT.checkpointFailed)
      }
      let root: string
      let folder: string
      try {
        ;[root, folder] = await Promise.all([systemPath(workspaceRoot), systemPath(cwd)])
      } catch {
        throw new Error(UI_TEXT.checkpointFailed)
      }
      check()
      if (
        !isSamePath(root, folder, process.platform) &&
        !resolveWorkspacePath(folder, root, process.platform).ok
      ) {
        throw new Error(UI_TEXT.checkpointFailed)
      }
      return await start(folder)
    }, signal)
  }

  public get isRunning(): boolean {
    return this.hostPromise !== undefined
  }

  public async dispose(): Promise<void> {
    this.resourceStop.abort()
    this.resourceStop = new AbortController()
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
      this.deps.log.warn(`Ignoring error while closing muse serve: ${failureForLog(error)}`)
    }
  }
}
