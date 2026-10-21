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

/** One secret reader, one key-use question and the two printers every drill wires. */
function confirmDoubles(values: readonly string[], answers: readonly boolean[]) {
  return {
    secrets: readSecretFor(values),
    confirm: confirmWith(answers),
    out: printed(),
    errors: printed(),
  }
}

type ConfirmDoubles = ReturnType<typeof confirmDoubles>

/**
Both confirmation drills end the same way: the exit, one use-it-anyway
question, the refusing store's error and no standard output. A declined
key is asked for again first, so it reads two secrets; a confirmed key
reads one and reaches the store.
*/
function expectConfirmOutcome(
  exit: number,
  doubles: ConfirmDoubles,
  secretReads: number,
  expectedErrors: readonly string[],
): void {
  expect(exit).toBe(1)
  expect(doubles.secrets.calls.length).toBe(secretReads)
  expect(doubles.confirm.calls.length).toBe(1)
  expect(doubles.confirm.calls[0]).toMatch(/use it anyway\?/i)
  expect(doubles.errors.lines).toEqual(expectedErrors)
  expect(doubles.out.lines).toEqual([])
}

describe('auth set --provider confirmation', () => {
  it('asks for the key again on "no" and never stores the declined value', async () => {
    const doubles = confirmDoubles([URL_KEY, ''], [false])
    const exit = await runProviderAuthSet(
      doubles,
      'provider-key-confirm test stores no declined key',
    )
    expectConfirmOutcome(exit, doubles, 2, [providerKeyFailureText('empty')])
  })

  it('continues a confirmed suspicious key to the store for the provider to judge', async () => {
    const doubles = confirmDoubles([URL_KEY], [true])
    const exit = await runProviderAuthSet(doubles, 'test store refused')
    expectConfirmOutcome(exit, doubles, 1, [
      fill(UI_TEXT.acpStoreUnavailable, { reason: 'test store refused' }),
    ])
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

/** The provider-level drill against the same refusing store and providers file. */
function runProviderAuthSet(doubles: ConfirmDoubles, secretsReason: string): Promise<number> {
  return authSetProvider(
    {
      secrets: refusingSecrets(secretsReason),
      storeName: 'test store',
      readSecret: doubles.secrets.readSecret,
      confirmKeyUse: doubles.confirm.confirmKeyUse,
      print: doubles.out.print,
      printError: doubles.errors.print,
    } satisfies AuthCommandDeps,
    'groq',
    () => Promise.resolve<ProvidersFileRead>({ ok: true, file: emptyProvidersFile() }),
  )
}

/** The per-account drill against a staged openai work account. */
async function runWorkAccountAuthSet(doubles: ConfirmDoubles): Promise<number> {
  const folder = await openaiWorkFolder()
  const metadata = fileAccountsMetadata(folder)
  return await runAccountAuthSet(
    { provider: 'openai', account: 'work' },
    {
      accounts: new AccountStore(metadata, refusingVault()),
      metadata,
      readSecret: doubles.secrets.readSecret,
      confirmKeyUse: doubles.confirm.confirmKeyUse,
      storeName: 'test store',
      print: doubles.out.print,
      printError: doubles.errors.print,
    },
  )
}

describe('per-account auth confirmation', () => {
  it('asks for the key again on "no" and never stores the declined value', async () => {
    const doubles = confirmDoubles([URL_KEY, ''], [false])
    const exit = await runWorkAccountAuthSet(doubles)
    expectConfirmOutcome(exit, doubles, 2, [UI_TEXT.accounts.invalidAccount])
  })

  it('continues a confirmed suspicious per-account key to the store', async () => {
    const doubles = confirmDoubles([URL_KEY], [true])
    const exit = await runWorkAccountAuthSet(doubles)
    expect(exit).toBe(1)
    expect(doubles.secrets.calls.length).toBe(1)
    expect(doubles.confirm.calls.length).toBe(1)
    // A store refusal names its cause (merged accounts command): the vault
    // the run must not reach says why it refused.
    expect(doubles.errors.lines).toEqual([
      fill(UI_TEXT.accounts.unavailableReason, {
        reason: 'provider-key-confirm test performs no vault call',
      }),
    ])
    expect(doubles.out.lines).toEqual([])
  })
})
