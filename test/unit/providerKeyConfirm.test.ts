// A provider key that looks like the wrong thing needs an answer (PLAN.md
// D123): the use-it-anyway question waits for it on a terminal, and a "no"
// asks for the key again, like the panel's password box. A pipe names the
// value and continues instead (proven through the packed product). Real
// command code with values passed in as data; a store or vault the run must
// not reach refuses the call, so reaching it fails the test.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import { AccountStore } from '../../src/core/providers/accounts'
import type { AccountCredentialVault } from '../../src/core/providers/accountCredentialRecord'
import { emptyProvidersFile, type ProvidersFileRead } from '../../src/core/providers/providersFile'
import { presetById } from '../../src/core/providers/presets'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { authSetProvider, type AuthCommandDeps } from '../../src/runtime/authCommands'
import { providerKeyFailureText } from '../../src/runtime/exec/keyInput'
import {
  fileAccountsMetadata,
  runtimeProvidersFile,
} from '../../src/runtime/providers/providersFileStore'
import { runAccountAuthSet } from '../../src/runtime/providers/accountsCommand'

const URL_KEY = 'https://not-a-key.example/v1'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

/** A secret store the run must not reach quietly: any call fails the test. */
function refusingSecrets(reason: string): SecretStore {
  const refuse = (): Promise<never> => Promise.reject(new Error(reason))
  return { get: refuse, store: refuse, delete: refuse }
}

function refuseVaultCall(): Promise<never> {
  return Promise.reject(new Error('provider-key-confirm test performs no vault call'))
}

/** A credential vault the run must not reach quietly: any call fails the test. */
function refusingVault(): AccountCredentialVault {
  return {
    read: refuseVaultCall,
    readForRemoval: refuseVaultCall,
    write: refuseVaultCall,
    remove: refuseVaultCall,
  }
}

function readSecretFor(values: readonly string[]): {
  readonly readSecret: (prompt: string) => Promise<string>
  readonly calls: string[]
} {
  const calls: string[] = []
  const remaining = [...values]
  return {
    calls,
    readSecret: (prompt: string) => {
      calls.push(prompt)
      const next = remaining.shift()
      if (next === undefined)
        throw new Error('provider-key-confirm test read more secrets than supplied')
      return Promise.resolve(next)
    },
  }
}

function confirmWith(answers: readonly boolean[]): {
  readonly confirmKeyUse: (message: string) => Promise<boolean>
  readonly calls: string[]
} {
  const calls: string[] = []
  const remaining = [...answers]
  return {
    calls,
    confirmKeyUse: (message: string) => {
      calls.push(message)
      const next = remaining.shift()
      if (next === undefined)
        throw new Error('provider-key-confirm test answered more questions than supplied')
      return Promise.resolve(next)
    },
  }
}

function printed(): { readonly print: (line: string) => void; readonly lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    print: (line: string) => {
      lines.push(line)
    },
  }
}

describe('auth set --provider confirmation', () => {
  it('asks for the key again on "no" and never stores the declined value', async () => {
    const secrets = readSecretFor([URL_KEY, ''])
    const confirm = confirmWith([false])
    const out = printed()
    const errors = printed()
    const exit = await authSetProvider(
      {
        secrets: refusingSecrets('provider-key-confirm test stores no declined key'),
        storeName: 'test store',
        readSecret: secrets.readSecret,
        confirmKeyUse: confirm.confirmKeyUse,
        print: out.print,
        printError: errors.print,
      } satisfies AuthCommandDeps,
      'groq',
      () => Promise.resolve<ProvidersFileRead>({ ok: true, file: emptyProvidersFile() }),
    )
    expect(exit).toBe(1)
    expect(secrets.calls.length).toBe(2)
    expect(confirm.calls.length).toBe(1)
    expect(confirm.calls[0]).toMatch(/use it anyway\?/i)
    expect(errors.lines).toEqual([providerKeyFailureText('empty')])
    expect(out.lines).toEqual([])
  })

  it('continues a confirmed suspicious key to the store for the provider to judge', async () => {
    const secrets = readSecretFor([URL_KEY])
    const confirm = confirmWith([true])
    const out = printed()
    const errors = printed()
    const exit = await authSetProvider(
      {
        secrets: refusingSecrets('test store refused'),
        storeName: 'test store',
        readSecret: secrets.readSecret,
        confirmKeyUse: confirm.confirmKeyUse,
        print: out.print,
        printError: errors.print,
      } satisfies AuthCommandDeps,
      'groq',
      () => Promise.resolve<ProvidersFileRead>({ ok: true, file: emptyProvidersFile() }),
    )
    expect(exit).toBe(1)
    expect(secrets.calls.length).toBe(1)
    expect(confirm.calls.length).toBe(1)
    expect(confirm.calls[0]).toMatch(/use it anyway\?/i)
    expect(errors.lines).toEqual([
      fill(UI_TEXT.acpStoreUnavailable, { reason: 'test store refused' }),
    ])
    expect(out.lines).toEqual([])
  })
})

async function openaiWorkFolder(): Promise<string> {
  // Every row field comes from a production table: the preset's own
  // origin and auth, the account policy's offered pooling. No product
  // path onboards such a row on a headless runtime yet, so the test
  // stages the file the account service would hold once one does.
  const preset = presetById('openai')
  const origin = preset?.origin.kind === 'fixed' ? preset.origin.origin : undefined
  if (origin === undefined || preset?.auth !== 'apiKey')
    throw new Error('openai preset unsuitable for the per-account drill')
  const policy = accountPolicyFor('openai', 'api')
  if (policy?.pooling === 'notOffered' || !policy?.isCredentialHeld)
    throw new Error('openai/api pooling is not offered')
  await mkdir('temp', { recursive: true })
  const folder = await mkdtemp(path.join('temp', 'provider-key-confirm-'))
  folders.push(folder)
  await writeFile(
    runtimeProvidersFile(folder),
    JSON.stringify({
      providers: {
        openai: {
          id: 'openai',
          policyProvider: 'openai',
          product: 'api',
          auth: 'apiKey',
          origin,
          accounts: [{ id: 'work', label: 'Work', order: 0, thresholds: {} }],
        },
      },
    }),
  )
  return folder
}

describe('per-account auth confirmation', () => {
  it('asks for the key again on "no" and never stores the declined value', async () => {
    const folder = await openaiWorkFolder()
    const metadata = fileAccountsMetadata(folder)
    const secrets = readSecretFor([URL_KEY, ''])
    const confirm = confirmWith([false])
    const out = printed()
    const errors = printed()
    const exit = await runAccountAuthSet(
      { provider: 'openai', account: 'work' },
      {
        accounts: new AccountStore(metadata, refusingVault()),
        metadata,
        readSecret: secrets.readSecret,
        confirmKeyUse: confirm.confirmKeyUse,
        storeName: 'test store',
        print: out.print,
        printError: errors.print,
      },
    )
    expect(exit).toBe(1)
    expect(secrets.calls.length).toBe(2)
    expect(confirm.calls.length).toBe(1)
    expect(confirm.calls[0]).toMatch(/use it anyway\?/i)
    expect(errors.lines).toEqual([UI_TEXT.accounts.invalidAccount])
    expect(out.lines).toEqual([])
  })

  it('continues a confirmed suspicious per-account key to the store', async () => {
    const folder = await openaiWorkFolder()
    const metadata = fileAccountsMetadata(folder)
    const secrets = readSecretFor([URL_KEY])
    const confirm = confirmWith([true])
    const out = printed()
    const errors = printed()
    const exit = await runAccountAuthSet(
      { provider: 'openai', account: 'work' },
      {
        accounts: new AccountStore(metadata, refusingVault()),
        metadata,
        readSecret: secrets.readSecret,
        confirmKeyUse: confirm.confirmKeyUse,
        storeName: 'test store',
        print: out.print,
        printError: errors.print,
      },
    )
    expect(exit).toBe(1)
    expect(secrets.calls.length).toBe(1)
    expect(confirm.calls.length).toBe(1)
    // A store refusal names its cause (merged accounts command): the vault
    // the run must not reach says why it refused.
    expect(errors.lines).toEqual([
      fill(UI_TEXT.accounts.unavailableReason, {
        reason: 'provider-key-confirm test performs no vault call',
      }),
    ])
    expect(out.lines).toEqual([])
  })
})
