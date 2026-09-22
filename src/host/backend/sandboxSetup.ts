// Gets Muse Code's Windows sandbox set up without sending the user to an
// elevated terminal: checks `muse sandbox windows check` when a chat surface
// opens (and again when a shell tool reports the sandbox missing), offers the
// one-time setup in a notification, relaunches the CLI through UAC on
// "Set up now", and re-checks. Every VS Code and process call is injected so
// the flow is unit-tested on every platform.

import type { LaunchResolution } from '../../core/backends/musecode/launch'
import {
  type CliInvocation,
  elevatedInvocation,
  parseSandboxCheck,
  type SandboxCheck,
  sandboxCheckInvocation,
  sandboxSetupInvocation,
} from '../../core/backends/musecode/sandbox'
import {
  SANDBOX_CHECK_TIMEOUT_MS,
  SANDBOX_SETUP_TIMEOUT_MS,
  SANDBOX_STATUS_READY,
  SANDBOX_STATUS_SETUP_REQUIRED,
  UI_TEXT,
} from '../../shared/constants'
import type { Logger } from '../logger'

export interface ProcessResult {
  /** The exit code, or a negative number when the process could not run or was killed. */
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface SandboxSetupDeps {
  readonly platform: NodeJS.Platform
  /** `%SystemRoot%`; undefined off Windows. */
  readonly systemRoot: string | undefined
  readonly resolveLaunch: () => LaunchResolution
  /** Runs a process to completion; resolves (never rejects) with its result. */
  readonly run: (invocation: CliInvocation, timeoutMs: number) => Promise<ProcessResult>
  /** A warning notification with buttons; resolves to the chosen label. */
  readonly showWarning: (
    message: string,
    ...choices: readonly string[]
  ) => Promise<string | undefined>
  readonly showInformation: (message: string) => void
  /** The "Don't ask again" flag in the extension's own global state. */
  readonly isPromptSuppressed: () => boolean
  readonly suppressPrompt: () => Promise<void>
  readonly log: Logger
}

const WINDOWS = 'win32'
const FAILED_EXIT_CODE = -1

/** A one-line description of what a process said, for notifications and logs. */
function firstLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0] ?? ''
}

export type SandboxOfferTrigger = 'startup' | 'failure'

export class SandboxSetup {
  private hasOffered = false
  private inFlight: Promise<void> | undefined

  public constructor(private readonly deps: SandboxSetupDeps) {}

  private get isWindows(): boolean {
    return this.deps.platform === WINDOWS
  }

  private async setUp(): Promise<void> {
    const resolution = this.deps.resolveLaunch()
    if (!resolution.ok || this.deps.systemRoot === undefined) {
      await this.deps.showWarning(UI_TEXT.sandboxCliMissing)
      return
    }
    const invocation = elevatedInvocation(
      this.deps.systemRoot,
      sandboxSetupInvocation(resolution.launch),
    )
    this.deps.log.info(`Sandbox setup: ${invocation.command} ${invocation.args.join(' ')}`)
    const result = await this.deps.run(invocation, SANDBOX_SETUP_TIMEOUT_MS)
    if (result.exitCode !== 0) {
      const detail = firstLine(result.stderr) || firstLine(result.stdout)
      const outcome =
        result.exitCode === FAILED_EXIT_CODE ? 'did not run' : `exited ${String(result.exitCode)}`
      this.deps.log.warn(`Sandbox setup ${outcome}: ${detail}`)
      await this.deps.showWarning(
        `${UI_TEXT.sandboxCancelled} (exit ${String(result.exitCode)}${detail === '' ? '' : `: ${detail}`}).`,
      )
      return
    }
    const report = await this.check()
    if (report?.status === SANDBOX_STATUS_READY) {
      this.deps.showInformation(UI_TEXT.sandboxReady)
      return
    }
    await this.deps.showWarning(
      `${UI_TEXT.sandboxStillRequired}${report?.reason === undefined ? '.' : `: ${report.reason}.`}`,
    )
  }

  private async offer(): Promise<void> {
    const report = await this.check()
    if (report?.status !== SANDBOX_STATUS_SETUP_REQUIRED) {
      return
    }
    const choice = await this.deps.showWarning(
      UI_TEXT.sandboxOffer,
      UI_TEXT.sandboxSetUpNow,
      UI_TEXT.sandboxNotNow,
      UI_TEXT.sandboxDontAskAgain,
    )
    if (choice === UI_TEXT.sandboxSetUpNow) {
      await this.setUp()
    } else if (choice === UI_TEXT.sandboxDontAskAgain) {
      await this.deps.suppressPrompt()
    }
  }

  private async offerTracked(): Promise<void> {
    try {
      await this.offer()
    } finally {
      this.inFlight = undefined
    }
  }

  /**
   * The sandbox report, or undefined off Windows or without the CLI. Never
   * throws: a check that cannot run is logged and reported as `unknown`.
   */
  public async check(): Promise<SandboxCheck | undefined> {
    if (!this.isWindows) {
      return undefined
    }
    const resolution = this.deps.resolveLaunch()
    if (!resolution.ok) {
      this.deps.log.warn(`Sandbox check skipped: ${resolution.reason}`)
      return undefined
    }
    const result = await this.deps.run(
      sandboxCheckInvocation(resolution.launch),
      SANDBOX_CHECK_TIMEOUT_MS,
    )
    const report = parseSandboxCheck(`${result.stdout}\n${result.stderr}`)
    this.deps.log.info(
      `Sandbox check: status=${report.status} exit=${String(result.exitCode)}${report.reason === undefined ? '' : ` reason=${report.reason}`}`,
    )
    for (const diagnostic of report.diagnostics) {
      this.deps.log.info(`Sandbox diagnostic: ${diagnostic}`)
    }
    return report
  }

  /**
   * Offers the setup when it is needed. `startup` asks at most once per
   * extension host and honours "Don't ask again"; `failure` (a shell tool just
   * reported the sandbox missing) asks again even after "Not now".
   */
  public offerIfNeeded(trigger: SandboxOfferTrigger): Promise<void> {
    if (!this.isWindows) {
      return Promise.resolve()
    }
    if (this.inFlight !== undefined) {
      return this.inFlight
    }
    if (trigger === 'startup' && (this.hasOffered || this.deps.isPromptSuppressed())) {
      return Promise.resolve()
    }
    this.hasOffered = true
    this.inFlight = this.offerTracked()
    return this.inFlight
  }

  /** The "Set Up Shell Sandbox" command: always reports, sets up when needed. */
  public async runCommand(): Promise<void> {
    if (!this.isWindows) {
      this.deps.showInformation(UI_TEXT.sandboxNotNeeded)
      return
    }
    const report = await this.check()
    if (report === undefined) {
      await this.deps.showWarning(UI_TEXT.sandboxCliMissing)
      return
    }
    if (report.status === SANDBOX_STATUS_READY) {
      this.deps.showInformation(UI_TEXT.sandboxAlreadyReady)
      return
    }
    await this.setUp()
  }
}
