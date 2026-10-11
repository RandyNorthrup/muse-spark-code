// D88.9's terminal surface. The profile owner injects K's store and M95's
// metadata adapter; this module never invents a providers-file envelope.
import type { AccountStore, AccountsMetadataPort } from '../../core/providers/accounts'
import {
  AccountStoreError,
  accountBindingSchema,
} from '../../core/providers/accountCredentialRecord'
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
