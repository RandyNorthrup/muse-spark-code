import { type ShellResult } from '../../shellResult'
import { UI_TEXT, SHELL_DEFAULT_TIMEOUT_MS } from '../../../shared/constants'
import type { ShellTimeLimit } from '../../backends/modelapi/tools'
import {
  vaultItemMetadataSchema,
  vaultTicketSchema,
  type VaultItemMetadata,
  type VaultTicket,
  type VaultUse,
} from '../../../shared/vault'
import { vaultUseDigest } from '../useDigest'
import { vaultExecUses } from './routes'
import { vaultRunSchema, type VaultExecEnvelope, type VaultRun } from './schema'

/** B/U authorize from the registered requester and authenticated UI, never tool arguments. */
export interface VaultExecHostPort {
  readonly platform: NodeJS.Platform
  authorize(handle: string, use: VaultUse, signal: AbortSignal): Promise<VaultTicket>
  list(signal: AbortSignal): Promise<readonly VaultItemMetadata[]>
  requestMissing(name: string, signal: AbortSignal): Promise<VaultItemMetadata>
  launch(
    envelope: VaultExecEnvelope,
    signal: AbortSignal,
    assertCanRun: () => void,
    options: VaultExecRunOptions,
  ): Promise<ShellResult>
  realPath(path: string): Promise<string>
}
export interface VaultExecRunOptions {
  readonly timeoutMs: number
  readonly limit?: ShellTimeLimit | undefined
}

/** The same port serves VS Code, the ACP runtime and native/companion bridges. */
export class VaultExecService {
  constructor(private readonly port: VaultExecHostPort) {}
  async list(signal: AbortSignal): Promise<string> {
    const items = await this.port.list(signal)
    signal.throwIfAborted()
    const publicItems = items
      .map((item) => vaultItemMetadataSchema.parse(item))
      .filter(
        (item) =>
          !item.hidden && !item.firstParty && !['devicePair', 'internal'].includes(item.kind),
      )
    return JSON.stringify(
      publicItems.map(({ handle, kind, label, bindings }) => ({ handle, kind, label, bindings })),
    )
  }
  async requestMissing(name: string, signal: AbortSignal): Promise<string> {
    const item = vaultItemMetadataSchema.parse(await this.port.requestMissing(name, signal))
    signal.throwIfAborted()
    if (item.hidden || item.firstParty || ['devicePair', 'internal'].includes(item.kind))
      throw new Error(UI_TEXT.vault.noAccess)
    return item.handle
  }
  async run(
    input: VaultRun,
    signal: AbortSignal,
    assertCanRun: () => void,
    options?: VaultExecRunOptions,
  ): Promise<ShellResult> {
    const run = vaultRunSchema.parse(input)
    if (this.port.platform === 'win32' && run.secrets.sudo)
      throw new Error(UI_TEXT.vault.windowsElevation)
    const check = () => {
      signal.throwIfAborted()
      assertCanRun()
    }
    check()
    const executable = await this.port.realPath(run.command.executable)
    run.command.executable = executable.replaceAll('\\', '/')
    check()
    const cwd = await this.port.realPath(run.command.cwd)
    run.command.cwd = cwd.replaceAll('\\', '/')
    check()
    if (run.secrets.sudo) {
      const sudoPath = await this.port.realPath(run.secrets.sudo.path)
      run.secrets.sudo.path = sudoPath.replaceAll('\\', '/')
      check()
    }
    const approvals: VaultExecEnvelope['approvals'] = []
    for (const { handle, use } of vaultExecUses(run)) {
      const ticket = vaultTicketSchema.parse(await this.port.authorize(handle, use, signal))
      check()
      if (ticket.digest !== vaultUseDigest(use)) throw new Error(UI_TEXT.vault.useChanged)
      approvals.push({ ticket, use })
    }
    check()
    return await this.port.launch(
      { run, approvals },
      signal,
      check,
      options ?? { timeoutMs: SHELL_DEFAULT_TIMEOUT_MS },
    )
  }
}
