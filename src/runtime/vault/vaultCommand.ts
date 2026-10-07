import * as z from 'zod/mini'
import { parseArgs } from 'node:util'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
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
} from '../../shared/vaultProtocol'
import { vaultApprovalText, vaultDecisionChoices } from './vaultApproval'

const auditFilterSchema = z.strictObject({
  item: z.optional(vaultAuditRecordSchema.shape.handle),
  requester: z.optional(vaultAuditRecordSchema.shape.requester.shape.id),
  kind: z.optional(vaultAuditRecordSchema.shape.kind),
  outcome: z.optional(vaultAuditRecordSchema.shape.outcome),
})
type AuditFilter = z.infer<typeof auditFilterSchema>

export type VaultReadCommand = 'status' | 'list' | 'lock' | 'audit'
export type VaultCommandOptions =
  | { command: VaultReadCommand | 'watch'; filters?: AuditFilter }
  | { command: 'unlock'; slotId: string | null }
  | { command: 'add'; metadata: VaultItemMetadata }
  | { command: 'grant'; grant: VaultGrant }
  | { command: 'remove' | 'public-key'; itemId: string }
  | { command: 'revoke'; grantId: string }
  | { command: 'import'; path: string }

/** Trusted local management channel only. Private material never uses the panel/MHP port. */
export interface VaultCommandPort {
  status(): Promise<unknown>
  list(): Promise<unknown>
  lock(): Promise<void>
  audit(): Promise<unknown>
  unlock(slotId: string | null): Promise<void>
  add(item: VaultItem): Promise<void>
  remove(itemId: string): Promise<void>
  grant(grant: VaultGrant): Promise<void>
  revoke(grantId: string): Promise<void>
  importFile(path: string): Promise<void>
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
  now(): number
  signal: AbortSignal
}

export function vaultUsage(): string {
  return `${UI_TEXT.vault.title}: status | unlock [slot-id] | lock | list | add <metadata-json> | remove <item-id> | grant <grant-json> | revoke <grant-id> | audit [--item <handle>] [--requester <id>] [--kind <kind>] [--outcome <outcome>] | import <path> | public-key <item-id> | watch`
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
    const read = (['status', 'list', 'lock', 'watch'] as const).find(
      (candidate) => candidate === command,
    )
    if (argument === undefined && read !== undefined) return { command: read }
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
      const filter = auditFilterSchema.parse(filters)
      return JSON.stringify(
        records.filter(
          (record) =>
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
    if (
      before.state !== 'unlocked' ||
      before.lockEpoch !== request.lockEpoch ||
      deps.now() >= request.expiresAt
    )
      continue
    const choices = vaultDecisionChoices(request)
    const title = vaultApprovalText(request)
    let decision: VaultApprovalAnswer['decision'] = 'deny'
    try {
      const answer = await deps.choose(
        title,
        choices,
        AbortSignal.any([
          deps.signal,
          AbortSignal.timeout(Math.max(1, request.expiresAt - deps.now())),
        ]),
      )
      if (answer === 'allowOnce' || answer === 'allowSession')
        decision = choices.includes(answer) ? answer : 'deny'
    } catch {
      /* EOF, timeout and cancellation deny; no raw terminal diagnostic escapes. */
    }
    deps.signal.throwIfAborted()
    const current = vaultStatusSchema.parse(await port.status())
    if (
      current.state !== 'unlocked' ||
      current.lockEpoch !== request.lockEpoch ||
      deps.now() >= request.expiresAt
    )
      continue
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
      case 'import': {
        await port.importFile(options.path)
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
    }
  } catch {
    deps.printError(
      port === undefined && !deps.signal.aborted
        ? UI_TEXT.vault.brokerBlocked
        : UI_TEXT.vault.noAccess,
    )
    code = 1
  } finally {
    try {
      await port?.close()
    } catch {
      deps.printError(UI_TEXT.vault.noAccess)
      code = 1
    }
  }
  return code
}
