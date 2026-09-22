// Owns the single `muse serve` process for this extension host: locates the
// CLI, shapes its environment, spawns it through the SDK, and hands out the
// MuseCodeHost wrapper. Everything platform-specific is delegated to the pure
// resolver in src/core; this module supplies the real filesystem and process
// facts.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawnMspConnection } from '@muse-code/sdk'
import { MuseCodeHost, type MspHost } from '../../core/backends/musecode/MuseCodeHost'
import {
  buildChildEnvironment,
  credentialFilePath,
  type LaunchResolution,
  type MuseLaunch,
  resolveMuseLaunch,
} from '../../core/backends/musecode/launch'
import {
  resolveShellSandbox,
  serveArguments,
  type ShellSandboxPosture,
} from '../../core/backends/musecode/sandbox'
import {
  type EnvironmentVariable,
  MSP_CLIENT_NAME,
  MSP_REQUESTED_CAPABILITIES,
  type ShellSandboxMode,
} from '../../shared/constants'
import type { Logger } from '../logger'

export interface BackendManagerDeps {
  readonly log: Logger
  readonly extensionVersion: string
  readonly getConfiguredBinaryPath: () => string
  readonly getEnvironmentVariables: () => readonly EnvironmentVariable[]
  readonly getApiKey: () => Promise<string | undefined>
  readonly workspaceRoot: string | undefined
  /** `museSpark.shellSandbox`; read at each spawn (a host keeps its posture). */
  readonly getShellSandbox: () => ShellSandboxMode
  /** `%USERPROFILE%`; undefined off Windows. */
  readonly userProfileDir: string | undefined
}

const [IDE_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES

function readTextFileOrUndefined(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
}

export class MuseCodeBackendManager {
  private hostPromise: Promise<MuseCodeHost> | undefined

  public constructor(private readonly deps: BackendManagerDeps) {}

  private async spawn(): Promise<MuseCodeHost> {
    const resolution = this.resolveLaunch()
    if (!resolution.ok) {
      throw new Error(`${resolution.reason} Searched: ${resolution.searched.join(', ')}`)
    }
    const launch: MuseLaunch = resolution.launch
    const posture = this.shellSandboxPosture()
    this.deps.log.info(
      `Shell sandbox ${posture.isSandboxed ? 'on' : 'off'} (${posture.reason}) for this host`,
    )
    const env = buildChildEnvironment({
      platform: process.platform,
      baseEnv: process.env,
      extraVariables: this.deps.getEnvironmentVariables(),
      apiKey: await this.deps.getApiKey(),
      systemRoot: process.env['SystemRoot'],
      programFiles: process.env['ProgramFiles'],
    })
    this.deps.log.info(`Spawning ${launch.command} ${launch.args.join(' ')}`)
    const handshake = spawnMspConnection({
      command: launch.command,
      args: [...launch.args],
      ...(this.deps.workspaceRoot !== undefined && { cwd: this.deps.workspaceRoot }),
      env,
      onStderr: (chunk) => {
        this.deps.log.warn(`muse serve stderr: ${chunk.trimEnd()}`)
      },
    })
    const spawned = await handshake.initialize({
      clientInfo: { name: MSP_CLIENT_NAME, version: this.deps.extensionVersion },
      // The panel renders question cards (M4), so the host may send
      // `userInput/requested` instead of answering questions itself; the IDE
      // tool server (M5) needs the `sessionMcp` grant.
      capabilities: {
        userInputDialogs: true,
        requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
      },
    })
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
    const host = new MuseCodeHost(mspHost, this.deps.log)
    this.deps.log.info(
      `Connected to ${host.info.serverName} ${host.info.serverVersion} (museHome ${host.info.museHome})`,
    )
    host.onExit(() => {
      this.hostPromise = undefined
    })
    return host
  }

  /** `spawn`, plus forgetting the attempt so the next call can retry. */
  private async spawnTracked(): Promise<MuseCodeHost> {
    try {
      return await this.spawn()
    } catch (error: unknown) {
      this.hostPromise = undefined
      throw error
    }
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

  /** Where the CLI is, or why it could not be found. Cheap; no process. */
  public resolveLaunch(): LaunchResolution {
    const env = process.env
    return resolveMuseLaunch({
      platform: process.platform,
      configuredPath: this.deps.getConfiguredBinaryPath(),
      pathEntries: (env['PATH'] ?? env['Path'] ?? '').split(
        process.platform === 'win32' ? ';' : ':',
      ),
      homeDir: homedir(),
      localAppData: env['LOCALAPPDATA'],
      systemRoot: env['SystemRoot'],
      fileExists: existsSync,
      readTextFile: readTextFileOrUndefined,
      serveArgs: serveArguments(this.shellSandboxPosture()),
    })
  }

  public credentialFileExists(): boolean {
    return existsSync(
      credentialFilePath({
        platform: process.platform,
        homeDir: homedir(),
        xdgConfigHome: process.env['XDG_CONFIG_HOME'],
      }),
    )
  }

  public hasEnvironmentKey(): boolean {
    const key = process.env['META_API_KEY']
    return key !== undefined && key !== ''
  }

  /** The running host, spawning it on first use. Rejects when the CLI is absent. */
  public ensureHost(): Promise<MuseCodeHost> {
    this.hostPromise ??= this.spawnTracked()
    return this.hostPromise
  }

  public get isRunning(): boolean {
    return this.hostPromise !== undefined
  }

  public async dispose(): Promise<void> {
    const pending = this.hostPromise
    this.hostPromise = undefined
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
