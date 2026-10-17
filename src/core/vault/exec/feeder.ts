import { UI_TEXT, SHELL_OUTPUT_MAX_CHARS } from '../../../shared/constants'
import { type ShellResult } from '../../shellResult'
import { vaultUseDigest } from '../useDigest'
import { vaultFenceEnvironment } from './fence'
import { vaultExecUses } from './routes'
import { vaultExecEnvelopeSchema, type VaultExecEnvelope } from './schema'
import { sudoInvocation, VaultAskpass, clearSudoTimestamp } from './sudoFeed'
import { gitCredentialAnswer } from './gitHelper'

/** Only this private feeder port carries material; never a public tool result. */
export interface VaultExecLease {
  readonly value: Uint8Array
  readonly username: Uint8Array | null
  /** B closes the live channel on lock/revoke/connection loss. */
  readonly revoked: AbortSignal
  readonly expiresAt: number
  close(hasSucceeded: boolean): Promise<void>
}
/** T implements one independent stream per stdout/stderr, holding split matches until safe. */
export interface VaultExecScrubStream {
  push(bytes: Uint8Array): string
  end(): string
  dispose(): void
}
export interface VaultExecInvocation {
  readonly cleanup?: true
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly stdin: Uint8Array | null
}
export interface VaultExecFeederPort {
  readonly platform: NodeJS.Platform
  redeem(
    approval: VaultExecEnvelope['approvals'][number],
    signal: AbortSignal,
  ): Promise<VaultExecLease>
  /** A seed never arrives here: B/L supplies only the current TOTP code. */
  scrub(values: readonly Uint8Array[]): VaultExecScrubStream
  realPath(path: string): Promise<string>
  now(): number
  sshSocket(signal: AbortSignal): Promise<{ path: string; gitSshCommand?: string; close(): void }>
  /** Trusted helper transport authenticates descendants of this command's tree. */
  helpers(
    callbacks: {
      git?: (operation: string, input: string) => Buffer
      askpass?: () => Buffer
    },
    signal: AbortSignal,
  ): Promise<{ gitHelper: string; askpassPath: string; close(): Promise<void> }>
  run(
    invocation: VaultExecInvocation,
    signal: AbortSignal,
    stdout: (bytes: Buffer) => void,
    stderr: (bytes: Buffer) => void,
  ): Promise<Omit<ShellResult, 'stdout' | 'stderr'>>
}

/** Single owner for a command, its private leases, helpers, streams and lifetime. */
export async function runVaultFeeder(
  input: VaultExecEnvelope,
  baseEnv: NodeJS.ProcessEnv,
  port: VaultExecFeederPort,
  signal: AbortSignal,
): Promise<ShellResult> {
  const envelope = vaultExecEnvelopeSchema.parse(input)
  if (port.platform === 'win32' && envelope.run.secrets.sudo)
    throw new Error(UI_TEXT.vault.windowsElevation)
  const expected = vaultExecUses(envelope.run)
  if (
    expected.length !== envelope.approvals.length ||
    new Set(envelope.approvals.map(({ ticket }) => ticket.id)).size !== expected.length ||
    expected.some(({ use }, index) => {
      const approval = envelope.approvals[index]
      return (
        !approval ||
        vaultUseDigest(use) !== vaultUseDigest(approval.use) ||
        approval.ticket.digest !== vaultUseDigest(use)
      )
    })
  )
    throw new Error(UI_TEXT.vault.useChanged)
  const controller = new AbortController()
  const leases: VaultExecLease[] = []
  const unsubscribe: (() => void)[] = []
  const env = vaultFenceEnvironment(baseEnv)
  let stdin: Buffer | undefined
  const erase = () => {
    for (const lease of leases) {
      lease.value.fill(0)
      lease.username?.fill(0)
    }
    stdin?.fill(0)
    for (const name of Object.keys(env)) Reflect.deleteProperty(env, name)
  }
  const abort = () => {
    erase()
    controller.abort()
  }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const check = () => {
    controller.signal.throwIfAborted()
  }
  const verifyPaths = async () => {
    for (const original of [
      envelope.run.command.executable,
      envelope.run.command.cwd,
      ...(envelope.run.secrets.sudo ? [envelope.run.secrets.sudo.path] : []),
    ]) {
      const resolved = await port.realPath(original)
      const actual = resolved.replaceAll('\\', '/')
      check()
      if (actual !== original.replaceAll('\\', '/')) throw new Error(UI_TEXT.vault.useChanged)
    }
  }
  let helpers: Awaited<ReturnType<VaultExecFeederPort['helpers']>> | undefined
  let askpass: VaultAskpass | undefined
  let stdout: VaultExecScrubStream | undefined
  let stderr: VaultExecScrubStream | undefined
  let ssh: Awaited<ReturnType<VaultExecFeederPort['sshSocket']>> | undefined
  let hasSucceeded = false
  let hasFailed = false
  let outcome: ShellResult | undefined
  let shouldClearSudo = false
  try {
    check()
    await verifyPaths()
    for (const approval of envelope.approvals) {
      const lease = await port.redeem(approval, controller.signal)
      leases.push(lease)
      lease.revoked.addEventListener('abort', abort, { once: true })
      unsubscribe.push(() => {
        lease.revoked.removeEventListener('abort', abort)
      })
      if (lease.revoked.aborted) abort()
      check()
    }
    const values = leases.flatMap((lease) =>
      lease.username ? [lease.value, lease.username] : [lease.value],
    )
    stdout = port.scrub(values)
    stderr = port.scrub(values)
    const callbacks: Parameters<VaultExecFeederPort['helpers']>[0] = {}
    let invocation: VaultExecInvocation = {
      file: envelope.run.command.executable,
      args: envelope.run.command.argv,
      cwd: envelope.run.command.cwd,
      env,
      stdin: null,
    }
    for (const [index, approval] of envelope.approvals.entries()) {
      const lease = leases[index]
      if (!lease) throw new Error(UI_TEXT.vault.noAccess)
      const use = approval.use
      switch (use.kind) {
        case 'environment': {
          const value = new TextDecoder('utf-8', { fatal: true }).decode(lease.value)
          if (value.includes('\0')) throw new Error(UI_TEXT.vault.noAccess)
          for (const name of use.names) env[name] = value
          continue
        }
        case 'stdin':
        case 'totp':
        case 'sudo': {
          if (
            use.kind === 'sudo' &&
            (lease.value.includes(0) ||
              lease.value.includes('\n'.codePointAt(0) ?? 0) ||
              lease.value.includes('\r'.codePointAt(0) ?? 0))
          )
            throw new Error(UI_TEXT.vault.noAccess)
          stdin = Buffer.alloc(lease.value.length + (use.kind === 'stdin' ? 0 : 1))
          stdin.set(lease.value)
          if (use.kind !== 'stdin') stdin[stdin.length - 1] = '\n'.codePointAt(0) ?? 0
          invocation = { ...invocation, stdin }
          if (use.kind === 'sudo') {
            invocation = { ...invocation, ...sudoInvocation(use, approval.ticket.digest) }
          }
          continue
        }
        case 'askpass': {
          askpass = new VaultAskpass(lease.value, () => port.now())
          const access = askpass
          callbacks.askpass = () => {
            check()
            return access.read()
          }
          continue
        }
        case 'git': {
          const username = lease.username
          callbacks.git = (operation, input) => {
            check()
            return gitCredentialAnswer(
              use,
              operation,
              input,
              username,
              lease.value,
              lease.expiresAt,
              port.now(),
            )
          }
          continue
        }
        default: {
          throw new Error(UI_TEXT.vault.noAccess)
        }
      }
    }
    if (callbacks.git || callbacks.askpass) {
      helpers = await port.helpers(callbacks, controller.signal)
      check()
      if (callbacks.git) {
        env['GIT_CONFIG_COUNT'] = '3'
        env['GIT_CONFIG_KEY_2'] = 'credential.helper'
        env['GIT_CONFIG_VALUE_2'] = helpers.gitHelper
      }
      if (callbacks.askpass) env['SUDO_ASKPASS'] = helpers.askpassPath
    }
    if (envelope.run.secrets.ssh) {
      ssh = await port.sshSocket(controller.signal)
      env['SSH_AUTH_SOCK'] = ssh.path
      if (ssh.gitSshCommand !== undefined) env['GIT_SSH_COMMAND'] = ssh.gitSshCommand
      check()
    }
    await verifyPaths()
    check()
    let out = ''
    let err = ''
    const outStream = stdout
    const errStream = stderr
    shouldClearSudo = envelope.run.secrets.sudo !== undefined
    const result = await port.run(
      invocation,
      controller.signal,
      (bytes) => {
        try {
          check()
          out = (out + outStream.push(bytes)).slice(0, SHELL_OUTPUT_MAX_CHARS)
        } catch {
          abort()
        } finally {
          bytes.fill(0)
        }
      },
      (bytes) => {
        try {
          check()
          err = (err + errStream.push(bytes)).slice(0, SHELL_OUTPUT_MAX_CHARS)
        } catch {
          abort()
        } finally {
          bytes.fill(0)
        }
      },
    )
    check()
    out = (out + outStream.end()).slice(0, SHELL_OUTPUT_MAX_CHARS)
    err = (err + errStream.end()).slice(0, SHELL_OUTPUT_MAX_CHARS)
    hasSucceeded = result.exitCode === 0 && !result.isCancelled && !result.isTimedOut
    outcome = { ...result, stdout: out, stderr: err }
  } catch {
    hasFailed = true
  } finally {
    erase()
    signal.removeEventListener('abort', abort)
    for (const remove of unsubscribe) remove()
    askpass?.close()
    const attempt = async (work: () => void | Promise<void>) => {
      await work()
    }
    // Cleanup resources independently; one failed helper cannot retain another lease.
    const cleanup = await Promise.allSettled([
      ...leases.map(async (lease) => {
        await lease.close(hasSucceeded)
      }),
      attempt(async () => {
        await helpers?.close()
      }),
      attempt(() => stdout?.dispose()),
      attempt(() => stderr?.dispose()),
      attempt(() => ssh?.close()),
      ...(shouldClearSudo && envelope.run.secrets.sudo
        ? [
            clearSudoTimestamp(
              envelope.run.secrets.sudo.path,
              envelope.run.command.cwd,
              vaultFenceEnvironment(baseEnv),
              port,
            ),
          ]
        : []),
    ])
    hasFailed ||= cleanup.some((result) => result.status === 'rejected')
  }
  if (hasFailed || !outcome) throw new Error(UI_TEXT.vault.noAccess)
  return outcome
}
