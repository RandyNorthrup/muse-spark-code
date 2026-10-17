// D88.9's terminal surface. The profile owner injects K's store and M95's
// metadata adapter; this module never invents a providers-file envelope.
import type { AccountStore, AccountsMetadataPort } from '../../core/providers/accounts'
import {
  AccountStoreError,
  accountBindingSchema,
} from '../../core/providers/accountCredentialRecord'
import { isStoreUnavailable } from '../keyStore'
import { isValidModelApiKey } from '../../host/auth/credentialStore'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { AuthCommandDeps } from '../authCommands'

import type { AccountTarget, AccountsCommand } from './accountArgs'
export { parseAccountsCommand, type AccountTarget, type AccountsCommand } from './accountArgs'

export interface AccountsCommandDeps {
  readonly accounts: AccountStore
  readonly metadata: AccountsMetadataPort
  readonly print: (text: string) => void
  readonly printError: (text: string) => void
  /**
   * Whether the provider is configured in the runner's own providers file.
   * The account service reads its own metadata rows: a configured provider
   * without a row needs its accounts provisioned, not another `providers
   * add`, so the advice differs. Absent, every unknown provider reads as
   * unconfigured, as before.
   */
  readonly isProviderConfigured?: (provider: string) => Promise<boolean>
}

async function commandError(
  deps: AccountsCommandDeps,
  provider: string,
  error: unknown,
): Promise<string> {
  if (isStoreUnavailable(error)) return UI_TEXT.acpStoreDown
  if (error instanceof AccountStoreError) {
    if (error.code === 'notOffered') return UI_TEXT.accounts.notOffered
    if (error.code === 'invalidAccount' || error.code === 'invalidCredential')
      return UI_TEXT.accounts.invalidAccount
    // A refused providers file is not a connection problem: the runtime is
    // already on the account service, and the file was left untouched.
    if (error.code === 'invalidProvidersFile') return UI_TEXT.accounts.providersInvalid
    // The terminal is the account service in this process: an unknown
    // provider is not configured, not waiting on a connection. A provider
    // the runner already added still has no account metadata here, so it
    // says its accounts are not served in this terminal yet instead of
    // repeating the add advice or claiming the runtime is unconnected.
    if (error.code === 'unavailable') {
      const template =
        (await deps.isProviderConfigured?.(provider)) === true
          ? UI_TEXT.accounts.providerUnavailable
          : UI_TEXT.providerNotConfigured
      return fill(template, { provider })
    }
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
    deps.printError(await commandError(deps, command.provider, error))
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
    deps.printError(await commandError(deps, target.provider, error))
    return 1
  } finally {
    pending.value = ''
  }
}
