import type { HardwareStop } from '../../core/maker/guard/hardwareCommands'
import { createHardwareContexts } from '../../core/maker/hardwareContext'
import type { HardwareContext } from '../../core/maker/guard/httpCommands'
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

import path from 'node:path'
// The SDK's fingerprint advisory, type-only through its own module: any
// import of the package root keeps the SDK's side effects in the activation
// bundle under verbatimModuleSyntax, so activation never names the root.
import type { FingerprintWarning } from '@muse-code/sdk/dist/src/fingerprint.js'
import type { CredentialFileVerdict } from '../../core/backends/musecode/credentialFile'
import type { MuseCodeAccountHome } from '../../core/backends/musecode/accountHomes'
import type {
  CommandTimeouts,
  MuseCodeFeaturePorts,
  MuseCodeHost,
  spawnAccountMspConnection,
  MspHost,
} from '../../core/backends/musecode/MuseCodeHost'
import {
  isLinuxSandboxBlocked,
  isSandboxNetworkApplied,
  type LinuxSandboxReadiness,
  probeLinuxSandboxShell,
  resolveShellSandbox,
  sandboxAvailabilityWarning,
  serveArguments,
  type ShellSandboxPosture,
} from '../../core/backends/musecode/sandbox'
import { isMissingPath } from '../canonicalPath'
import { describeStoreError } from './storeErrors'
import { stillWaitingText, waitForAnswer } from '../../core/timeouts'
import {
  MSP_CLIENT_NAME,
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
  UI_TEXT,
} from '../../shared/constants'
import { isContributorModeEnabled } from './museSettings'
import type { UsageRecording } from '../../core/usage/recording'
import type { Logger } from '../logger'
import { requireFile } from '../lazyBundle'
import { isUsageNotesBundle, museCodeBundleLoader, type MuseCodeBundle } from './museCodeBundle'
import { systemPath } from './memoryIo'
import { admitResource } from '../../core/resources/admission'
import { spawnResourceConnection } from '../resources/museResourceLaunch'
import {
  credentialFilePath,
  type LaunchResolution,
  type MuseLaunch,
  resolveMuseLaunch,
  withLoopbackBypass,
} from '../../core/backends/musecode/launch'
import { buildChildEnvironment, environmentValue } from '../../core/execGuard'
import { type GuardedChildEnv, NO_WORKSPACE } from '../../core/executables'
import { resourceEnvironment, type ResourceLease } from '../../core/resources/launch'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { failureForLog, stderrForLog } from '../../core/backends/musecode/logText'
import { clipForLog } from '../../core/logging'
import { isSamePath } from '../../core/paths'
import { resolveWorkspacePath } from '../../core/workspacePath'
import { readCredentialFile } from '../auth/cliAccount'
import { vaultFenceEnvironment, type VaultFenceOptions } from '../../core/vault/exec/fence'

/** VS Code's proxy settings (`http.proxy`, `http.noProxy`), handed to the CLI when its environment has none. */
export interface ProxySettings {
  readonly proxy: string
  readonly noProxy: readonly string[]
}

/**
What the window does when Muse Code stops answering (the watchdog, CLI
recovery 2026-10-03): whether a turn runs on Muse Code in any of its
conversations, Muse Code's own restart (the conversations hear it first,
then the next message resumes them), and what the panels on it say.
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
  readonly hardwareContext?: (workspaceRoot: string | undefined) => HardwareContext
  readonly runHardwareStop?: (stop: HardwareStop) => Promise<void>
  readonly shellJobAssembly?: (() => Promise<string | undefined>) | undefined
  /** dist/museCode.js beside the running bundle, required the first time the backend starts. */
  readonly bundlePath: string
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
  /** This manager's usage recorder, put on the bundle's host class at every bundle load. */
  readonly usageRecording?: UsageRecording | undefined
  /** One manager per capture-gated CLI account. Absent preserves today's single account. */
  readonly accountHome?: MuseCodeAccountHome
  /** Awaited before any agent host process can edit this workspace. */
  readonly beforeWorkspaceHostStart: () => Promise<void>
  /**
  The window's answer to a Muse Code that stopped answering. The ACP agent
  has none (its editor owns its lifetime): there, while Muse Code answers
  nothing, commands fail at once and the log says why.
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
  /** The commands' deadlines and the watchdog's silence; the constants unless a test shortens them. */
  readonly featurePorts?: MuseCodeFeaturePorts | undefined
  readonly commandTimeouts?: CommandTimeouts
}

const [IDE_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES
const XDG_CONFIG_HOME = 'XDG_CONFIG_HOME'
const META_API_KEY = 'META_API_KEY'
// The variables VS Code's `http.proxy` is handed over as.
const PROXY_VARIABLES = ['HTTPS_PROXY', 'HTTP_PROXY'] as const

/**
The CLI lookup's reads (M39): a missing file or folder is simply absent,
but one that cannot be read is said in the log, or "CLI not found" would
hide a permission problem.
*/
function unlessMissing<T>(log: Logger, what: string, read: () => T, absent: T): T {
  try {
    return read()
  } catch (error: unknown) {
    // A missing file or folder is simply absent (M39); anything else is
    // said in the log, or "CLI not found" would hide a permission problem.
    if (isMissingPath(error)) {
      return absent
    }
    log.warn(
      `Could not read ${what} while looking for the Muse Code CLI: ${describeStoreError(error)} (${failureForLog(error)})`,
    )
    return absent
  }
}

function readTextFileOrUndefined(log: Logger, filePath: string): string | undefined {
  return unlessMissing(log, filePath, () => readFileSync(filePath, 'utf8'), undefined)
}

function listDirectoryOrEmpty(log: Logger, directory: string): readonly string[] {
  return unlessMissing(log, directory, () => readdirSync(directory), [])
}

/**
The feature ports the host is built with: while contributor mode is on,
the host's `serve` runs with `--contributor-mode on` (see `resolveLaunch`
and `contributorModeEnabled`), so its catalogue carries each listed
model's `-contributor` counterpart. Off leaves the caller's ports
untouched.
*/
function withContributorMode(
  ports: MuseCodeFeaturePorts | undefined,
  isEnabled: boolean,
): MuseCodeFeaturePorts | undefined {
  return isEnabled ? { ...ports, contributorMode: true } : ports
}

export class MuseCodeBackendManager {
  /**
  The runtime's journal when no manager carries its own (the ACP agent
  installs it through `installUsageRecording`): forwarded onto the
  bundle's host class at every bundle load, since dist/museCode.js
  carries its own copy of that class and its static.
  */
  public static usageRecording: UsageRecording | undefined
  private readonly hardware = createHardwareContexts()
  private hostPromise: Promise<MuseCodeHost> | undefined
  /** The Linux capability probe of the last started host (F91); one probe per start. */
  private linuxSandboxReadiness: LinuxSandboxReadiness | undefined
  /** Bumped by every spawn and every dispose: an attempt only clears its own slot. */
  private generation = 0
  private resourceStop = new AbortController()
  private launchCache: { readonly key: string; readonly resolution: LaunchResolution } | undefined
  /**
  How the last host's run ended in failure (`HostExit.isFailure`): the
  replacement host carries it, so the first turn that fails for a lost
  sign-in names the restart instead of failing quietly (F94). Only the
  restart that carries it clears it: a fault's Restart goes through
  `dispose`, and the failure it follows must still name the next start.
  */
  private failedExit: string | undefined
  /**
  The spawn generation the watchdog's own restart is stopping: that
  stop answers an unresponsive backend, so its exit still names the
  next start (Codex on PR #211). Stamped in `hostUnresponsive`, consumed
  by the stale exit. A user-asked Restart or an account-ending stop
  never stamps it; a stale stamp can never match a later generation.
  */
  private recoveryStopGeneration: number | undefined

  private readonly loadBackend: () => MuseCodeBundle

  public constructor(private readonly deps: BackendManagerDeps) {
    const load = museCodeBundleLoader({
      bundlePath: deps.bundlePath,
      log: deps.log,
      loadBundle: deps.loadBundle,
    })
    this.loadBackend = () => {
      const bundle = load()
      bundle.MuseCodeHost.usageRecording =
        deps.usageRecording ?? MuseCodeBackendManager.usageRecording
      // The live journal writers ride with the usage service bundle (PLAN.md
      // D6): sessions construct them on first use instead of carrying them
      // at startup.
      bundle.MuseCodeHost.usageNotesLoader = () => {
        const notes: unknown = requireFile(
          path.join(path.dirname(deps.bundlePath), 'usageService.js'),
        )
        if (!isUsageNotesBundle(notes)) throw new Error(UI_TEXT.actionFailed)
        return notes
      }
      return bundle
    }
  }

  /**
  Whether any of `names` is set, non-empty, in what the CLI would see
  without VS Code's proxy: the inherited environment and
  `museSpark.environmentVariables`, in either case on POSIX, so a
  lowercase `https_proxy` set either way is never contradicted.
  */
  private isOwnVariableSet(names: readonly string[]): boolean {
    const own = buildChildEnvironment({
      platform: process.platform,
      baseEnv: process.env,
      extraVariables: this.deps.getEnvironmentVariables(),
      systemRoot: process.env['SystemRoot'],
      programFiles: process.env['ProgramFiles'],
      scope:
        this.deps.workspaceRoot === undefined
          ? { noWorkspace: NO_WORKSPACE, realpath: realpathSync }
          : {
              workspaceRoot: this.deps.workspaceRoot,
              realpath: realpathSync,
            },
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
  The SDK reports a host whose schema fingerprint differs from its pin. A
  build known to be an additive successor is an info line naming it; any
  other difference stays a warning (0.9.1: every 1.4.0 start warned).
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

  /** A process that never finished its handshake is ended, not left behind. */
  private async closeUnstarted(handshake: { close(): Promise<unknown> }): Promise<void> {
    try {
      await handshake.close()
    } catch (closeError: unknown) {
      this.deps.log.warn(`Closing the unstarted muse serve failed: ${failureForLog(closeError)}`)
    }
  }

  /** A capture-gated account's host: the same admission, with its tree registered on the lease. */
  private async spawnAccountHost(
    backend: MuseCodeBundle,
    options: Parameters<typeof spawnAccountMspConnection>[0],
    accountHome: MuseCodeAccountHome,
    resource: ResourceLease | undefined,
    assertCanRun: () => Promise<void>,
  ): Promise<ReturnType<typeof spawnAccountMspConnection>> {
    return await spawnResourceConnection(
      (launch) => backend.spawnAccountMspConnection(launch, accountHome),
      options,
      resource,
      () => this.deps.shellJobAssembly?.() ?? Promise.resolve(undefined),
      environmentValue(options.env, process.platform, 'SystemRoot'),
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
    // Loaded before the lease is taken: a bundle that will not load must
    // refuse without holding resource admission.
    const backend = this.loadBackend()
    const resource = await admitResource('museServe', this.resourceStop.signal)
    if (this.generation !== generation) {
      resource?.complete(true)
      throw new Error(UI_TEXT.questionCancelled)
    }
    const posture = this.shellSandboxPosture()
    this.deps.log.info(
      `Shell sandbox ${posture.isSandboxed ? 'on' : 'off'} (${posture.reason}) for this host`,
    )
    // F91: while sandboxed on Linux, learn whether Muse Code's sandbox can
    // start on this machine at all, and say so once in words when it cannot,
    // instead of letting every unasked command fail with bwrap's raw line.
    // Turning the sandbox off stays the person's choice: the posture stands.
    // A fresh probe per start: the person may have allowed user namespaces
    // since the last one, then restarted the host.
    this.linuxSandboxReadiness = undefined
    const readiness = await this.readShellSandboxReadiness(posture)
    if (isLinuxSandboxBlocked(readiness)) {
      this.deps.log.warn(UI_TEXT.sandboxCannotStartNotice)
    } else if (readiness !== undefined && !readiness.canStart) {
      // The system-bwrap measurement failed without proving the sandbox
      // cannot start (Muse Code may use its embedded fallback), so this is
      // a log line in fixed words, never the cannot-start notice.
      this.deps.log.info(
        'Shell sandbox check: the system bwrap probe did not pass here; Diagnostics has the detail',
      )
    }
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
        ? await spawnResourceConnection(
            backend.spawnMspConnection,
            spawnOptions,
            resource,
            () => this.deps.shellJobAssembly?.() ?? Promise.resolve(undefined),
            environmentValue(env, process.platform, 'SystemRoot'),
            assertCanRun,
          )
        : await this.spawnAccountHost(backend, spawnOptions, accountHome, resource, assertCanRun)
    // No deadline of our own (owner 2026-10-16: no arbitrary limits): the
    // handshake is waited on until the server answers or the wait is
    // stopped, saying so out loud each minute. A process that exits fails
    // the handshake through its own rejection; dispose aborts
    // `resourceStop`, which ends this wait and reaps the process below.
    let spawned: Awaited<ReturnType<typeof handshake.initialize>>
    try {
      spawned = await waitForAnswer<Awaited<ReturnType<typeof handshake.initialize>>>(
        handshake.initialize({
          clientInfo: { name: MSP_CLIENT_NAME, version: this.deps.extensionVersion },
          // The panel renders question cards (M4), so the host may send
          // `userInput/requested` instead of answering questions itself; the IDE
          // tool server (M5) needs the `sessionMcp` grant. `experimentalApi`
          // unlocks `session/setPermissionProfile`, which keeps a mode switch
          // on the mode's reviewer (Manual asks the person, Auto the judge);
          // stable behavior is unchanged, and a host without the method
          // answers `methodNotFound`, which the sync tolerates.
          capabilities: {
            userInputDialogs: true,
            requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
            experimentalApi: true,
          },
        }),
        this.resourceStop.signal,
        () => new Error(UI_TEXT.questionCancelled),
        (elapsedMs) => {
          this.deps.log.info(stillWaitingText({ key: 'museServeStarting' }, elapsedMs))
        },
      )
    } catch (error: unknown) {
      await this.closeUnstarted(handshake)
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
    // The restart carries the crash that caused it, once: a later spawn
    // starts clean, and a failed spawn keeps it for the retry.
    const restartCause = this.failedExit
    try {
      this.deps.accountHome?.assertCurrent()
      host = new backend.MuseCodeHost(
        mspHost,
        this.deps.log,
        this.deps.commandTimeouts,
        // The per-model effort reader is always on (META-G05); an
        // injected port still wins where it speaks.
        {
          ...backend.museCodeEffortPort,
          ...withContributorMode(this.deps.featurePorts, this.contributorModeEnabled()),
        },
        undefined,
        this.deps.accountHome,
        restartCause,
        (workspaceRoot) =>
          this.deps.hardwareContext?.(workspaceRoot) ?? this.hardware(workspaceRoot).current(),
        this.deps.runHardwareStop,
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
    this.failedExit = undefined
    // The handshake result overrules the configuration log above: a host
    // that cannot enforce the sandbox says so, with its reason when sent.
    const sandboxWarning = sandboxAvailabilityWarning(posture, {
      availability: host.info.sandboxAvailability,
      unavailableReason: host.info.sandboxUnavailableReason,
    })
    if (sandboxWarning !== undefined) {
      this.deps.log.warn(sandboxWarning)
    }
    this.deps.log.info(
      `Connected to ${host.info.serverName} ${host.info.serverVersion} in ${String(Date.now() - spawnedAt)} ms (museHome ${host.info.museHome})`,
    )
    if (restartCause !== undefined) {
      this.deps.log.warn(
        `The previous run ${restartCause}; the replacement starts with the CLI's own credentials, as logged above`,
      )
    }
    host.onExit((exit) => {
      if (this.generation !== generation) {
        // A failure that lands while its stop was already asked for (the
        // incident's "exited as asked" at code 1) still names the next
        // start, unless a replacement already holds the slot. So does the
        // exit of a watchdog-stopped host: the stop answered a failure,
        // even though the close asked for it (Codex on PR #211).
        const isRecoveryStop = this.recoveryStopGeneration === generation
        if (isRecoveryStop) {
          this.recoveryStopGeneration = undefined
        }
        if (this.hostPromise === undefined && (isRecoveryStop || exit.isFailure)) {
          this.failedExit = exit.description
        }
        return
      }
      this.hostPromise = undefined
      // A run that ended in failure names the restart its replacement
      // carries; a clean stop leaves nothing behind.
      if (exit.isFailure) {
        this.failedExit = exit.description
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
  Muse Code stopped answering (the watchdog, CLI recovery), told once an
  episode: new commands already fail at once. With no turn running in any
  conversation of this window, it is restarted now and that is said;
  while one runs, its panel offers the restart, which stops that turn.
  */
  private async hostUnresponsive(unresponsive: UnresponsiveHostDeps): Promise<void> {
    if (unresponsive.isTurnRunning()) {
      this.deps.log.warn('Muse Code is not answering while a turn runs: its panel offers a restart')
      unresponsive.offerRestart()
      return
    }
    this.deps.log.warn('Muse Code is not answering and no turn runs: restarting it')
    // Stamp the generation this restart stops: the stop answers a failure,
    // so its exit still names the next start (Codex on PR #211). Stamping
    // is harmless when the restart never stops anything: no later
    // generation can match it.
    this.recoveryStopGeneration = this.generation
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
  The environment `muse serve` runs in: the extension host's, the
  Windows PowerShell module path, VS Code's proxy when none is set, and
  `museSpark.environmentVariables` on top; with any proxy, loopback
  bypasses it so Muse Code reaches the extension's `ide` server (M56).
  */
  /**
  The Muse Code backend's bundle (dist/museCode.js), required the first
  time the backend starts: the host class and the two SDK spawn paths.
  */
  public museCodeBundle(): MuseCodeBundle {
    return this.loadBackend()
  }

  public childEnvironment(): GuardedChildEnv {
    const env = withLoopbackBypass(
      buildChildEnvironment({
        platform: process.platform,
        baseEnv: process.env,
        extraVariables: [...this.proxyVariables(), ...this.deps.getEnvironmentVariables()],
        systemRoot: process.env['SystemRoot'],
        programFiles: process.env['ProgramFiles'],
        ...(this.deps.accountHome !== undefined && { accountHome: this.deps.accountHome }),
        scope:
          this.deps.workspaceRoot === undefined
            ? { noWorkspace: NO_WORKSPACE, realpath: realpathSync }
            : {
                workspaceRoot: this.deps.workspaceRoot,
                realpath: realpathSync,
              },
      }),
      process.platform,
    )
    return this.deps.getAgentFence?.() === false
      ? env
      : vaultFenceEnvironment(env, { ...this.deps.getVaultFence?.(), museCode: true })
  }

  /**
  Where `muse serve` gets its proxy, for the Diagnostics report (M56):
  its own environment (inherited or `environmentVariables`), VS Code's
  `http.proxy`, or nowhere. Muse Code reads the proxy variables only; a
  proxy VS Code finds in the system settings or a PAC file does not reach it.
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
  What the Linux capability probe measured (F91): whether Muse Code's
  sandbox can start on this machine. Undefined where the probe does not
  apply (off Linux, or the sandbox off) or while no host has started. A
  stale cache never answers while the current posture is off: turning
  `museSpark.shellSandbox` off after a probe ran reads as not checked.
  */
  public shellSandboxReadiness(): LinuxSandboxReadiness | undefined {
    return process.platform !== 'linux' || !this.shellSandboxPosture().isSandboxed
      ? undefined
      : this.linuxSandboxReadiness
  }

  /**
  The cached probe, or one fresh probe when it applies and none ran yet
  (the Diagnostics report reads this before any host has started).
  Applicability is checked before the cache, so a posture change is
  honoured even when only an earlier run populated it.
  */
  public async readShellSandboxReadiness(
    posture?: ShellSandboxPosture,
  ): Promise<LinuxSandboxReadiness | undefined> {
    const active = posture ?? this.shellSandboxPosture()
    if (process.platform !== 'linux' || !active.isSandboxed) {
      return undefined
    }
    if (this.linuxSandboxReadiness !== undefined) {
      return this.linuxSandboxReadiness
    }
    this.linuxSandboxReadiness = await probeLinuxSandboxShell(this.deps.workspaceRoot)
    return this.linuxSandboxReadiness
  }

  /**
  Whether the person's own Muse Code settings enable contributor mode, as
  the `serve` this manager starts will see them: the settings file in the
  config home of the child's own environment (an account home moves it,
  like the credential file). Read at each spawn — a running host keeps
  its lifetime posture — and never defaulted on: missing, unreadable or
  malformed reads as off.
  */
  public contributorModeEnabled(): boolean {
    return isContributorModeEnabled({
      platform: process.platform,
      homeDir: homedir(),
      xdgConfigHome: environmentValue(this.childEnvironment(), process.platform, XDG_CONFIG_HOME),
      readTextFile: (filePath) => readTextFileOrUndefined(this.deps.log, filePath),
    })
  }

  /**
  Where the CLI is, or why it could not be found. Resolved once per set of
  inputs (the setting, PATH, the serve flags); a found CLI is re-checked
  with one file probe, so an uninstall is noticed. `invalidateLaunch`
  forgets the answer (a retry, a sign-in).
  */
  public resolveLaunch(): LaunchResolution {
    const env = process.env
    const pathValue = environmentValue(env, process.platform, 'PATH') ?? ''
    const configuredPath = this.deps.getConfiguredBinaryPath()
    const serveArgs = serveArguments(
      this.shellSandboxPosture(),
      this.deps.isWorkspaceTrusted(),
      this.deps.getSandboxNetwork(),
      this.contributorModeEnabled(),
    )
    const key = JSON.stringify([configuredPath, pathValue, serveArgs])
    const cached = this.launchCache
    if (
      cached?.key === key &&
      (!cached.resolution.ok || existsSync(cached.resolution.launch.command))
    ) {
      return cached.resolution
    }
    // The workspace the child runs in: PATH entries inside it are never
    // probed, so a planted `muse` on an absolute workspace PATH entry never
    // resolves (docs/certification/pathguard.md).
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
      scope:
        this.deps.workspaceRoot === undefined
          ? { noWorkspace: NO_WORKSPACE, realpath: realpathSync }
          : {
              workspaceRoot: this.deps.workspaceRoot,
              realpath: realpathSync,
            },
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
  Where the CLI keeps its sign-in, as `muse serve` will see it: an
  `XDG_CONFIG_HOME` in `museSpark.environmentVariables` moves it (the
  check and the CLI would otherwise disagree, Claude Code #66499).
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
        error instanceof Error
          ? error
          : new Error(UI_TEXT.accounts.invalidAccount, { cause: error }),
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
      } catch (error: unknown) {
        throw new Error(UI_TEXT.checkpointFailed, { cause: error })
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

  public async dispose(options?: { readonly accountEnding?: boolean }): Promise<void> {
    this.resourceStop.abort()
    this.resourceStop = new AbortController()
    const pending = this.hostPromise
    this.hostPromise = undefined
    // A recorded failure is kept: a fault's Restart stops through here,
    // and the failure it follows still names the next start (F94). The
    // exit this stop is about to cause records itself above if it fails.
    // An account-ending stop (sign-out, shutdown) discards it instead: the
    // next sign-in starts clean, never blaming the previous account's run
    // (Codex on PR #211).
    if (options?.accountEnding === true) {
      this.failedExit = undefined
      this.recoveryStopGeneration = undefined
    }
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
