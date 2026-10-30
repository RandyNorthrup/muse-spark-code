import {
  subscriptionAccountId,
  billingKeyDigest,
} from '../../src/core/backends/modelapi/billingRoute'
// C-M95-SUB: the host credential wrapper. Real temp auth files and the
// real CredentialStore; behind it the OS/VS Code secret storage stays a
// Map, the external no unit test can own. No real auth file is ever read.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SubscriptionKeySource } from '../../src/core/backends/modelapi/subscriptionKey'
import { redactSecrets } from '../../src/shared/redact'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import { mapSecretsBacked } from './helpers/mapSecrets'
import { usingTempDir } from './helpers/temporaryFolders'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import { SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'

// Opaque values no shape pattern matches: only the exact tracked literal
// can scrub them.
const SUB = 'opaque subscription value 8e2b4a'
const PASTED = 'pasted-payg-key'

/** The auth file lands where the wrapper's own resolved path says. */
async function writeAuthFile(root: string, text: string): Promise<void> {
  const file = new SubscriptionKeySource({
    platform: 'linux',
    homeDir: '/none',
    xdgConfigHome: root,
  }).path()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}

async function credential(options: {
  root: string
  enabled: boolean
  pasted: string | undefined
  text: string | undefined
}): Promise<SubscriptionCredential> {
  if (options.text !== undefined) await writeAuthFile(options.root, options.text)
  const secrets = new Map<string, string>()
  if (options.pasted !== undefined) secrets.set(SECRET_KEYS.modelApiKey, options.pasted)
  return new SubscriptionCredential({
    credentials: new CredentialStore(mapSecretsBacked(secrets), () => undefined),
    isEnabled: () => options.enabled,
    platform: 'linux',
    homeDir: '/none',
    xdgConfigHome: options.root,
  })
}

function fileText(meta: unknown): string {
  return JSON.stringify({ schema_version: 1, providers: { meta } })
}

describe('SubscriptionCredential', () => {
  it('freezes a route and refuses instead of replacing it with a pasted key', async () => {
    await usingTempDir('subcred-route-', async (root) => {
      const wrapper = await credential({
        root,
        enabled: true,
        pasted: PASTED,
        text: fileText({ access_token: SUB }),
      })
      const route = await wrapper.route()
      expect(Object.isFrozen(route)).toBe(true)
      expect(route?.kind).toBe('museCodePlan')
      expect(route?.accountId).not.toBe(billingKeyDigest(SUB))
      await writeAuthFile(root, fileText({ api_key: PASTED }))
      await expect(wrapper.route()).rejects.toThrow(UI_TEXT.subscriptionKey.signInAgain)
      expect(route?.credential).toBe(SUB)
      await expect(wrapper.route(true)).resolves.toMatchObject({
        kind: 'payAsYouGo',
        credential: PASTED,
      })
    })
  })
  it('normalizes Windows separators for the stable subscription identity', () => {
    expect(subscriptionAccountId(String.raw`C:\Users\fake\.config\muse\auth.json`)).toBe(
      subscriptionAccountId('C:/Users/fake/.config/muse/auth.json'),
    )
  })
  it('uses the pasted key while the opt-in is off', async () => {
    await usingTempDir('subcred-off-', async (root) => {
      const wrapper = await credential({
        root,
        enabled: false,
        pasted: PASTED,
        text: fileText({ api_key: SUB }),
      })
      await expect(wrapper.getApiKey()).resolves.toBe(PASTED)
      await expect(wrapper.isSubscriptionBilling()).resolves.toBe(false)
      await expect(wrapper.hasCredential()).resolves.toBe(true)
    })
  })
  it('reports no credential while off with nothing stored', async () => {
    await usingTempDir('subcred-none-', async (root) => {
      const wrapper = await credential({ root, enabled: false, pasted: undefined, text: undefined })
      await expect(wrapper.getApiKey()).resolves.toBeUndefined()
      await expect(wrapper.hasCredential()).resolves.toBe(false)
    })
  })
  it('uses the subscription key while on', async () => {
    await usingTempDir('subcred-on-', async (root) => {
      const wrapper = await credential({
        root,
        enabled: true,
        pasted: PASTED,
        text: fileText({ access_token: SUB }),
      })
      await expect(wrapper.getApiKey()).resolves.toBe(SUB)
      await expect(wrapper.isSubscriptionBilling()).resolves.toBe(true)
      await expect(wrapper.hasCredential()).resolves.toBe(true)
    })
  })
  it('refuses a pay-as-you-go file while on, even with a pasted key stored', async () => {
    await usingTempDir('subcred-payg-', async (root) => {
      const wrapper = await credential({
        root,
        enabled: true,
        pasted: PASTED,
        text: fileText({ api_key: SUB }),
      })
      await expect(wrapper.getApiKey()).rejects.toThrow(UI_TEXT.subscriptionKey.signInAgain)
      await expect(wrapper.isSubscriptionBilling()).resolves.toBe(false)
      await expect(wrapper.hasCredential()).resolves.toBe(false)
    })
  })
  it('throws the refusal, without the key, while on and signed out', async () => {
    await usingTempDir('subcred-signedout-', async (root) => {
      const wrapper = await credential({ root, enabled: true, pasted: PASTED, text: undefined })
      let failure = 'resolved'
      try {
        await wrapper.getApiKey()
      } catch (error: unknown) {
        failure = String(error)
      }
      expect(failure).toBe(`SubscriptionKeyError: ${UI_TEXT.subscriptionKey.signInAgain}`)
      expect(failure).not.toContain(SUB)
      expect(failure).not.toContain(PASTED)
      await expect(wrapper.isSubscriptionBilling()).resolves.toBe(false)
      await expect(wrapper.hasCredential()).resolves.toBe(false)
    })
  })
})

function store(options: { pasted: string | undefined; subscribed: boolean }) {
  const secrets = new Map<string, string>()
  if (options.pasted !== undefined) secrets.set(SECRET_KEYS.modelApiKey, options.pasted)
  return new CredentialStore(
    mapSecretsBacked(secrets),
    () => undefined,
    'test store',
    undefined,
    () => Promise.resolve(options.subscribed),
  )
}

describe('SubscriptionCredential redaction', () => {
  it('registers the key it sends, so shared redaction covers it', async () => {
    await usingTempDir('subcred-register-', async (root) => {
      const wrapper = await credential({
        root,
        enabled: true,
        pasted: PASTED,
        text: fileText({ access_token: SUB }),
      })
      await wrapper.getApiKey()
      expect(redactSecrets(`saw ${SUB} in a log line`)).not.toContain(SUB)
    })
  })
  it('keeps reporting a rotated-out key alongside the current one', async () => {
    await usingTempDir('subcred-rotated-', async (root) => {
      const wrapper = await credential({
        root,
        enabled: true,
        pasted: PASTED,
        text: fileText({ access_token: SUB }),
      })
      await expect(wrapper.getApiKey()).resolves.toBe(SUB)
      await writeAuthFile(root, fileText({ access_token: 'opaque rotation value b822e1' }))
      await expect(wrapper.redactionKeys()).resolves.toEqual([
        PASTED,
        'opaque rotation value b822e1',
        SUB,
      ])
    })
  })
  it('hands both credentials to persistence boundaries, never throwing', async () => {
    await usingTempDir('subcred-both-', async (root) => {
      const wrapper = await credential({
        root,
        enabled: true,
        pasted: PASTED,
        text: fileText({ access_token: SUB }),
      })
      await expect(wrapper.redactionKeys()).resolves.toEqual([PASTED, SUB])
    })
    await usingTempDir('subcred-refusing-', async (root) => {
      const refusing = await credential({ root, enabled: true, pasted: PASTED, text: undefined })
      await expect(refusing.redactionKeys()).resolves.toEqual([PASTED])
    })
    // A store that is down (StoreUnavailableError) contributes no literal:
    // only a genuinely unavailable OS store proves it, so the case lives
    // in docs/real-life/unproven.md with its real-life steps.
  })
})

describe('CredentialStore with a subscription', () => {
  it('counts the opted-in subscription as a Model API credential', async () => {
    await expect(
      store({ pasted: undefined, subscribed: true }).hasModelApiCredential(),
    ).resolves.toBe(true)
  })
  it('stays unavailable without any credential', async () => {
    await expect(
      store({ pasted: undefined, subscribed: false }).hasModelApiCredential(),
    ).resolves.toBe(false)
  })
  it('keeps working with no subscription hook', async () => {
    const plain = new CredentialStore(mapSecretsBacked(new Map<string, string>()), () => undefined)
    await expect(plain.hasModelApiCredential()).resolves.toBe(false)
  })
})

it.each([
  [
    String.raw`D:\Users\Fake\..\fake\.config\muse\auth.json`,
    'd:/users/fake/.config/muse/auth.json',
  ],
  [
    String.raw`\\Server\Share\Users\Fake\..\fake\muse\auth.json`,
    '//server/share/users/fake/muse/auth.json',
  ],
])('resolves and case-folds Windows sign-in identity %s', (input, expected) => {
  expect(subscriptionAccountId(input)).toBe(subscriptionAccountId(expected))
})
