import { describe, expect, it, vi } from 'vitest'
import type { LaunchResolution } from '../../src/core/backends/musecode/launch'
import type { CliInvocation } from '../../src/core/backends/musecode/sandbox'
import {
  type ProcessResult,
  SandboxSetup,
  type SandboxSetupDeps,
} from '../../src/host/backend/sandboxSetup'
import { FakeLogOutputChannel } from './helpers/fakes'

const SETUP_REQUIRED = 'status=setup_required\nreason=sandbox users are not ready\n'
const READY = 'status=ready\n'

const launch: LaunchResolution = {
  ok: true,
  launch: {
    command: String.raw`C:\muse\muse-bin-1.exe`,
    args: ['serve'],
    serveArgs: ['serve'],
    installDir: String.raw`C:\muse`,
    cliPath: String.raw`C:\muse\muse.cmd`,
  },
}

interface Scripted {
  /** Reports returned by successive `check` runs. */
  readonly checks: readonly string[]
  readonly setupExitCode?: number
  readonly setupStderr?: string
}

function setup(
  script: Scripted,
  options: {
    platform?: NodeJS.Platform
    resolution?: LaunchResolution
    choice?: string | undefined
    isSuppressed?: boolean
  } = {},
) {
  const checks = [...script.checks]
  const runs: CliInvocation[] = []
  const run = vi.fn((invocation: CliInvocation): Promise<ProcessResult> => {
    runs.push(invocation)
    if (invocation.args.includes('-Command')) {
      return Promise.resolve({
        exitCode: script.setupExitCode ?? 0,
        stdout: '',
        stderr: script.setupStderr ?? '',
      })
    }
    const stdout = checks.shift()
    if (stdout === undefined) {
      throw new Error('unexpected check')
    }
    return Promise.resolve({ exitCode: stdout === READY ? 0 : 1, stdout, stderr: '' })
  })
  const showWarning = vi.fn((_message: string, ..._choices: readonly string[]) =>
    Promise.resolve(options.choice),
  )
  const showInformation = vi.fn<(message: string) => void>()
  const suppressPrompt = vi.fn(() => Promise.resolve())
  const log = new FakeLogOutputChannel()
  const deps: SandboxSetupDeps = {
    platform: options.platform ?? 'win32',
    systemRoot: String.raw`C:\Windows`,
    resolveLaunch: () => options.resolution ?? launch,
    run,
    showWarning,
    showInformation,
    isPromptSuppressed: () => options.isSuppressed ?? false,
    suppressPrompt,
    log,
  }
  return {
    sandbox: new SandboxSetup(deps),
    runs,
    showWarning,
    showInformation,
    suppressPrompt,
    log,
  }
}

const isSetupRun = (invocation: CliInvocation) => invocation.args.includes('-Command')

describe('SandboxSetup.offerIfNeeded', () => {
  it('does nothing off Windows without running anything', async () => {
    const t = setup({ checks: [] }, { platform: 'linux' })
    await t.sandbox.offerIfNeeded('startup')
    await t.sandbox.offerIfNeeded('failure')
    expect(t.runs).toHaveLength(0)
    expect(t.showWarning).not.toHaveBeenCalled()
  })

  it('stays quiet when the sandbox is ready', async () => {
    const t = setup({ checks: [READY] })
    await t.sandbox.offerIfNeeded('startup')
    expect(t.runs).toHaveLength(1)
    expect(t.runs[0]?.args).toEqual(['sandbox', 'windows', 'check'])
    expect(t.showWarning).not.toHaveBeenCalled()
  })

  it('sets up through UAC on "Set up now" and reports the re-check', async () => {
    const t = setup({ checks: [SETUP_REQUIRED, READY] }, { choice: 'Set up now' })
    await t.sandbox.offerIfNeeded('startup')
    expect(t.showWarning).toHaveBeenCalledWith(
      expect.stringContaining('administrator'),
      'Set up now',
      'Not now',
      "Don't ask again",
    )
    expect(t.runs.map((r) => isSetupRun(r))).toEqual([false, true, false])
    expect(t.runs[1]?.args.at(-1)).toContain('-Verb RunAs')
    expect(t.showInformation).toHaveBeenCalledWith(expect.stringContaining('sandbox is ready'))
    expect(t.log.info).toHaveBeenCalledWith(expect.stringContaining('Sandbox check: status=ready'))
  })

  it('warns when the elevated setup exits non-zero (declined UAC) and skips the re-check', async () => {
    const t = setup(
      {
        checks: [SETUP_REQUIRED],
        setupExitCode: 1,
        setupStderr: 'The operation was canceled by the user.\nat line 1',
      },
      { choice: 'Set up now' },
    )
    await t.sandbox.offerIfNeeded('startup')
    expect(t.runs).toHaveLength(2)
    expect(t.showWarning).toHaveBeenLastCalledWith(
      'Muse Code sandbox setup did not complete (exit 1: The operation was canceled by the user.).',
    )
    expect(t.showInformation).not.toHaveBeenCalled()
  })

  it('warns with the reason when the setup ran but the sandbox is still not ready', async () => {
    const t = setup({ checks: [SETUP_REQUIRED, SETUP_REQUIRED] }, { choice: 'Set up now' })
    await t.sandbox.offerIfNeeded('startup')
    expect(t.showWarning).toHaveBeenLastCalledWith(
      'Muse Code sandbox is still not ready: sandbox users are not ready.',
    )
  })

  it('asks once per host on startup, even after "Not now"', async () => {
    const t = setup({ checks: [SETUP_REQUIRED] }, { choice: 'Not now' })
    await t.sandbox.offerIfNeeded('startup')
    await t.sandbox.offerIfNeeded('startup')
    expect(t.showWarning).toHaveBeenCalledTimes(1)
    expect(t.suppressPrompt).not.toHaveBeenCalled()
  })

  it('asks again when a shell tool fails, but not while an offer is open', async () => {
    const t = setup({ checks: [SETUP_REQUIRED, SETUP_REQUIRED] }, { choice: 'Not now' })
    await t.sandbox.offerIfNeeded('startup')
    const first = t.sandbox.offerIfNeeded('failure')
    const second = t.sandbox.offerIfNeeded('failure')
    expect(second).toBe(first)
    await first
    expect(t.showWarning).toHaveBeenCalledTimes(2)
  })

  it('remembers "Don\'t ask again" for startup offers only', async () => {
    const t = setup({ checks: [SETUP_REQUIRED, SETUP_REQUIRED] }, { choice: "Don't ask again" })
    await t.sandbox.offerIfNeeded('startup')
    expect(t.suppressPrompt).toHaveBeenCalledTimes(1)
    const suppressed = setup(
      { checks: [SETUP_REQUIRED] },
      { isSuppressed: true, choice: 'Not now' },
    )
    await suppressed.sandbox.offerIfNeeded('startup')
    expect(suppressed.runs).toHaveLength(0)
    await suppressed.sandbox.offerIfNeeded('failure')
    expect(suppressed.showWarning).toHaveBeenCalledTimes(1)
  })

  it('skips the check when the CLI is not installed', async () => {
    const t = setup(
      { checks: [] },
      { resolution: { ok: false, searched: ['x'], reason: 'Muse Code is not installed.' } },
    )
    await t.sandbox.offerIfNeeded('startup')
    expect(t.runs).toHaveLength(0)
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('not installed'))
  })
})

describe('SandboxSetup.runCommand', () => {
  it('says the platform needs no setup off Windows', async () => {
    const t = setup({ checks: [] }, { platform: 'darwin' })
    await t.sandbox.runCommand()
    expect(t.showInformation).toHaveBeenCalledWith(expect.stringContaining('no sandbox setup'))
  })

  it('reports an already-ready sandbox without setting up', async () => {
    const t = setup({ checks: [READY] })
    await t.sandbox.runCommand()
    expect(t.runs).toHaveLength(1)
    expect(t.showInformation).toHaveBeenCalledWith('Muse Code sandbox is already set up.')
  })

  it('sets up directly when required, without the offer dialog', async () => {
    const t = setup({ checks: [SETUP_REQUIRED, READY] })
    await t.sandbox.runCommand()
    expect(t.runs.map((r) => isSetupRun(r))).toEqual([false, true, false])
    expect(t.showWarning).not.toHaveBeenCalled()
    expect(t.showInformation).toHaveBeenCalledWith(expect.stringContaining('sandbox is ready'))
  })

  it('warns when the CLI is missing', async () => {
    const t = setup(
      { checks: [] },
      { resolution: { ok: false, searched: [], reason: 'Muse Code is not installed.' } },
    )
    await t.sandbox.runCommand()
    expect(t.showWarning).toHaveBeenCalledWith(expect.stringContaining('not installed'))
  })

  it('logs each diagnostic line of the report', async () => {
    const t = setup({ checks: [`${SETUP_REQUIRED}diagnostic=a:b\ndiagnostic=c:d\n`, READY] })
    await t.sandbox.runCommand()
    expect(t.log.info).toHaveBeenCalledWith('Sandbox diagnostic: a:b')
    expect(t.log.info).toHaveBeenCalledWith('Sandbox diagnostic: c:d')
  })
})
