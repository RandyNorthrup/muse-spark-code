// The terminal Grok command boundary: exact grammar, refusal before any
// request, and the stored grant's states, all through the real runtime
// composition (the real host, the real lock, a real providers file) with
// no request leaving the test process: the fetch answers only with the
// recorded discovery document and refuses everything else.
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { grokFailureText } from '../../src/core/providers/subscriptions/registry'
import {
  emptyProvidersFile,
  readProvidersFile,
  writeProvidersFileAtomic,
  type ProvidersFile,
} from '../../src/core/providers/providersFile'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { createRuntimeGrokHost } from '../../src/runtime/grokHost'
import {
  grokAuthenticationMethods,
  grokCommandText,
  runGrokProviderCommand,
  runtimeGrokCommandDeps,
} from '../../src/runtime/grokProviderCommands'
import { parseCommandLine, parseGrokProviderAction } from '../../src/runtime/cliArgs'
import { ACP_AGENT_NAME, PROVIDER_SECRET_PREFIX, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'
import type { SignInMethod } from '../../src/acp/agent'
import {
  CLIENT_ID,
  discoveryEndpoints,
  discoveryOnlyFetch,
  type FetchCall,
} from './helpers/grokDiscoveryFetch'
import { grokGrantRecord } from './helpers/grokGrant'
import { mapSecrets } from './helpers/mapSecrets'
import { usingTempDir } from './helpers/temporaryFolders'

const GRANT_KEY = `${PROVIDER_SECRET_PREFIX}grok`

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('terminal Grok command grammar', () => {
  it.each(['add', 'remove', 'status'] as const)('parses the local %s action', (action) => {
    const argv = ['providers', action, 'grok']
    expect(parseGrokProviderAction(argv)).toEqual({ action, isDeviceFlow: false })
    expect(parseCommandLine(argv)).toEqual({
      command: 'grokProvider',
      action: { action, isDeviceFlow: false },
    })
  })

  it('parses add with the device flow and client configuration', () => {
    const argv = [
      'providers',
      'add',
      'grok',
      '--device',
      '--client-id',
      CLIENT_ID,
      '--scopes',
      'openid offline_access',
    ]
    const action = {
      action: 'add',
      isDeviceFlow: true,
      clientId: CLIENT_ID,
      scopes: 'openid offline_access',
    } as const
    expect(parseGrokProviderAction(argv)).toEqual(action)
    expect(parseCommandLine(argv)).toEqual({ command: 'grokProvider', action })
  })

  it.each([
    ['providers', 'other', 'grok'],
    ['providers', 'remove', 'grok', '--device'],
    ['providers', 'status', 'grok', '--client-id', CLIENT_ID],
    ['providers', 'add', 'grok', '--new-account'],
    ['providers', 'add', 'grok', '--device', '--device'],
    ['providers', 'add', 'grok', '--client-id'],
    ['providers', 'add', 'grok', '--client-id', ''],
    ['providers', 'add', 'grok', '--client-id', CLIENT_ID, '--client-id', CLIENT_ID],
    ['providers', 'add', 'grok', '--scopes', '--device'],
    ['providers', 'add', 'grok', 'private-value'],
  ])('rejects unexpected inputs without echoing them: %j', (...argv) => {
    expect(parseGrokProviderAction(argv)).toBeUndefined()
    expect(parseCommandLine(argv)).toEqual({
      command: 'invalid',
      reason: UI_TEXT.acpGrok.usage,
      exitCode: 2,
    })
  })
})

interface GrokHarness {
  readonly secrets: SecretStore
  readonly calls: FetchCall[]
  readonly printed: string[]
  readonly errors: string[]
  readonly configFile: string
  run(
    action: Parameters<typeof runGrokProviderCommand>[0],
    client?: { clientId?: string; scopes?: string },
  ): Promise<number>
}

function harness(configFile: string, secrets: SecretStore = mapSecrets({})): GrokHarness {
  const printed: string[] = []
  const errors: string[] = []
  const fetchCalls: FetchCall[] = []
  const deps = runtimeGrokCommandDeps({
    uiText: EN,
    locale: BASE_LOCALE,
    secrets,
    fetch: discoveryOnlyFetch({ calls: fetchCalls }),
    configFile,
    callbackText: () => UI_TEXT.acpGrok.callback,
    openBrowser: () => Promise.resolve(),
    presentDeviceCode: () => Promise.resolve(),
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  })
  return {
    secrets,
    calls: fetchCalls,
    printed,
    errors,
    configFile,
    run: async (action, client) =>
      await runGrokProviderCommand({ ...action, ...(client !== undefined && client) }, deps),
  }
}

/** Store a grant through the real host, the way sign-in leaves it. */
async function storeGrant(secrets: SecretStore): Promise<void> {
  const host = createRuntimeGrokHost({
    secrets,
    fetch: discoveryOnlyFetch(),
    clientId: CLIENT_ID,
    scopes: undefined,
    openBrowser: () => Promise.resolve(),
    callbackText: () => '',
  })
  await host.writeRecord(grokGrantRecord())
}

function seededFile(): ProvidersFile {
  return {
    ...emptyProvidersFile(),
    defaultModel: 'grok/grok-4-1-fast-non-reasoning',
    providers: [
      {
        id: 'grok',
        preset: 'grok',
        address: 'https://api.x.ai',
        format: 'responses',
        auth: 'subscription',
        models: ['grok-4-1-fast-non-reasoning'],
      },
      { id: 'openrouter', preset: 'openrouter', auth: 'apiKey', models: ['model-a'] },
    ],
  }
}

async function readFile(configFile: string): Promise<ProvidersFile> {
  const read = await readProvidersFile(configFile)
  if (!read.ok) throw new Error(read.detail)
  return read.file
}

describe('runGrokProviderCommand', () => {
  it('says signed-out with exit 1 where no grant is stored', async () => {
    await usingTempDir('grok-cli-', async (folder) => {
      const cli = harness(path.join(folder, 'providers.json'))
      const exit = await cli.run({ action: 'status' })
      expect(exit).toBe(1)
      expect(cli.printed).toEqual([UI_TEXT.acpGrok.states['signed-out']])
      expect(cli.errors).toEqual([])
      expect(cli.calls).toEqual([])
    })
  })

  it('says signed-in with exit 0 for a live grant, expired for a spent one', async () => {
    await usingTempDir('grok-cli-', async (folder) => {
      const cli = harness(path.join(folder, 'providers.json'))
      await storeGrant(cli.secrets)
      expect(await cli.run({ action: 'status' })).toBe(0)
      expect(cli.printed).toEqual([UI_TEXT.acpGrok.states['signed-in']])
      await cli.secrets.store(
        GRANT_KEY,
        JSON.stringify(grokGrantRecord({ expiresAt: Date.now() - 1000 })),
      )
      cli.printed.length = 0
      expect(await cli.run({ action: 'status' })).toBe(0)
      expect(cli.printed).toEqual([UI_TEXT.acpGrok.states.expired])
      expect(cli.calls).toEqual([])
    })
  })

  it('names a grant the store cannot parse', async () => {
    await usingTempDir('grok-cli-', async (folder) => {
      const cli = harness(path.join(folder, 'providers.json'), mapSecrets({ [GRANT_KEY]: '{oops' }))
      expect(await cli.run({ action: 'status' })).toBe(1)
      expect(cli.errors).toEqual([UI_TEXT.acpGrok.grantUnreadable])
    })
  })

  it.each([false, true])(
    'refuses without a client id before any request goes out (device flow: %s)',
    async (isDeviceFlow) => {
      await usingTempDir('grok-cli-', async (folder) => {
        const cli = harness(path.join(folder, 'providers.json'))
        const exit = await cli.run({ action: 'add', isDeviceFlow })
        expect(exit).toBe(1)
        expect(cli.printed).toEqual([
          isDeviceFlow ? UI_TEXT.acpGrok.deviceNotice : UI_TEXT.acpGrok.notice,
        ])
        expect(cli.errors).toEqual([UI_TEXT.acpGrok.clientIdUnset])
        expect(cli.calls).toEqual([])
        expect(await cli.secrets.get(GRANT_KEY)).toBeUndefined()
      })
    },
  )

  it('never overwrites a stored grant, including an expired one', async () => {
    await usingTempDir('grok-cli-', async (folder) => {
      const cli = harness(path.join(folder, 'providers.json'))
      await storeGrant(cli.secrets)
      const exit = await cli.run({ action: 'add' }, { clientId: CLIENT_ID })
      expect(exit).toBe(1)
      expect(cli.errors).toEqual([UI_TEXT.acpGrok.alreadyAdded])
      expect(cli.calls).toEqual([])
    })
  })

  // The browser flow waits on the loopback listener for a person, so only
  // the device flow's refused answer is reachable headless: the recorded
  // discovery, then the device-code request it advertises.
  it('names the refused device answer and stores nothing', async () => {
    await usingTempDir('grok-cli-', async (folder) => {
      const cli = harness(path.join(folder, 'providers.json'))
      const exit = await cli.run({ action: 'add', isDeviceFlow: true }, { clientId: CLIENT_ID })
      expect(exit).toBe(1)
      expect(cli.errors).toHaveLength(1)
      expect(cli.errors[0]).toContain('A request to xAI failed')
      // Our own request shapes; xAI's answer is refused, never invented.
      expect(cli.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        'GET https://auth.x.ai/.well-known/openid-configuration',
        `POST ${discoveryEndpoints().device}`,
      ])
      expect(await cli.secrets.get(GRANT_KEY)).toBeUndefined()
      expect(await readProvidersFile(cli.configFile)).toMatchObject({ ok: false })
    })
  })

  it('removes the entry and the grok default model with exit 0', async () => {
    await usingTempDir('grok-cli-', async (folder) => {
      const cli = harness(path.join(folder, 'providers.json'))
      const written = await writeProvidersFileAtomic(cli.configFile, seededFile())
      if (!written.ok) throw new Error(written.detail)
      const exit = await cli.run({ action: 'remove' })
      expect(exit).toBe(0)
      expect(cli.printed).toEqual([fill(UI_TEXT.acpProviderRemoved, { id: 'grok' })])
      expect(cli.calls).toEqual([])
      const file = await readFile(cli.configFile)
      expect(file.providers.map((entry) => entry.id)).toEqual(['openrouter'])
      expect(file.defaultModel).toBeUndefined()
    })
  })

  it('still deletes the local grant when xAI cannot be reached for revocation', async () => {
    await usingTempDir('grok-cli-', async (folder) => {
      const cli = harness(path.join(folder, 'providers.json'))
      await storeGrant(cli.secrets)
      const written = await writeProvidersFileAtomic(cli.configFile, seededFile())
      if (!written.ok) throw new Error(written.detail)
      const exit = await cli.run({ action: 'remove' })
      expect(exit).toBe(1)
      expect(cli.errors).toHaveLength(1)
      expect(cli.errors[0]).toContain('A request to xAI failed')
      expect(await cli.secrets.get(GRANT_KEY)).toBeUndefined()
      const file = await readFile(cli.configFile)
      expect(file.providers.map((entry) => entry.id)).toEqual(['openrouter'])
    })
  })
})

describe('grokCommandText', () => {
  it('reads the sign-in sentences live, never interpolated', () => {
    const text = grokCommandText()
    expect(text.beforeSignIn(false)).toBe(UI_TEXT.acpGrok.notice)
    expect(text.beforeSignIn(true)).toBe(UI_TEXT.acpGrok.deviceNotice)
    expect(text.alreadyAdded()).toBe(UI_TEXT.acpGrok.alreadyAdded)
    expect(text.status('signed-in')).toBe(UI_TEXT.acpGrok.states['signed-in'])
    expect(text.failure('client-id-unset')).toBe(UI_TEXT.acpGrok.clientIdUnset)
    expect(text.failure('request-failed', 'TypeError: ENOTFOUND')).toBe(
      grokFailureText('request-failed', 'TypeError: ENOTFOUND'),
    )
  })
})

function method(methods: SignInMethod[], id: string): SignInMethod {
  const found = methods.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`missing auth method ${id}`)
  return found
}

describe('grokAuthenticationMethods', () => {
  it('lists the exact terminal commands', () => {
    const methods = grokAuthenticationMethods(() => createRuntimeGrokHostFor(mapSecrets({})), {
      clientId: CLIENT_ID,
      scopes: 'openid offline_access',
    })
    const add = method(methods, 'grok-add')
    expect(add.name).toBe(UI_TEXT.acpGrok.actions.add)
    expect(add.args).toEqual([
      'providers',
      'add',
      'grok',
      '--client-id',
      CLIENT_ID,
      '--scopes',
      'openid offline_access',
    ])
    expect(add.command).toBe(`${ACP_AGENT_NAME} ${add.args.join(' ')}`)
    const deviceMethod = method(methods, 'grok-add-device')
    expect(deviceMethod.description).toBe(UI_TEXT.acpGrok.deviceNotice)
    expect(deviceMethod.args).toContain('--device')
    const remove = method(methods, 'grok-remove')
    expect(remove.args).toEqual(['providers', 'remove', 'grok'])
    const status = method(methods, 'grok-status')
    expect(status.args).toEqual(['providers', 'status', 'grok'])
  })

  it('verifies add only with a stored grant, remove only without one', async () => {
    const secrets = mapSecrets({})
    const methods = grokAuthenticationMethods(() => createRuntimeGrokHostFor(secrets), {})
    const verify = async (id: string): Promise<string | undefined> => {
      const found = method(methods, id)
      if (found.verify === undefined) throw new Error(`method ${id} has no verifier`)
      return await found.verify()
    }
    expect(await verify('grok-add')).toBe(grokFailureText('not-signed-in'))
    expect(await verify('grok-remove')).toBeUndefined()
    expect(await verify('grok-status')).toBeUndefined()
    await storeGrant(secrets)
    expect(await verify('grok-add')).toBeUndefined()
    expect(await verify('grok-remove')).toBe(grokFailureText('still-signed-in'))
    expect(await verify('grok-status')).toBeUndefined()
  })

  it('names a grant the store cannot parse', async () => {
    const secrets = mapSecrets({ [GRANT_KEY]: '{oops' })
    const methods = grokAuthenticationMethods(() => createRuntimeGrokHostFor(secrets), {})
    const status = method(methods, 'grok-status')
    if (status.verify === undefined) throw new Error('status has no verifier')
    await expect(status.verify()).resolves.toBe(grokFailureText('grant-unreadable'))
  })
})

function createRuntimeGrokHostFor(secrets: SecretStore): ReturnType<typeof createRuntimeGrokHost> {
  return createRuntimeGrokHost({
    secrets,
    fetch: discoveryOnlyFetch(),
    clientId: undefined,
    scopes: undefined,
    openBrowser: () => Promise.resolve(),
    callbackText: () => '',
  })
}
