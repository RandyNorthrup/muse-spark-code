import * as z from 'zod/mini'
import { parseArgs } from 'node:util'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  vaultApprovalAnswerSchema,
  vaultAuditRecordSchema,
  vaultGrantSchema,
  vaultItemMetadataSchema,
  vaultItemSchema,
  type VaultApprovalAnswer,
  type VaultItem,
  type VaultItemMetadata,
  type VaultGrant,
} from '../../shared/vault'
import {
  vaultApprovalResultSchema,
  vaultBrokerEventSchema,
  vaultStatusSchema,
  type VaultPendingReceipt,
  type VaultResetChallenge,
} from '../../shared/vaultProtocol'
import { vaultRefusalSentences } from '../../shared/vaultRefusals'
import { vaultApprovalText, vaultDecisionChoices } from './vaultApproval'
import type { VaultImportReport, VaultManagementPort } from '../../core/vault/broker/ports'
import { vaultWriterRecoveryMessage } from '../../core/vault/broker/manageClient'
import { vaultPersonPolicySchema, type VaultPersonPolicy } from '../../shared/vault'

const auditFilterSchema = z.strictObject({
  item: z.optional(vaultAuditRecordSchema.shape.handle),
  requester: z.optional(vaultAuditRecordSchema.shape.requester.shape.id),
  kind: z.optional(vaultAuditRecordSchema.shape.kind),
  outcome: z.optional(vaultAuditRecordSchema.shape.outcome),
})
type AuditFilter = z.infer<typeof auditFilterSchema>

export type VaultReadCommand = 'status' | 'list' | 'lock' | 'audit'
export type VaultCommandOptions =
  | {
      command: VaultReadCommand | 'watch' | 'setup' | 'recover' | 'reset'
      filters?: AuditFilter
    }
  | { command: 'unlock'; slotId: string | null }
  | { command: 'add'; metadata: VaultItemMetadata }
  | { command: 'grant'; grant: VaultGrant }
  | { command: 'remove' | 'public-key'; itemId: string }
  | { command: 'revoke'; grantId: string }
  | { command: 'import'; path: string }
  | { command: 'receipts' }
  | { command: 'policy'; policy?: VaultPersonPolicy }

/** Trusted local management channel only. Private material never uses the panel/MHP port. */
export interface VaultCommandPort extends Pick<
  VaultManagementPort,
  'setup' | 'confirmSetup' | 'cancelSetup' | 'recover'
> {
  status(): Promise<unknown>
  list(): Promise<unknown>
  lock(): Promise<void>
  audit(): Promise<unknown>
  unlock(slotId: string | null): Promise<void>
  add(item: VaultItem): Promise<void>
  remove(itemId: string): Promise<void>
  grant(grant: VaultGrant): Promise<void>
  revoke(grantId: string): Promise<void>
  importFile(path: string): Promise<VaultImportReport>
  keepImport(receipt: string): Promise<void>
  deleteImport(receipt: string): Promise<void>
  /** Kept or orphaned receipts that can still be finished (RVAPP-CM1091D5 P2-2). */
  pendingReceipts(): Promise<readonly VaultPendingReceipt[]>
  /** Reset Vault (lead decision): only for a lost vault; two steps. */
  resetBegin(): Promise<VaultResetChallenge>
  resetConfirm(resetId: string, word: string): Promise<void>
  publicKey(itemId: string): Promise<unknown>
  watch(signal: AbortSignal): AsyncIterable<unknown>
  answer(answer: VaultApprovalAnswer): Promise<unknown>
  close(): Promise<void>
}
export interface VaultCommandDeps {
  open(): Promise<VaultCommandPort>
  readMaterial(signal: AbortSignal): Promise<unknown>
  /** Native terminal UI only; the decision never comes from argv, a model or hook. */
  choose(title: string, options: readonly string[], signal: AbortSignal): Promise<string>
  print(text: string): void
  printError(text: string): void
  /** A terminal is attached: setup and recovery never run without one. */
  readonly isInteractive: boolean
  /** One hidden terminal line (echo off), as owned bytes. */
  readLine(prompt: string, signal: AbortSignal): Promise<Buffer>
  now(): number
  signal: AbortSignal
  /** D216: the person's vault policy file, read and replaced whole. */
  policy: {
    read(): Promise<VaultPersonPolicy | undefined>
    write(policy: VaultPersonPolicy): Promise<void>
  }
}

export function vaultUsage(): string {
  return `${UI_TEXT.vault.title}: setup | recover | reset | status | unlock [slot-id] | lock | list | add <metadata-json> | remove <item-id> | grant <grant-json> | revoke <grant-id> | policy [<policy-json>] | audit [--item <handle>] [--requester <id>] [--kind <kind>] [--outcome <outcome>] | import <path> | receipts | public-key <item-id> | watch`
}

/** Parse without echoing supplied arguments or JSON errors (they can contain an accidental value). */
export function parseVaultCommand(args: readonly string[]): VaultCommandOptions | undefined {
  const [command, argument, ...rest] = args
  try {
    if (command === 'audit') {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: false,
        options: {
          item: { type: 'string' },
          requester: { type: 'string' },
          kind: { type: 'string' },
          outcome: { type: 'string' },
        },
      })
      return { command, filters: auditFilterSchema.parse(parsed.values) }
    }
    if (rest.length > 0) return undefined
    const read = (['status', 'list', 'lock', 'watch', 'setup', 'recover', 'reset'] as const).find(
      (candidate) => candidate === command,
    )
    if (argument === undefined && read !== undefined) return { command: read }
    // Finish kept or orphaned imports from the terminal (RVAPP-CM1091D5 P2-2).
    if (command === 'receipts' && argument === undefined) return { command: 'receipts' }
    if (command === 'policy' && argument === undefined) return { command: 'policy' }
    if (command === 'unlock')
      return {
        command,
        slotId: argument === undefined ? null : vaultItemMetadataSchema.shape.id.parse(argument),
      }
    if (argument === undefined || Buffer.byteLength(argument) > VAULT_LIMITS.frameBytes)
      return undefined
    switch (command) {
      case 'add': {
        return { command, metadata: vaultItemMetadataSchema.parse(JSON.parse(argument)) }
      }
      case 'grant': {
        return { command, grant: vaultGrantSchema.parse(JSON.parse(argument)) }
      }
      case 'policy': {
        return { command, policy: vaultPersonPolicySchema.parse(JSON.parse(argument)) }
      }
      case 'remove':
      case 'public-key': {
        return { command, itemId: vaultItemMetadataSchema.shape.id.parse(argument) }
      }
      case 'revoke': {
        return { command, grantId: vaultGrantSchema.shape.id.parse(argument) }
      }
      case 'import': {
        return {
          command,
          path: z
            .string()
            .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]*$/u))
            .parse(argument),
        }
      }
      default: {
        return undefined
      }
    }
  } catch {
    // No usage line echoes arguments or JSON errors: they can carry an accidental value.
    return undefined
  }
}

export async function vaultRead(
  port: VaultCommandPort,
  command: VaultReadCommand,
  isAgent = false,
  filters: AuditFilter = {},
): Promise<string> {
  switch (command) {
    case 'status': {
      return JSON.stringify(vaultStatusSchema.parse(await port.status()))
    }
    case 'list': {
      const items = z
        .array(vaultItemMetadataSchema)
        .check(z.maxLength(VAULT_LIMITS.items))
        .parse(await port.list())
      return JSON.stringify(
        isAgent
          ? items.filter(
              (item) =>
                !item.hidden && !item.firstParty && !['devicePair', 'internal'].includes(item.kind),
            )
          : items,
      )
    }
    case 'lock': {
      await port.lock()
      return UI_TEXT.vault.locked
    }
    case 'audit': {
      const records = z
        .array(vaultAuditRecordSchema)
        .check(z.maxLength(VAULT_LIMITS.items))
        .parse(await port.audit())
      const visible = isAgent
        ? new Set(
            z
              .array(vaultItemMetadataSchema)
              .check(z.maxLength(VAULT_LIMITS.items))
              .parse(await port.list())
              .filter(
                (item) =>
                  !item.hidden &&
                  !item.firstParty &&
                  !['devicePair', 'internal'].includes(item.kind),
              )
              .map((item) => item.handle),
          )
        : undefined
      const filter = auditFilterSchema.parse(filters)
      return JSON.stringify(
        records.filter(
          (record) =>
            (visible === undefined || visible.has(record.handle)) &&
            (filter.item === undefined || record.handle === filter.item) &&
            (filter.requester === undefined || record.requester.id === filter.requester) &&
            (filter.kind === undefined || record.kind === filter.kind) &&
            (filter.outcome === undefined || record.outcome === filter.outcome),
        ),
      )
    }
  }
}

/** Material schemas are flat; erase all owned byte fields, including invalid input. */
export function wipeVaultMaterial(material: unknown): void {
  if (typeof material !== 'object' || material === null) return
  for (const bytes of Object.values(material)) if (bytes instanceof Uint8Array) bytes.fill(0)
}

async function watch(port: VaultCommandPort, deps: VaultCommandDeps): Promise<void> {
  const seen = new Set<string>()
  for await (const raw of port.watch(deps.signal)) {
    deps.signal.throwIfAborted()
    const event = vaultBrokerEventSchema.parse(raw)
    if (event.kind !== 'approval') continue
    const request = event.request
    if (seen.has(request.id)) continue
    if (seen.size >= VAULT_LIMITS.items) throw new Error(UI_TEXT.vault.noAccess)
    seen.add(request.id)
    const before = vaultStatusSchema.parse(await port.status())
    if (before.state !== 'unlocked' || before.lockEpoch !== request.lockEpoch) continue
    const choices = vaultDecisionChoices(request)
    const title = vaultApprovalText(request)
    let decision: VaultApprovalAnswer['decision'] = 'deny'
    try {
      // No expiry of our own (owner 2026-10-16): the person's answer or
      // Stop ends the wait, never an invented kill.
      const answer = await deps.choose(title, choices, deps.signal)
      if (answer === 'allowOnce' || answer === 'allowSession')
        decision = choices.includes(answer) ? answer : 'deny'
    } catch {
      /* EOF and cancellation deny; no raw terminal diagnostic escapes. */
    }
    deps.signal.throwIfAborted()
    const current = vaultStatusSchema.parse(await port.status())
    if (current.state !== 'unlocked' || current.lockEpoch !== request.lockEpoch) continue
    vaultApprovalResultSchema.parse(
      await port.answer(
        vaultApprovalAnswerSchema.parse({
          requestId: request.id,
          digest: request.digest,
          decision,
        }),
      ),
    )
  }
}

/**
The source is already gone: finish the person's Delete by clearing the
leftover record instead of dropping it (RVCM1091G P3). A record already
cleared (or still stuck) leaves the caller's refusal below as it stands.
*/
export async function clearGoneImport(
  keepImport: (receipt: string) => Promise<void>,
  receipt: string,
): Promise<void> {
  try {
    await keepImport(receipt)
  } catch {
    /* The refusal below still holds: the file is gone. */
  }
}

/** All items or none; a per-item report of names only, then Keep or Delete the source. */
async function importFile(
  port: VaultCommandPort,
  deps: VaultCommandDeps,
  path: string,
): Promise<number> {
  const report = await port.importFile(path)
  deps.print(
    fill(UI_TEXT.vault.importedSummary, {
      names: report.items.map((item) => `${item.name} (${item.kind})`).join(', '),
    }),
  )
  if (!deps.isInteractive) return 0
  let answer = 'keep'
  try {
    answer = await deps.choose(UI_TEXT.vault.importKeepOrDelete, ['keep', 'delete'], deps.signal)
  } catch {
    /* EOF, timeout and cancellation keep the file. */
  }
  if (answer === 'delete') {
    try {
      await port.deleteImport(report.receipt)
    } catch (error: unknown) {
      if (error instanceof Error && error.message === UI_TEXT.vault.sourceGone)
        await clearGoneImport((receipt) => port.keepImport(receipt), report.receipt)
      throw error
    }
  } else await port.keepImport(report.receipt)
  return 0
}
/**
Finish kept or orphaned imports from the terminal: the same two real
actions the panel offers (RVAPP-CM1091D5 P2-2). Every "try again" refusal
names an action that exists here too: the receipt stays listed until it
is kept or its delete succeeds.
*/
async function finishReceipts(port: VaultCommandPort, deps: VaultCommandDeps): Promise<number> {
  const pending = await port.pendingReceipts()
  if (pending.length === 0) {
    deps.print(UI_TEXT.vault.noPendingImports)
    return 0
  }
  let code = 0
  for (const entry of pending) {
    deps.print(
      `${entry.path}: ${entry.items.map((item) => `${item.name} (${item.kind})`).join(', ')}`,
    )
    if (!deps.isInteractive) continue
    let answer = 'keep'
    try {
      answer = await deps.choose(UI_TEXT.vault.importKeepOrDelete, ['keep', 'delete'], deps.signal)
    } catch {
      /* EOF, timeout and cancellation keep the file. */
    }
    if (answer !== 'delete') {
      try {
        await port.keepImport(entry.receipt)
      } catch (error: unknown) {
        deps.printError(vaultCommandFailure(error))
        code = 1
      }
      continue
    }
    try {
      await port.deleteImport(entry.receipt)
    } catch (error: unknown) {
      if (error instanceof Error && error.message === UI_TEXT.vault.sourceGone)
        await clearGoneImport((receipt) => port.keepImport(receipt), entry.receipt)
      deps.printError(vaultCommandFailure(error))
      code = 1
    }
  }
  return code
}
/** Reset Vault: a lost vault only; the warning, Continue, then the typed word. */
async function resetVault(port: VaultCommandPort, deps: VaultCommandDeps): Promise<number> {
  if (!deps.isInteractive) {
    deps.printError(UI_TEXT.vault.resetHeadless)
    return 1
  }
  const challenge = await port.resetBegin()
  deps.printError(UI_TEXT.vault.resetWarning)
  if (challenge.writer) deps.printError(vaultWriterRecoveryMessage(challenge.writer))
  let answer = 'cancel'
  try {
    answer = await deps.choose(UI_TEXT.vault.resetVault, ['continue', 'cancel'], deps.signal)
  } catch {
    /* EOF, timeout and cancellation cancel the reset. */
  }
  if (answer !== 'continue') return 1
  const typed = await deps.readLine(
    `${fill(UI_TEXT.vault.resetTypeWord, { word: challenge.word })} `,
    deps.signal,
  )
  try {
    await port.resetConfirm(challenge.resetId, typed.toString('utf8'))
  } finally {
    typed.fill(0)
  }
  deps.printError(UI_TEXT.vault.resetDone)
  return 0
}
/** Shown once; the vault exists only after "I Saved It" (lead decision 8). */
async function setUpVault(port: VaultCommandPort, deps: VaultCommandDeps): Promise<number> {
  if (!deps.isInteractive) {
    deps.printError(UI_TEXT.vault.setupHeadless)
    return 1
  }
  const shown = await port.setup()
  try {
    deps.printError(UI_TEXT.vault.recoveryWarning)
    deps.print(fill(UI_TEXT.vault.recoveryShownOnce, { code: shown.code.toString('ascii') }))
    let answer = 'cancel'
    try {
      answer = await deps.choose(UI_TEXT.vault.savedItPrompt, ['savedIt', 'cancel'], deps.signal)
    } catch {
      /* EOF, timeout and cancellation cancel the setup. */
    }
    if (answer === 'savedIt') {
      await port.confirmSetup(shown.setupId)
      return 0
    }
    await port.cancelSetup(shown.setupId)
    deps.printError(UI_TEXT.vault.setupCancelled)
    return 1
  } finally {
    shown.code.fill(0)
  }
}

/**
A refused Delete (or any other refused management call) tells the true
reason on the terminal too: every named refusal keeps its own sentence,
and only an unnamed failure stays "No access" (RVAPP-CM1091D5 P2-3).
The client's own broker sentences keep theirs as well: a broker that
cannot start names its repair, and a switched-off build says so.
Exact match only: no foreign text can quote a full sentence.
*/
export function vaultCommandFailure(error: unknown): string {
  // Every named sentence, shared with the panel (RVAPP-CM1091D5 P2-3),
  // plus the client's own broker sentences, terminal-only.
  return error instanceof Error &&
    (error.message === UI_TEXT.vault.brokerBlocked ||
      error.message === UI_TEXT.vault.brokerDisabled ||
      vaultRefusalSentences().includes(error.message))
    ? error.message
    : UI_TEXT.vault.noAccess
}

export async function runVaultCommand(
  options: VaultCommandOptions,
  deps: VaultCommandDeps,
): Promise<number> {
  let port: VaultCommandPort | undefined
  let code = 0
  try {
    deps.signal.throwIfAborted()
    port = await deps.open()
    deps.signal.throwIfAborted()
    switch (options.command) {
      case 'status':
      case 'list':
      case 'lock':
      case 'audit': {
        deps.print(await vaultRead(port, options.command, false, options.filters))
        break
      }
      case 'unlock': {
        await port.unlock(options.slotId)
        break
      }
      case 'add': {
        deps.printError(UI_TEXT.vault.labelWarning)
        const material = await deps.readMaterial(deps.signal)
        try {
          deps.signal.throwIfAborted()
          await port.add(vaultItemSchema.parse({ metadata: options.metadata, material }))
        } finally {
          wipeVaultMaterial(material)
        }
        break
      }
      case 'remove': {
        await port.remove(options.itemId)
        break
      }
      case 'grant': {
        const grant = vaultGrantSchema.parse({ ...options.grant, createdBy: 'vaultCli' })
        const answer = await deps.choose(
          `${UI_TEXT.vault.grant}: ${JSON.stringify(grant)}`,
          ['allowOnce', 'deny'],
          deps.signal,
        )
        deps.signal.throwIfAborted()
        if (answer !== 'allowOnce') {
          code = 1
          break
        }
        await port.grant(grant)
        break
      }
      case 'revoke': {
        await port.revoke(options.grantId)
        break
      }
      case 'policy': {
        if (options.policy === undefined) {
          deps.print(JSON.stringify((await deps.policy.read()) ?? { ceilings: [] }))
          break
        }
        const answer = await deps.choose(
          `${UI_TEXT.vault.policyCeilings}: ${JSON.stringify(options.policy)}`,
          ['allowOnce', 'deny'],
          deps.signal,
        )
        deps.signal.throwIfAborted()
        if (answer !== 'allowOnce') {
          code = 1
          break
        }
        await deps.policy.write(options.policy)
        break
      }
      case 'import': {
        code = await importFile(port, deps, options.path)
        break
      }
      case 'receipts': {
        code = await finishReceipts(port, deps)
        break
      }
      case 'reset': {
        code = await resetVault(port, deps)
        break
      }
      case 'public-key': {
        const item = vaultItemMetadataSchema.parse(await port.publicKey(options.itemId))
        if (item.id !== options.itemId || item.kind !== 'sshKey' || item.publicKey === null)
          throw new Error(UI_TEXT.vault.noAccess)
        deps.print(item.publicKey)
        break
      }
      case 'watch': {
        await watch(port, deps)
        break
      }
      case 'setup': {
        code = await setUpVault(port, deps)
        break
      }
      case 'recover': {
        if (!deps.isInteractive) {
          deps.printError(UI_TEXT.vault.setupHeadless)
          code = 1
          break
        }
        const recovery = await deps.readLine(`${UI_TEXT.vault.recoveryCode}: `, deps.signal)
        try {
          deps.signal.throwIfAborted()
          await port.recover(recovery)
        } finally {
          recovery.fill(0)
        }
        break
      }
    }
  } catch (error: unknown) {
    // An open failure already carries its own sentence (the loader wraps
    // every one as brokerDisabled or brokerBlocked); keep it, and only an
    // unnamed open failure stays the broker repair sentence.
    const named = vaultCommandFailure(error)
    const didOpenFail = port === undefined && !deps.signal.aborted
    deps.printError(
      didOpenFail && named === UI_TEXT.vault.noAccess ? UI_TEXT.vault.brokerBlocked : named,
    )
    code = 1
  } finally {
    try {
      await port?.close()
    } catch {
      // A close that fails after the command still tells the terminal and fails the run.
      deps.printError(UI_TEXT.vault.noAccess)
      code = 1
    }
  }
  return code
}
