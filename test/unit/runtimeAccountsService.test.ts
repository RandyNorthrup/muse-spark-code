import { duplicateMetaAccounts } from './helpers/runtimeAccounts'
// CM108ACC: the installed runtime serves the shared account service, not the
// "unavailable" stub. Production FileAccountsMetadata + AccountStore +
// AccountSecrets over a temp data dir and an in-memory keyring: the dogfood
// cells (CLI list/add/thresholds, ACP read, headless credential) must pass.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpAccounts } from '../../src/acp/accounts'
import { AccountSwitchRefusedError, accountErrorText } from '../../src/acp/accountText'
import { runAccountsCommand, runAccountAuthSet } from '../../src/runtime/providers/accountsCommand'
import { memoryKeyring } from './helpers/keyring'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'
import { parseAccountsCommand } from '../../src/runtime/providers/accountArgs'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import type { RuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'

const homes: string[] = []
const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function rig() {
  const dataDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'cm108acc-accounts-')))
  homes.push(dataDir)
  const { openEntry, values } = memoryKeyring()
  const services = createRuntimeAccountServices({ dataDir, openEntry })
  disposals.push(() => {
    services.dispose()
  })
  const print = vi.fn<(text: string) => void>()
  const printError = vi.fn<(text: string) => void>()
  return { dataDir, values, services, print, printError }
}

function commandOf(args: string[]) {
  const parsed = parseAccountsCommand(args)
  if (parsed === undefined) throw new Error('fixture command invalid')
  return parsed
}

async function accounts(
  services: RuntimeAccountServices,
  print: (text: string) => void,
  printError: (text: string) => void,
  args: string[],
): Promise<number> {
  return await runAccountsCommand(commandOf(args), {
    ...services.commands,
    print,
    printError,
  })
}

describe('installed runtime account service', () => {
  it('lists the migrated default with no pre-existing file', async () => {
    const h = rig()
    expect(await accounts(h.services, h.print, h.printError, ['list', '--provider', 'meta'])).toBe(
      0,
    )
    expect(JSON.parse(h.print.mock.calls[0]?.[0] ?? '')).toMatchObject([{ id: 'default' }])
    expect(h.printError).not.toHaveBeenCalled()
  })

  it('adds, thresholds, orders and removes a meta account', async () => {
    const h = rig()
    const run = (args: string[]) => accounts(h.services, h.print, h.printError, args)
    expect(await run(['add', '--provider', 'meta', '--account', 'work', '--label', 'Work'])).toBe(0)
    expect(
      await run([
        'thresholds',
        '--provider',
        'meta',
        '--account',
        'work',
        '--thresholds',
        '{"spendUsd":{"day":0.3}}',
      ]),
    ).toBe(0)
    expect(await run(['order', '--provider', 'meta', 'work', 'default'])).toBe(0)
    expect(await h.services.store.list('meta')).toMatchObject([
      { id: 'work', order: 0, thresholds: { spendUsd: { day: '0.3' } } },
      { id: 'default', order: 1 },
    ])
    expect(await run(['remove', '--provider', 'meta', '--account', 'work'])).toBe(0)
    expect(await h.services.store.list('meta')).toMatchObject([{ id: 'default' }])
    expect(h.printError).not.toHaveBeenCalled()
  })

  it('sets a per-account credential from standard input only', async () => {
    const h = rig()
    const run = (args: string[]) => accounts(h.services, h.print, h.printError, args)
    expect(await run(['add', '--provider', 'meta', '--account', 'work', '--label', 'Work'])).toBe(0)
    const stored = CURRENT_SHAPE_KEYS[0]
    const readSecret = vi.fn(() => Promise.resolve(`  ${stored}  `))
    const exit = await runAccountAuthSet(
      { provider: 'meta', account: 'work' },
      {
        ...h.services.commands,
        print: h.print,
        printError: h.printError,
        readSecret,
        storeName: 'test store',
      },
    )
    expect(exit).toBe(0)
    expect(readSecret).toHaveBeenCalledTimes(1)
    // The headless credential for that account is the stored key.
    const secrets = h.services.secretsFor('meta', 'work', {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    })
    expect(await secrets.get(SECRET_KEYS.modelApiKey)).toBe(stored)
    // The pre-existing default key keeps working with nothing re-entered.
    h.values.set(SECRET_KEYS.modelApiKey, stored)
    const fallback = h.services.secretsFor('meta', 'default', {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    })
    expect(await fallback.get(SECRET_KEYS.modelApiKey)).toBe(stored)
  })

  it('serves ACP list/current/thresholds from the same store', async () => {
    const h = rig()
    const run = (args: string[]) => accounts(h.services, h.print, h.printError, args)
    expect(await run(['add', '--provider', 'meta', '--account', 'work', '--label', 'Work'])).toBe(0)
    const state = await h.services.sessions('meta').read('session-1')
    expect(state).toMatchObject({ type: 'accounts/state', currentAccount: 'default' })
    expect(state.accounts).toMatchObject([{ id: 'default' }, { id: 'work' }])
    const pinned = await h.services.sessions('meta', 'work').read('session-1')
    expect(pinned).toMatchObject({ type: 'accounts/state', currentAccount: 'work' })
  })

  it('refuses an in-session switch with the stay-put text', async () => {
    const h = rig()
    const run = (args: string[]) => accounts(h.services, h.print, h.printError, args)
    expect(await run(['add', '--provider', 'meta', '--account', 'work', '--label', 'Work'])).toBe(0)
    const port = h.services.sessions('meta')
    // Re-selecting the current account is a no-op success.
    await expect(port.use('session-1', 'default', () => true)).resolves.toMatchObject({
      currentAccount: 'default',
    })
    // There is no adoption transaction here: the switch is refused and the
    // session keeps its account, named with its label.
    const refusal = port.use('session-1', 'work', () => true)
    await expect(refusal).rejects.toThrow(AccountSwitchRefusedError)
    await expect(refusal).rejects.toThrow(
      'This session stays on meta · Default account. Account switching is unavailable in this runtime.',
    )
    await expect(port.use('session-1', 'missing', () => true)).rejects.toThrow(
      UI_TEXT.accounts.invalidAccount,
    )
    await expect(port.read('session-1')).resolves.toMatchObject({ currentAccount: 'default' })
  })

  it('reports unavailable for an unconfigured provider and never writes it', async () => {
    const h = rig()
    expect(
      await accounts(h.services, h.print, h.printError, ['list', '--provider', 'openai']),
    ).toBe(1)
    expect(h.printError).toHaveBeenCalledWith(UI_TEXT.accounts.unavailable)
  })

  it('reports a corrupt file instead of clobbering it', async () => {
    const h = rig()
    const file = path.join(h.dataDir, 'providers.json')
    writeFileSync(file, '{not json', 'utf8')
    expect(await accounts(h.services, h.print, h.printError, ['list', '--provider', 'meta'])).toBe(
      1,
    )
    expect(h.printError).toHaveBeenCalledWith(UI_TEXT.accounts.providersInvalid)
    expect(readFileSync(file, 'utf8')).toBe('{not json')
  })

  it.each([
    ['duplicate account ids', duplicateMetaAccounts('https://api.meta.ai')],
    [
      'a provider id that does not match its key',
      {
        id: 'other',
        policyProvider: 'meta',
        product: 'model-api',
        auth: 'apiKey',
        origin: 'https://api.meta.ai',
      },
    ],
  ])(
    'refuses a %s with the providers-file sentence instead of the connection one',
    async (_label, entry) => {
      const h = rig()
      const file = path.join(h.dataDir, 'providers.json')
      writeFileSync(file, JSON.stringify({ providers: { meta: entry } }), 'utf8')
      const before = readFileSync(file, 'utf8')
      expect(
        await accounts(h.services, h.print, h.printError, ['list', '--provider', 'meta']),
      ).toBe(1)
      expect(h.printError).toHaveBeenCalledWith(UI_TEXT.accounts.providersInvalid)
      expect(readFileSync(file, 'utf8')).toBe(before)
    },
  )

  it('reads a refused providers file as its own sentence through the shared metadata port', async () => {
    const h = rig()
    const file = path.join(h.dataDir, 'providers.json')
    writeFileSync(
      file,
      JSON.stringify({
        providers: {
          meta: duplicateMetaAccounts('https://api.meta.ai'),
        },
      }),
      'utf8',
    )
    const before = readFileSync(file, 'utf8')
    // The one mapping point keeps the brand for typed checks and carries the
    // person-facing sentence as the message.
    await expect(h.services.metadata.read('meta')).rejects.toThrow(
      UI_TEXT.accounts.providersInvalid,
    )
    try {
      await h.services.metadata.read('meta')
      expect.unreachable()
    } catch (error: unknown) {
      expect(error).toMatchObject({
        name: 'AccountStoreError',
        code: 'invalidProvidersFile',
      })
    }
    expect(await accounts(h.services, h.print, h.printError, ['list', '--provider', 'meta'])).toBe(
      1,
    )
    expect(h.printError).toHaveBeenCalledWith(UI_TEXT.accounts.providersInvalid)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('keeps the branded refusal through session reads and ACP operations after the file corrupts', async () => {
    const h = rig()
    const run = (args: string[]) => accounts(h.services, h.print, h.printError, args)
    expect(await run(['add', '--provider', 'meta', '--account', 'work', '--label', 'Work'])).toBe(0)
    // A healthy file adopts the session first.
    await expect(h.services.sessions('meta').read('session-1')).resolves.toMatchObject({
      currentAccount: 'default',
    })
    const controller = new AcpAccounts('session-1', h.services.sessions('meta'), vi.fn(), vi.fn())
    await controller.start()
    // Corrupting the file afterwards must not become a connection problem.
    const file = path.join(h.dataDir, 'providers.json')
    writeFileSync(file, '{not json', 'utf8')
    const branded = { name: 'AccountStoreError', code: 'invalidProvidersFile' }
    await expect(h.services.sessions('meta').read('session-1')).rejects.toMatchObject(branded)
    await expect(controller.command('/accounts list', () => true)).rejects.toMatchObject(branded)
    await expect(controller.command('/accounts current', () => true)).rejects.toMatchObject(branded)
    await expect(controller.use('work', () => true)).rejects.toMatchObject(branded)
    // The agent boundary still renders the honest sentence for that brand.
    try {
      await controller.command('/accounts list', () => true)
      expect.unreachable()
    } catch (error: unknown) {
      expect(accountErrorText(error)).toBe(UI_TEXT.accounts.providersInvalid)
    }
    expect(readFileSync(file, 'utf8')).toBe('{not json')
    controller.dispose()
  })
})
