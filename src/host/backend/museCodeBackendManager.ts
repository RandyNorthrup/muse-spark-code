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
import { type FingerprintWarning, spawnMspConnection } from '@muse-code/sdk'
import type { CredentialFileVerdict } from '../../core/backends/musecode/credentialFile'
import { MuseCodeHost, type MspHost } from '../../core/backends/musecode/MuseCodeHost'
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
import { withDeadline } from '../../core/timeouts'
import {
  MILLISECONDS_PER_SECOND,
  MSP_CLIENT_NAME,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MSP_KNOWN_SCHEMA_FINGERPRINTS,
  MSP_REQUESTED_CAPABILITIES,
  MUSE_VERSION_FILE,
  type EnvironmentVariable,
  MUSE_CERTIFICATE_VARIABLES,
  NO_PROXY_SEPARATOR,
  NO_PROXY_SPELLINGS,
  NO_PROXY_VARIABLE,
  PROXY_VARIABLE_SPELLINGS,
  type SandboxNetworkMode,
  type ShellSandboxMode,
} from '../../shared/constants'
import { readCredentialFile } from '../auth/cliAccount'
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
    const network = this.deps.getSandboxNetwork()
    if (network !== 'default' && !isSandboxNetworkApplied(network, posture)) {
      this.deps.log.warn(
        `museSpark.sandboxNetwork is ${network}, but the shell sandbox is off for this host, so commands have the network you have`,
      )
    }
    const env = this.childEnvironment()
    // The CLI's own credential pays (its login or its own key); the key the
    // panel stores is for the Model API backend and is never passed here.
    this.deps.log.info(
      `muse serve credentials: the CLI's own (credential file ${this.credentialFileVerdict()}, META_API_KEY in the environment ${this.hasEnvironmentKey() ? 'present' : 'absent'}); the extension's stored key is not passed`,
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
        // A chatty or looping CLI must not flood the log (PLAN.md D24), and
        // its free text is named in fixed words (the review of PR #49).
        this.deps.log.warn(`muse serve stderr: ${clipForLog(stderrForLog(chunk))}`)
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
        this.deps.log.warn(`Closing the unstarted muse serve failed: ${failureForLog(closeError)}`)
      }
      throw error
    }
    if (!spawned.initializeResult.grantedCapabilities.includes(IDE_MCP_CAPABILITY)) {
      this.deps.log.warn(
        `muse serve did not grant ${IDE_MCP_CAPABILITY}; the IDE diagnostics tool is unavailable (granted: ${spawned.initializeResult.grantedCapabilities.join(', ')})`,
      )
    }
    this.logFingerprint(spawned.fingerprintWarning)
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
   * `museSpark.environmentVariables` on top; with any proxy, loopback
   * bypasses it so Muse Code reaches the extension's `ide` server (M56).
   */
  public childEnvironment(): NodeJS.ProcessEnv {
    return withLoopbackBypass(
      buildChildEnvironment({
        platform: process.platform,
        baseEnv: process.env,
        extraVariables: [...this.proxyVariables(), ...this.deps.getEnvironmentVariables()],
        systemRoot: process.env['SystemRoot'],
        programFiles: process.env['ProgramFiles'],
      }),
      process.platform,
    )
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
      this.deps.log.warn(`Ignoring error while closing muse serve: ${failureForLog(error)}`)
    }
  }
}
