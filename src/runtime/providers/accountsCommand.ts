// D88.9's terminal surface. The profile owner injects K's store and M95's
// metadata adapter; this module never invents a providers-file envelope.
import type {
  AccountProvider,
  AccountStore,
  AccountsMetadataPort,
} from '../../core/providers/accounts'
import {
  AccountStoreError,
  accountBindingSchema,
} from '../../core/providers/accountCredentialRecord'
import { isRevokeUnsupportedError } from '../../acp/accountText'
import { isValidModelApiKey } from '../../host/auth/credentialStore'
import { inspectProviderKey, providerKeyNoticeText } from '../../core/providers/keyInspection'
import { UI_TEXT } from '../../shared/constants'
import { fill, setUiText, uiLocale } from '../../shared/l10n/text'
import type { AuthCommandDeps } from '../authCommands'
import { providerKeyFailureText } from '../exec/keyInput'
import { isNonTextStdin } from '../hiddenInput'

import type { AccountTarget, AccountsCommand } from './accountArgs'
export { parseAccountsCommand, type AccountTarget, type AccountsCommand } from './accountArgs'

export interface AccountsCommandDeps {
  readonly accounts: AccountStore
  readonly metadata: AccountsMetadataPort
  readonly print: (text: string) => void
  readonly printError: (text: string) => void
}

export function commandError(error: unknown): string {
  // A refused revocation names its refusal: removing the sign-in never ran.
  if (isRevokeUnsupportedError(error)) return UI_TEXT.accounts.revokeUnsupported
  if (error instanceof AccountStoreError) {
    if (error.code === 'notOffered') return UI_TEXT.accounts.notOffered
    if (error.code === 'invalidAccount' || error.code === 'invalidCredential')
      return UI_TEXT.accounts.invalidAccount
    // A refused providers file is not a connection problem: the runtime is
    // already on the account service, and the file was left untouched.
    if (error.code === 'invalidProvidersFile') return UI_TEXT.accounts.providersInvalid
    // Every other store refusal names the concrete cause it kept: an
    // unreadable providers file keeps its disk failure. A refusal that
    // kept none stays on the plain unavailable sentence instead of
    // printing its code word. The terminal runs on the account service,
    // so the connection sentence would lie.
    return error.cause instanceof Error && error.cause.message !== ''
      ? fill(UI_TEXT.accounts.unavailableReason, { reason: error.cause.message })
      : UI_TEXT.accounts.unavailable
  }
  // A credential-store or disk failure names itself for the same reason.
  return error instanceof Error && error.message !== ''
    ? fill(UI_TEXT.accounts.unavailableReason, { reason: error.message })
    : UI_TEXT.accounts.unavailable
}

/** A causeless store outage against a missing entry is an unknown id,
not a connection problem: the runtime is already on the account
service, so the refusal names the id instead of the connection. An
entry that exists keeps the generic sentence (a lane-M product, a shut
vault): the id is not the problem there. */
function terminalAccountsFailure(
  provider: string,
  read: { readonly entry: AccountProvider | undefined } | undefined,
  error: unknown,
): string {
  return read !== undefined &&
    read.entry?.id !== provider &&
    error instanceof AccountStoreError &&
    error.code === 'unavailable'
    ? fill(UI_TEXT.providerUnknown, { provider })
    : commandError(error)
}

/** Prints a failed accounts command as its cause names it; the exit code for it. */
function accountsFailed(
  deps: Pick<AccountsCommandDeps, 'printError'>,
  provider: string,
  read: { readonly entry: AccountProvider | undefined } | undefined,
  error: unknown,
): number {
  deps.printError(terminalAccountsFailure(provider, read, error))
  return 1
}

export async function runAccountsCommand(
  command: AccountsCommand,
  deps: AccountsCommandDeps,
): Promise<number> {
  let read: { readonly entry: AccountProvider | undefined } | undefined
  try {
    const { provider } = command
    read = { entry: await deps.metadata.read(provider) }
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
    return accountsFailed(deps, command.provider, read, error)
  }
}

/** Only the terminal's hidden stdin reader supplies a secret. No environment,
argument, file or child-process port exists in this flow. */
export async function runAccountAuthSet(
  target: AccountTarget,
  deps: AccountsCommandDeps & Pick<AuthCommandDeps, 'readSecret' | 'storeName' | 'confirmKeyUse'>,
): Promise<number> {
  const pending = { value: '' }
  let read: { readonly entry: AccountProvider | undefined } | undefined
  try {
    read = { entry: await deps.metadata.read(target.provider) }
    const provider = read.entry
    if (provider?.id !== target.provider) throw new AccountStoreError('unavailable')
    if (provider.auth !== 'apiKey') throw new AccountStoreError('notOffered')
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
    // Any non-blank key is stored for the provider to judge, never its
    // shape (PLAN.md D123). A value that looks like the wrong thing is
    // named first: a pipe cannot answer, so the run continues to the
    // store; a "no" on a terminal asks for the key again, like the
    // panel's password box. The notice reads UI_TEXT at call time:
    // install this command's table before formatting it.
    setUiText(UI_TEXT, uiLocale())
    for (;;) {
      try {
        pending.value = await deps.readSecret(prompt)
      } catch (error: unknown) {
        if (isNonTextStdin(error)) {
          deps.printError(providerKeyFailureText('invalid'))
          return 1
        }
        throw error
      }
      pending.value = pending.value.trim()
      if (
        pending.value === '' ||
        (target.provider === 'meta' && !isValidModelApiKey(pending.value))
      )
        throw new AccountStoreError('invalidCredential')
      if (target.provider === 'meta') break
      const inspection = inspectProviderKey(pending.value)
      if (
        inspection === 'ok' ||
        inspection === 'empty' ||
        (await deps.confirmKeyUse(providerKeyNoticeText(inspection)))
      ) {
        break
      }
    }
    await deps.accounts.setCredential(target.provider, target.account, {
      ...binding,
      v: 1,
      auth: 'apiKey',
      secret: pending.value,
    })
    deps.print(fill(UI_TEXT.acpKeyStored, { store: deps.storeName }))
    return 0
  } catch (error: unknown) {
    return accountsFailed(deps, target.provider, read, error)
  } finally {
    pending.value = ''
  }
}
