import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import {
  parseAccountsCommand,
  runAccountsCommand,
  runAccountAuthSet,
  type AccountsCommand,
} from '../../src/runtime/providers/accountsCommand'
import { UI_TEXT } from '../../src/shared/constants'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'
import { commandAccountsRig } from './helpers/runtimeAccounts'

const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})
function rig() {
  const h = commandAccountsRig()
  disposals.push(h.dispose)
  return h
}
function command(args: string[]): AccountsCommand {
  const parsed = parseAccountsCommand(args)
  if (parsed === undefined) throw new Error('fixture command invalid')
  return parsed
}

describe('M108 terminal account commands', () => {
  it('parses and executes list, add, remove, order and thresholds with no credential output', async () => {
    const h = rig()
    const run = (args: string[]) =>
      runAccountsCommand(command([...args, '--provider', 'meta']), h.deps)
    expect(parseCommandLine(['providers', 'accounts', 'list', '--provider', 'meta'])).toMatchObject(
      { command: 'accounts' },
    )
    expect(await run(['list'])).toBe(0)
    expect(JSON.parse(h.print.mock.calls[0]?.[0] ?? '')).toMatchObject([{ id: 'default' }])
    expect(await run(['add', '--account', 'work', '--label', 'Work', '--limit-group', 'org'])).toBe(
      0,
    )
    expect(await h.accounts.list('meta')).toMatchObject([
      { id: 'default', order: 0 },
      { id: 'work', order: 1 },
    ])
    expect(await run(['order', 'work', 'default'])).toBe(0)
    expect(
      await run([
        'thresholds',
        '--account',
        'work',
        '--thresholds',
        '{"spendUsd":{"day":0.3},"requests":{"month":2}}',
      ]),
    ).toBe(0)
    expect(await h.accounts.list('meta')).toMatchObject([
      { id: 'work', order: 0, limitGroup: 'org', thresholds: { spendUsd: { day: 0.3 } } },
      { id: 'default', order: 1 },
    ])
    expect(await run(['remove', '--account', 'work'])).toBe(0)
    expect(await h.accounts.list('meta')).toHaveLength(1)
    expect(h.printError).not.toHaveBeenCalled()
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
    ].map((args) => ({ args })),
  )('rejects malformed CLI metadata without reflecting arguments: %j', ({ args }) => {
    expect(parseAccountsCommand(args)).toBeUndefined()
    const parsed = parseCommandLine(['providers', 'accounts', ...args])
    expect(parsed.command).toBe('invalid')
    expect(JSON.stringify(parsed)).not.toContain('account-secret-canary')
  })

  it('reads a second Meta key only from hidden stdin and preserves the existing default', async () => {
    const h = rig()
    h.values.set('museSpark.modelApiKey', CURRENT_SHAPE_KEYS[0])
    await h.accounts.add('meta', { id: 'work', label: 'Work', order: 1, thresholds: {} })
    const readSecret = vi.fn(() => Promise.resolve(` ${CURRENT_SHAPE_KEYS[1]} `))
    const target = { provider: 'meta', account: 'work' }
    expect(parseCommandLine(['auth', 'set', '--provider', 'meta', '--account', 'work'])).toEqual({
      command: 'authSet',
      target,
    })
    expect(
      await runAccountAuthSet(target, { ...h.deps, readSecret, storeName: 'test vault' }),
    ).toBe(0)
    expect(readSecret).toHaveBeenCalledExactlyOnceWith(UI_TEXT.acpKeyPrompt)
    expect(h.values.get('museSpark.modelApiKey')).toBe(CURRENT_SHAPE_KEYS[0])
    expect(h.values.get('museSpark.provider.meta.account.work')).toContain(CURRENT_SHAPE_KEYS[1])
    expect(
      await h.accounts.useCredential(
        'meta',
        'work',
        'https://api.meta.ai/v1/models',
        (_binding, credential) => Promise.resolve(credential?.secret),
      ),
    ).toBe(CURRENT_SHAPE_KEYS[1])
    expect(JSON.stringify([h.print.mock.calls, h.printError.mock.calls])).not.toContain(
      CURRENT_SHAPE_KEYS[1],
    )
    await h.accounts.remove('meta', 'work')
    expect(h.values.has('museSpark.provider.meta.account.work')).toBe(false)
  })

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

  it('supports API-key providers and refuses subscription auth, unknown accounts and invalid Meta keys', async () => {
    const h = rig()
    h.configure({
      id: 'anthropic',
      policyProvider: 'anthropic',
      product: 'api',
      origin: 'https://api.anthropic.com',
    })
    const readSecret = vi.fn(() => Promise.resolve('account-secret-canary'))
    const deps = { ...h.deps, readSecret, storeName: 'test' }
    const set = vi.spyOn(h.accounts, 'setCredential')
    expect(await runAccountAuthSet({ provider: 'anthropic', account: 'default' }, deps)).toBe(0)
    expect(h.values.get('museSpark.provider.anthropic')).toContain('account-secret-canary')
    expect(readSecret).toHaveBeenCalledWith('anthropic · default API key (not shown as you type): ')
    h.configure({ auth: 'subscription' })
    readSecret.mockClear()
    set.mockClear()
    expect(await runAccountAuthSet({ provider: 'anthropic', account: 'default' }, deps)).toBe(1)
    expect(readSecret).not.toHaveBeenCalled()
    h.configure({
      id: 'meta',
      policyProvider: 'meta',
      product: 'model-api',
      origin: 'https://api.meta.ai',
      auth: 'apiKey',
    })
    expect(await runAccountAuthSet({ provider: 'meta', account: 'missing' }, deps)).toBe(1)
    expect(readSecret).not.toHaveBeenCalled()
    expect(await runAccountAuthSet({ provider: 'meta', account: 'default' }, deps)).toBe(1)
    expect(h.values.has('museSpark.modelApiKey')).toBe(false)
    expect(set).not.toHaveBeenCalled()
  })

  it('reports storage failures with fixed text and never reflects a secret in an exception', async () => {
    const h = rig()
    vi.spyOn(h.accounts, 'list').mockRejectedValue(new Error('account-secret-canary'))
    expect(await runAccountsCommand({ action: 'list', provider: 'meta' }, h.deps)).toBe(1)
    expect(h.printError).toHaveBeenCalledWith(UI_TEXT.accounts.unavailable)
    expect(h.print).not.toHaveBeenCalled()
    expect(JSON.stringify(h.printError.mock.calls)).not.toContain('account-secret-canary')
  })
})
