import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountStoreError } from '../../src/core/providers/accountCredentialRecord'
import { chatGptCommandText } from '../../src/runtime/chatGptProviderCommands'
import { parseChatGptProviderAction, parseCommandLine } from '../../src/runtime/cliArgs'
import { parseAccountsCommand } from '../../src/runtime/providers/accountsCommand'
import { UI_TEXT } from '../../src/shared/constants'
import {
  fileAccountsMetadata,
  runtimeProvidersFile,
} from '../../src/runtime/providers/providersFileStore'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

const META_ENTRY = {
  id: 'meta',
  policyProvider: 'meta',
  product: 'model-api',
  auth: 'apiKey',
  origin: 'https://api.meta.ai',
} as const

async function metadataFolder() {
  const folder = await mkdtemp(path.join(tmpdir(), 'rvtestcut2-accounts-'))
  folders.push(folder)
  return folder
}

describe('terminal account command parsing and real metadata files', () => {
  it('parses account management without accepting credentials on the command line', () => {
    expect(parseCommandLine(['providers', 'accounts', 'list', '--provider', 'meta'])).toMatchObject(
      { command: 'accounts' },
    )
    expect(
      parseAccountsCommand(['add', '--provider', 'meta', '--account', 'work', '--label', 'Work']),
    ).toMatchObject({ action: 'add', provider: 'meta', account: { id: 'work', label: 'Work' } })
    expect(
      parseAccountsCommand([
        'add',
        '--provider',
        'meta',
        '--account',
        'work',
        '--label',
        'Work',
        '--device',
        'peer-1',
      ]),
    ).toMatchObject({
      action: 'add',
      provider: 'meta',
      account: { id: 'work', device: 'peer-1' },
    })
    expect(
      parseAccountsCommand(['place', 'work', '--provider', 'meta', '--device', 'peer-1']),
    ).toMatchObject({ action: 'place', provider: 'meta', account: 'work', device: 'peer-1' })
    expect(parseAccountsCommand(['order', '--provider', 'meta', 'work', 'default'])).toMatchObject({
      action: 'order',
      accounts: ['work', 'default'],
    })
    expect(
      parseAccountsCommand(['remove', '--provider', 'meta', '--account', 'work']),
    ).toMatchObject({ action: 'remove', account: 'work' })
    expect(
      parseAccountsCommand([
        'thresholds',
        '--provider',
        'meta',
        '--account',
        'work',
        '--thresholds',
        '{"requests":{"day":2}}',
      ]),
    ).toMatchObject({ action: 'thresholds', thresholds: { requests: { day: 2 } } })
  })

  it.each(
    [
      ['list'],
      ['list', 'extra', '--provider', 'meta'],
      ['list', '--provider', 'META'],
      ['list', '--provider', 'meta', '--account', 'work'],
      ['add', '--provider', 'meta', '--account', 'work'],
      [
        'add',
        '--provider',
        'meta',
        '--account',
        'work',
        '--label',
        'Work',
        '--key',
        'account-secret-canary',
      ],
      [
        'thresholds',
        '--provider',
        'meta',
        '--account',
        'work',
        '--thresholds',
        '{"secret":"account-secret-canary"}',
      ],
      [
        'thresholds',
        '--provider',
        'meta',
        '--account',
        'work',
        '--thresholds',
        '{"requests":{"day":0.5}}',
      ],
      ['remove', '--provider', 'meta', '--account', '../bad'],
      ['order', '--provider', 'meta', 'default', '../bad'],
      ['place', 'work', '--provider', 'meta'],
      ['place', 'work', '--provider', 'meta', '--device', '../bad'],
      ['add', '--provider', 'meta', '--account', 'work', '--label', 'Work', '--device', ''],
    ].map((args) => ({ args })),
  )('rejects malformed metadata without reflecting arguments: %j', ({ args }) => {
    expect(parseAccountsCommand(args)).toBeUndefined()
    const parsed = parseCommandLine(['providers', 'accounts', ...args])
    expect(parsed.command).toBe('invalid')
    expect(JSON.stringify(parsed)).not.toContain('account-secret-canary')
  })

  it.each([[], ['list']].map((args) => ({ args })))(
    'exits 2 with usage for accounts misuse: %j',
    ({ args }) => {
      expect(parseCommandLine(['providers', 'accounts', ...args])).toMatchObject({
        command: 'invalid',
        exitCode: 2,
      })
    },
  )

  it.each(
    [
      ['auth', 'set', 'account-secret-canary'],
      ['auth', 'set', '--backend', 'account-secret-canary'],
      ['auth', 'set', '--shell-sandbox', 'account-secret-canary'],
      ['auth', 'set', '--key', 'account-secret-canary'],
      ['auth', 'set', '--account-secret-canary'],
      ['auth', 'set', '--key-file', 'account-secret-canary'],
      ['auth', 'set', '--key-env', 'account-secret-canary'],
      ['auth', 'set', '--provider', 'meta', '--account', 'Account-secret-canary'],
      ['auth', 'status', '--provider', 'meta', '--account', 'work'],
    ].map((args) => ({ args })),
  )('refuses argument, file and environment secret routes: %j', ({ args }) => {
    const parsed = parseCommandLine(args)
    expect(parsed.command).toBe('invalid')
    expect(JSON.stringify(parsed)).not.toContain('account-secret-canary')
  })

  it('persists account metadata across adapters without a credential store', async () => {
    const folder = await metadataFolder()
    const metadata = fileAccountsMetadata(folder)
    expect(await metadata.read('meta')).toEqual(META_ENTRY)
    const accounts = [{ id: 'work', label: 'Work', order: 0, thresholds: { requests: { day: 2 } } }]
    await metadata.writeAccounts('meta', accounts)
    expect(await fileAccountsMetadata(folder).read('meta')).toEqual({ ...META_ENTRY, accounts })
    expect(JSON.parse(await readFile(runtimeProvidersFile(folder), 'utf8'))).toEqual({
      providers: { meta: { ...META_ENTRY, accounts } },
    })
  })

  it.each([
    ['a malformed provider row', { providers: { meta: { ...META_ENTRY, auth: 'not-a-method' } } }],
    ['a file that is not JSON', '{oops'],
  ])('refuses %s and preserves its exact bytes', async (_label, envelope) => {
    const folder = await metadataFolder()
    const file = runtimeProvidersFile(folder)
    const before = typeof envelope === 'string' ? envelope : JSON.stringify(envelope)
    await writeFile(file, before)
    const metadata = fileAccountsMetadata(folder)
    await expect(async () => await metadata.read('meta')).rejects.toMatchObject({
      code: 'invalidProvidersFile',
    })
    await expect(async () => await metadata.read('meta')).rejects.toBeInstanceOf(AccountStoreError)
    expect(await readFile(file, 'utf8')).toBe(before)
  })
})

// ChatGPT provider command boundary (moved from the overhaul-deleted
// runtimeChatGpt.test.ts as a real-module replacement): pure command/text
// boundaries only. Authenticated lifecycle behavior requires the real OS
// store and dated captured OpenAI exchanges, not an invented issuer.
describe('terminal ChatGPT command boundary', () => {
  it.each(['add', 'remove', 'status'])('parses the local %s action', (action) => {
    const argv = ['providers', action, 'chatgpt']
    expect(parseChatGptProviderAction(argv)).toBe(action)
    expect(parseCommandLine(argv)).toEqual({ command: 'chatGptProvider', action })
  })

  it.each([
    ['providers', 'add', 'chatgpt', 'private-value'],
    ['providers', 'add', 'chatgpt', '--key-stdin'],
    ['providers', 'status', 'chatgpt', '--backend', 'modelApi'],
    ['providers', 'other', 'chatgpt'],
  ])('rejects unexpected inputs without echoing them: %j', (...argv) => {
    expect(parseChatGptProviderAction(argv)).toBeUndefined()
    expect(parseCommandLine(argv)).toEqual({
      command: 'invalid',
      reason: UI_TEXT.acpChatGpt.usage,
      exitCode: 2,
    })
  })

  it('names a dead credential store with the ChatGPT sign-in guidance', () => {
    // R7 gives local ChatGPT causes their own sentence: the shared
    // outage line other surfaces use would not tell a person how to
    // unlock a store.
    const failure = chatGptCommandText().failure('store-unavailable')
    expect(failure).toBe(UI_TEXT.acpChatGpt.storeUnavailable)
    expect(failure).toContain('Secret Service')
    expect(chatGptCommandText().status('signed-out')).toBe(UI_TEXT.acpChatGpt.states['signed-out'])
    expect(chatGptCommandText().failure('expired')).toBe(UI_TEXT.planUi.expired)
  })
})
