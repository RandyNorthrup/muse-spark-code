import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpAccounts } from '../../src/acp/accounts'
import { accountErrorText, AccountSwitchRefusedError } from '../../src/acp/accountText'
import { AccountStoreError } from '../../src/core/providers/accountCredentialRecord'
import { commandError } from '../../src/runtime/providers/accountsCommand'
import { fileAccountsMetadata } from '../../src/runtime/providers/providersFileStore'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { UI_TEXT } from '../../src/shared/constants'

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

  it('unwraps a wrapper to its cause instead of the connection sentence', () => {
    const text = accountErrorText(
      new Error(CONNECTION, {
        cause: new Error('EISDIR: illegal operation on a directory, read'),
      }),
    )
    expect(text).toBe('Accounts are unavailable (EISDIR: illegal operation on a directory, read).')
  })

  it('names a real unreadable providers file instead of the connection sentence', async () => {
    const folder = await scratch()
    await mkdir(path.join(folder, 'providers.json'))
    // The metadata read throws synchronously, so await alone never sees it.
    let failure: unknown
    try {
      await fileAccountsMetadata(folder).read('meta')
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AccountStoreError)
    // The refresh wrapper keeps the refusal; the mapper reports its cause.
    const text = accountErrorText(new Error(CONNECTION, { cause: failure }))
    expect(text).not.toBe(CONNECTION)
    expect(text.startsWith('Accounts are unavailable (')).toBe(true)
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
    const folder = await scratch()
    await mkdir(path.join(folder, 'providers.json'))
    let failure: unknown
    try {
      await fileAccountsMetadata(folder).read('meta')
    } catch (error: unknown) {
      failure = error
    }
    const text = commandError(failure)
    expect(text).not.toBe(CONNECTION)
    expect(text.startsWith('Accounts are unavailable (')).toBe(true)
  })

  it('says no account is selected when the session account is gone', async () => {
    const folder = await scratch()
    const services = createRuntimeAccountServices({
      dataDir: folder,
      openEntry: () => {
        throw new Error('the account read path never touches the credential store')
      },
    })
    try {
      const accounts = new AcpAccounts(
        'session-1',
        services.sessions('meta', 'ghost'),
        () => {
          // The assertions below observe the thrown sentences, not the change callback.
        },
        () => {
          // No notice is expected on these paths.
        },
      )
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
    const services = createRuntimeAccountServices({
      dataDir: folder,
      openEntry: () => {
        throw new Error('the account read path never touches the credential store')
      },
    })
    try {
      const accounts = new AcpAccounts(
        'session-1',
        services.sessions('meta'),
        () => {
          // The assertions below observe the thrown sentences, not the change callback.
        },
        () => {
          // No notice is expected on these paths.
        },
      )
      await expect(accounts.use('default', () => true)).rejects.toThrow(UI_TEXT.accounts.notReady)
      await expect(accounts.command('/accounts list', () => true)).rejects.toThrow(
        UI_TEXT.accounts.notReady,
      )
    } finally {
      services.dispose()
    }
  })
})
