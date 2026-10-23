import {
  subscriptionAccountId,
  billingKeyDigest,
} from '../../src/core/backends/modelapi/billingRoute'
// C-M95-SUB: the host credential wrapper. Fakes only: an in-memory pasted
// key and an in-memory CLI auth file. No real auth file is ever read here.
import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/shared/redact'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import { memorySubscriptionFile } from './helpers/subscriptionFile'
import { mapSecretsBacked } from './helpers/mapSecrets'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import { StoreUnavailableError } from '../../src/runtime/keyStore'
import { UI_TEXT } from '../../src/shared/constants'

// Opaque values no shape pattern matches: only the exact tracked literal
// can scrub them.
const SUB = 'opaque subscription value 8e2b4a'
const PASTED = 'pasted-payg-key'

function sourceFor(text: string | undefined) {
  const file = memorySubscriptionFile()
  if (text !== undefined) file.writeText(text)
  return file.source
}

function credential(options: {
  enabled: boolean
  pasted: string | undefined
  text: string | undefined
}) {
  return new SubscriptionCredential({
    credentials: { getApiKey: () => Promise.resolve(options.pasted) },
    isEnabled: () => options.enabled,
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    source: sourceFor(options.text),
  })
}

function fileText(meta: unknown): string {
  return JSON.stringify({ schema_version: 1, providers: { meta } })
}

describe('SubscriptionCredential', () => {
  it('freezes a route and refuses instead of replacing it with a pasted key', async () => {
    const file = memorySubscriptionFile()
    file.writeAccessToken(SUB)
    const wrapper = new SubscriptionCredential({
      credentials: { getApiKey: () => Promise.resolve(PASTED) },
      isEnabled: () => true,
      platform: 'linux',
      homeDir: '/home/u',
      xdgConfigHome: undefined,
      source: file.source,
    })
    const route = await wrapper.route()
    expect(Object.isFrozen(route)).toBe(true)
    expect(route?.kind).toBe('museCodePlan')
    expect(route?.accountId).not.toBe(billingKeyDigest(SUB))
    file.writeText(fileText({ api_key: PASTED }))
    await expect(wrapper.route()).rejects.toThrow(UI_TEXT.subscriptionKey.signInAgain)
    expect(route?.credential).toBe(SUB)
    await expect(wrapper.route(true)).resolves.toMatchObject({
      kind: 'payAsYouGo',
      credential: PASTED,
    })
  })
  it('normalizes Windows separators for the stable subscription identity', () => {
    expect(subscriptionAccountId(String.raw`C:\Users\fake\.config\muse\auth.json`)).toBe(
      subscriptionAccountId('C:/Users/fake/.config/muse/auth.json'),
    )
  })
  it('uses the pasted key while the opt-in is off', async () => {
    const wrapper = credential({ enabled: false, pasted: PASTED, text: fileText({ api_key: SUB }) })
    await expect(wrapper.getApiKey()).resolves.toBe(PASTED)
    await expect(wrapper.isSubscriptionBilling()).resolves.toBe(false)
    await expect(wrapper.hasCredential()).resolves.toBe(true)
  })
  it('reports no credential while off with nothing stored', async () => {
    const wrapper = credential({ enabled: false, pasted: undefined, text: undefined })
    await expect(wrapper.getApiKey()).resolves.toBeUndefined()
    await expect(wrapper.hasCredential()).resolves.toBe(false)
  })
  it('uses the subscription key while on', async () => {
    const wrapper = credential({
      enabled: true,
      pasted: PASTED,
      text: fileText({ access_token: SUB }),
    })
    await expect(wrapper.getApiKey()).resolves.toBe(SUB)
    await expect(wrapper.isSubscriptionBilling()).resolves.toBe(true)
    await expect(wrapper.hasCredential()).resolves.toBe(true)
  })
  it('refuses a pay-as-you-go file while on, even with a pasted key stored', async () => {
    const wrapper = credential({
      enabled: true,
      pasted: PASTED,
      text: fileText({ api_key: SUB }),
    })
    await expect(wrapper.getApiKey()).rejects.toThrow(UI_TEXT.subscriptionKey.signInAgain)
    await expect(wrapper.isSubscriptionBilling()).resolves.toBe(false)
    await expect(wrapper.hasCredential()).resolves.toBe(false)
  })
  it('throws the refusal, without the key, while on and signed out', async () => {
    const wrapper = credential({ enabled: true, pasted: PASTED, text: undefined })
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

function store(options: { pasted: string | undefined; subscribed: boolean }) {
  const secrets = new Map<string, string>()
  if (options.pasted !== undefined) secrets.set('museSpark.modelApiKey', options.pasted)
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
    const wrapper = credential({
      enabled: true,
      pasted: PASTED,
      text: fileText({ access_token: SUB }),
    })
    await wrapper.getApiKey()
    expect(redactSecrets(`saw ${SUB} in a log line`)).not.toContain(SUB)
  })
  it('hands both credentials to persistence boundaries, never throwing', async () => {
    const wrapper = credential({
      enabled: true,
      pasted: PASTED,
      text: fileText({ access_token: SUB }),
    })
    await expect(wrapper.redactionKeys()).resolves.toEqual([PASTED, SUB])
    const refusing = credential({ enabled: true, pasted: PASTED, text: undefined })
    await expect(refusing.redactionKeys()).resolves.toEqual([PASTED])
    const failing = new SubscriptionCredential({
      credentials: {
        getApiKey: () => Promise.reject(new StoreUnavailableError()),
      },
      isEnabled: () => true,
      platform: 'linux',
      homeDir: '/home/u',
      xdgConfigHome: undefined,
      source: sourceFor(undefined),
    })
    await expect(failing.redactionKeys()).resolves.toEqual([])
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
