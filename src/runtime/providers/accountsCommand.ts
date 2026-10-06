// D88.9's terminal surface. The profile owner injects K's store and M95's
// metadata adapter; this module never invents a providers-file envelope.
import { parseArgs } from 'node:util'
import type { AccountStore, AccountsMetadataPort } from '../../core/providers/accounts'
import { AccountStoreError, accountBindingSchema } from '../../core/providers/credentialRecord'
import { isValidModelApiKey } from '../../host/auth/credentialStore'
import {
  accountIdSchema,
  accountSchema,
  accountThresholdsSchema,
  type Account,
  type AccountThresholds,
} from '../../shared/accounts'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { AuthCommandDeps } from '../authCommands'

export interface AccountTarget {
  readonly provider: string
  readonly account: string
}
export type AccountsCommand =
  | { readonly action: 'list'; readonly provider: string }
  | { readonly action: 'add'; readonly provider: string; readonly account: Account }
  | { readonly action: 'remove'; readonly provider: string; readonly account: string }
  | { readonly action: 'order'; readonly provider: string; readonly accounts: readonly string[] }
  | {
      readonly action: 'thresholds'
      readonly provider: string
      readonly account: string
      readonly thresholds: AccountThresholds
    }

export function parseAccountsCommand(argv: readonly string[]): AccountsCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        provider: { type: 'string' },
        account: { type: 'string' },
        label: { type: 'string' },
        'limit-group': { type: 'string' },
        thresholds: { type: 'string' },
      },
    })
    const provider = accountIdSchema.parse(values.provider)
    const [action, ...ids] = positionals
    let allowed = ['provider']
    switch (action) {
      case 'add': {
        allowed = ['provider', 'account', 'label', 'limit-group']
        break
      }
      case 'thresholds': {
        allowed = ['provider', 'account', 'thresholds']
        break
      }
      case 'remove': {
        allowed = ['provider', 'account']
        break
      }
      default: {
        break
      }
    }
    if (Object.keys(values).some((key) => !allowed.includes(key))) return
    if (action === 'order')
      return { action, provider, accounts: ids.map((id) => accountIdSchema.parse(id)) }
    if (ids.length > 0) return
    if (action === 'list') return { action, provider }
    const account = accountIdSchema.parse(values.account)
    if (action === 'remove') return { action, provider, account }
    if (action === 'thresholds') {
      const data: unknown = JSON.parse(values.thresholds ?? '')
      return { action, provider, account, thresholds: accountThresholdsSchema.parse(data) }
    }
    if (action === 'add')
      return {
        action,
        provider,
        account: accountSchema.parse({
          id: account,
          label: values.label,
          order: 0,
          thresholds: {},
          ...(values['limit-group'] !== undefined && { limitGroup: values['limit-group'] }),
        }),
      }
    return
  } catch {
    return
  }
}

export interface AccountsCommandDeps {
  readonly accounts: AccountStore
  readonly metadata: AccountsMetadataPort
  readonly print: (text: string) => void
  readonly printError: (text: string) => void
}

function commandError(error: unknown): string {
  if (error instanceof AccountStoreError) {
    if (error.code === 'notOffered') return UI_TEXT.accounts.notOffered
    if (error.code === 'invalidAccount' || error.code === 'invalidCredential')
      return UI_TEXT.accounts.invalidAccount
  }
  return UI_TEXT.accounts.unavailable
}

export async function runAccountsCommand(
  command: AccountsCommand,
  deps: AccountsCommandDeps,
): Promise<number> {
  try {
    const { provider } = command
    switch (command.action) {
      case 'list': {
        deps.print(JSON.stringify(await deps.accounts.list(provider)))
        break
      }
      case 'add': {
        const rows = await deps.accounts.list(provider)
        let order = 0

        for (const row of rows) {
          order = Math.max(order, row.order + 1)
        }
        await deps.accounts.add(provider, { ...command.account, order })
        break
      }
      case 'remove': {
        await deps.accounts.remove(provider, command.account)
        break
      }
      case 'order': {
        await deps.accounts.order(provider, command.accounts)
        break
      }
      case 'thresholds': {
        await deps.accounts.thresholds(provider, command.account, command.thresholds)
        break
      }
    }
    return 0
  } catch (error: unknown) {
    deps.printError(commandError(error))
    return 1
  }
}

/** Only the terminal's hidden stdin reader supplies a secret. No environment,
 * argument, file or child-process port exists in this flow. */
export async function runAccountAuthSet(
  target: AccountTarget,
  deps: AccountsCommandDeps & Pick<AuthCommandDeps, 'readSecret' | 'storeName'>,
): Promise<number> {
  const pending = { value: '' }
  try {
    const provider = await deps.metadata.read(target.provider)
    if (provider?.auth !== 'apiKey') throw new AccountStoreError('notOffered')
    const binding = accountBindingSchema.parse({
      provider: target.provider,
      account: target.account,
      origin: provider.origin,
    })
    const rows = await deps.accounts.list(target.provider)
    if (rows.every((row) => row.id !== target.account))
      throw new AccountStoreError('invalidAccount')
    const prompt =
      target.provider === 'meta'
        ? UI_TEXT.acpKeyPrompt
        : fill(UI_TEXT.accounts.keyPrompt, { provider: target.provider, account: target.account })
    pending.value = await deps.readSecret(prompt)
    pending.value = pending.value.trim()
    if (pending.value === '' || (target.provider === 'meta' && !isValidModelApiKey(pending.value)))
      throw new AccountStoreError('invalidCredential')
    await deps.accounts.setCredential(target.provider, target.account, {
      ...binding,
      v: 1,
      auth: 'apiKey',
      secret: pending.value,
    })
    deps.print(fill(UI_TEXT.acpKeyStored, { store: deps.storeName }))
    return 0
  } catch (error: unknown) {
    deps.printError(commandError(error))
    return 1
  } finally {
    pending.value = ''
  }
}
