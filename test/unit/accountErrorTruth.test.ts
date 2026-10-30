import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpAccounts, type AccountsSessionPort } from '../../src/acp/accounts'
import {
  accountErrorText,
  AccountSwitchRefusedError,
  isRevokeUnsupportedError,
} from '../../src/acp/accountText'
import { AccountStoreError } from '../../src/core/providers/accountCredentialRecord'
import {
  commandError,
  runAccountAuthSet,
  runAccountsCommand,
} from '../../src/runtime/providers/accountsCommand'
import { fileAccountsMetadata } from '../../src/runtime/providers/providersFileStore'
import {
  createRuntimeAccountServices,
  runtimeRevokeSignIn,
  type RuntimeAccountServices,
} from '../../src/runtime/providers/runtimeServices'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const CONNECTION = UI_TEXT.accounts.unavailable

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function scratch(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'truthaccounts-'))
  folders.push(folder)
  return folder
}

/** A real unreadable providers file: a directory where providers.json
belongs, so the metadata read fails through real filesystem I/O. */
async function unreadableProvidersFailure(): Promise<unknown> {
  const folder = await scratch()
  await mkdir(path.join(folder, 'providers.json'))
  try {
    await fileAccountsMetadata(folder).read('meta')
  } catch (error: unknown) {
    return error
  }
  throw new Error('the providers read unexpectedly succeeded')
}

/** Runtime account services over a scratch dir whose credential store stays
shut: opening it throws, so these tests prove the read path never
touches it. */
function offlineServices(folder: string): RuntimeAccountServices {
  return createRuntimeAccountServices({
    dataDir: folder,
    openEntry: () => {
      throw new Error('the account read path never touches the credential store')
    },
  })
}

/** A session over the given port whose change and notice callbacks stay
silent: the assertions below observe the thrown sentences, not them. */
function silentAccounts(port: AccountsSessionPort): AcpAccounts {
  return new AcpAccounts(
    'session-1',
    port,
    () => {
      // No change is expected on these paths.
    },
    () => {
      // No notice is expected on these paths.
    },
  )
}

describe('account errors name their cause', () => {
  it('repeats a refused switch verbatim', () => {
    const refused = new AccountSwitchRefusedError('meta', 'Work')
    expect(accountErrorText(refused)).toBe(refused.message)
    expect(accountErrorText(refused)).not.toBe(CONNECTION)
  })

  it('names a refused providers file', () => {
    expect(accountErrorText(new AccountStoreError('invalidProvidersFile'))).toBe(
      UI_TEXT.accounts.providersInvalid,
    )
  })

  it('keeps bad ids and credentials on the invalid-account sentence', () => {
    expect(accountErrorText(new Error(UI_TEXT.accounts.invalidAccount))).toBe(
      UI_TEXT.accounts.invalidAccount,
    )
    expect(accountErrorText(new AccountStoreError('invalidCredential'))).toBe(
      UI_TEXT.accounts.invalidAccount,
    )
  })

  it('passes through sentences the account layer threw', () => {
    for (const sentence of [
      UI_TEXT.accounts.none,
      UI_TEXT.accounts.changed,
      UI_TEXT.accounts.notReady,
      UI_TEXT.accounts.invalidReply,
    ])
      expect(accountErrorText(new Error(sentence))).toBe(sentence)
  })

  it('keeps a real disk failure behind the fixed unavailable sentence', async () => {
    const failure = await unreadableProvidersFailure()
    expect(failure).toBeInstanceOf(AccountStoreError)
    const cause = failure instanceof AccountStoreError ? failure.cause : undefined
    expect(cause).toBeInstanceOf(Error)
    // Directly and through the refresh wrapper alike, the mapper reports
    // the fixed sentence: the raw disk text never crosses the ACP boundary.
    for (const error of [failure, new Error(CONNECTION, { cause: failure })]) {
      const text = accountErrorText(error)
      expect(text).toBe(CONNECTION)
      if (cause instanceof Error && cause.message !== '')
        expect(text.includes(cause.message)).toBe(false)
    }
  })

  it('names a real malformed providers file as refused', async () => {
    const folder = await scratch()
    await writeFile(path.join(folder, 'providers.json'), '{oops')
    let failure: unknown
    try {
      await fileAccountsMetadata(folder).read('meta')
    } catch (error: unknown) {
      failure = error
    }
    expect(accountErrorText(failure)).toBe(UI_TEXT.accounts.providersInvalid)
  })

  it('leaves a refusal without detail on plain unavailable rather than inventing a cause', () => {
    expect(accountErrorText(new AccountStoreError('originMismatch'))).toBe(CONNECTION)
  })

  it('tells the terminal the real failure', async () => {
    expect(commandError(new AccountStoreError('invalidProvidersFile'))).toBe(
      UI_TEXT.accounts.providersInvalid,
    )
    expect(commandError(new AccountStoreError('invalidAccount'))).toBe(
      UI_TEXT.accounts.invalidAccount,
    )
    // A refusal that kept no concrete cause stays on the plain sentence
    // instead of printing its code word.
    expect(commandError(new AccountStoreError('unavailable'))).toBe(CONNECTION)
    expect(commandError(new AccountStoreError('originMismatch'))).toBe(CONNECTION)
    const failure = await unreadableProvidersFailure()
    const text = commandError(failure)
    expect(text).not.toBe(CONNECTION)
    expect(text.startsWith('Accounts are unavailable (')).toBe(true)
  })

  it('names a missing accounts entry on the terminal, never the connection (RLTESTDRIVE2 15)', async () => {
    const folder = await scratch()
    const services = offlineServices(folder)
    try {
      // The service binding is intact: meta's built-in entry still lists.
      const lines: string[] = []
      const metaExit = await runAccountsCommand(
        { action: 'list', provider: 'meta' },
        {
          accounts: services.store,
          metadata: services.metadata,
          placements: services.placements,
          print: (line) => {
            lines.push(line)
          },
          printError: () => undefined,
        },
      )
      expect(metaExit).toBe(0)
      expect(JSON.parse(lines[0] ?? '')).toEqual([
        { id: 'default', label: UI_TEXT.accounts.defaultLabel, order: 0, thresholds: {} },
      ])
      // A provider with no accounts entry names the missing row: the
      // runtime is on the account service, so the connection sentence
      // would lie.
      const errors: string[] = []
      const exit = await runAccountsCommand(
        { action: 'list', provider: 'testprov' },
        {
          accounts: services.store,
          metadata: services.metadata,
          placements: services.placements,
          print: () => undefined,
          printError: (line) => {
            errors.push(line)
          },
        },
      )
      expect(exit).toBe(1)
      expect(errors).toEqual([
        fill(UI_TEXT.accounts.unavailableReason, {
          reason: fill(UI_TEXT.accounts.noAccountsEntry, { provider: 'testprov' }),
        }),
      ])
      // ACP keeps its fixed sentence for the same refusal (FIXM108H): the
      // cause never crosses that boundary.
      let failure: unknown
      try {
        await services.store.list('testprov')
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(AccountStoreError)
      expect(accountErrorText(failure)).toBe(CONNECTION)
      const cause = failure instanceof AccountStoreError ? failure.cause : undefined
      if (cause instanceof Error && cause.message !== '')
        expect(accountErrorText(failure).includes(cause.message)).toBe(false)
    } finally {
      services.dispose()
    }
  })

  it('keeps the unsupported-revocation refusal on its own sentence', async () => {
    let refusal: unknown
    try {
      await runtimeRevokeSignIn()
    } catch (error: unknown) {
      refusal = error
    }
    // The refusal is branded, not a generic store outage, so the remove
    // boundary preserves it and both mappers repeat its own sentence.
    expect(isRevokeUnsupportedError(refusal)).toBe(true)
    expect(refusal).not.toBeInstanceOf(AccountStoreError)
    expect(commandError(refusal)).toBe(UI_TEXT.accounts.revokeUnsupported)
    expect(accountErrorText(refusal)).toBe(UI_TEXT.accounts.revokeUnsupported)
  })

  it('says no account is selected when the session account is gone', async () => {
    const folder = await scratch()
    const services = offlineServices(folder)
    try {
      const accounts = silentAccounts(services.sessions('meta', 'ghost'))
      await accounts.start()
      await expect(accounts.command('/accounts current', () => true)).rejects.toThrow(
        UI_TEXT.accounts.none,
      )
      await expect(accounts.use('ghost', () => true)).rejects.toThrow(
        UI_TEXT.accounts.invalidAccount,
      )
    } finally {
      services.dispose()
    }
  })

  it('says not ready before the session is adopted', async () => {
    const folder = await scratch()
    const services = offlineServices(folder)
    try {
      const accounts = silentAccounts(services.sessions('meta'))
      await expect(accounts.use('default', () => true)).rejects.toThrow(UI_TEXT.accounts.notReady)
      await expect(accounts.command('/accounts list', () => true)).rejects.toThrow(
        UI_TEXT.accounts.notReady,
      )
    } finally {
      services.dispose()
    }
  })

  it('names the unknown provider id instead of reporting a connection problem', async () => {
    const folder = await scratch()
    const services = offlineServices(folder)
    try {
      const lines: string[] = []
      const errors: string[] = []
      const deps = {
        ...services.commands,
        print: (line: string) => {
          lines.push(line)
        },
        printError: (line: string) => {
          errors.push(line)
        },
      }
      // The merged store names the missing entry (RLTESTDRIVE2 15): the
      // refusal carries the id by name, never the connection sentence.
      const expected = fill(UI_TEXT.accounts.unavailableReason, {
        reason: fill(UI_TEXT.accounts.noAccountsEntry, { provider: 'anthropic-s2' }),
      })
      const exit = await runAccountsCommand({ action: 'list', provider: 'anthropic-s2' }, deps)
      expect(exit).toBe(1)
      expect(lines).toEqual([])
      expect(errors).toEqual([expected])
      const secondExit = await runAccountsCommand(
        {
          action: 'add',
          provider: 'anthropic-s2',
          account: { id: 's2', label: 'S2', order: 0, thresholds: {} },
        },
        deps,
      )
      expect(secondExit).toBe(1)
      expect(errors).toEqual([expected, expected])
    } finally {
      services.dispose()
    }
  })

  it('lists the built-in Meta entry with no providers file', async () => {
    const folder = await scratch()
    const services = offlineServices(folder)
    try {
      const lines: string[] = []
      const errors: string[] = []
      const exit = await runAccountsCommand(
        { action: 'list', provider: 'meta' },
        {
          ...services.commands,
          print: (line: string) => {
            lines.push(line)
          },
          printError: (line: string) => {
            errors.push(line)
          },
        },
      )
      expect(exit).toBe(0)
      expect(errors).toEqual([])
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0] ?? '[]')).toEqual([
        { id: 'default', label: UI_TEXT.accounts.defaultLabel, order: 0, thresholds: {} },
      ])
    } finally {
      services.dispose()
    }
  })

  it('refuses auth set for an unknown provider before prompting for a key', async () => {
    const folder = await scratch()
    const services = offlineServices(folder)
    try {
      const errors: string[] = []
      const exit = await runAccountAuthSet(
        { provider: 'anthropic-s2', account: 'default' },
        {
          ...services.commands,
          print: () => {
            throw new Error('no success line is expected')
          },
          printError: (line: string) => {
            errors.push(line)
          },
          readSecret: () => Promise.reject(new Error('must not prompt for a key')),
          storeName: 'test-store',
          confirmKeyUse: () => Promise.resolve(false),
        },
      )
      expect(exit).toBe(1)
      expect(errors).toEqual(['Unknown provider: anthropic-s2.'])
    } finally {
      services.dispose()
    }
  })
})
