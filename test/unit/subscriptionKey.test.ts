// C-M95-SUB: the subscription key source. Every fixture is a real file
// in a real temp dir; no real CLI auth file is ever read here.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readSubscriptionKeyText,
  resolveModelApiCredential,
  subscriptionKeyRefusal,
  SubscriptionKeyError,
  SubscriptionKeySource,
} from '../../src/core/backends/modelapi/subscriptionKey'
import { redactSecrets } from '../../src/shared/redact'
import { MUSE_CREDENTIAL_FILE_MAX_BYTES, UI_TEXT } from '../../src/shared/constants'
import { AUTH_SET_FILE, DEVICE_LOGIN_FILE } from './helpers/credentialShapes'
import { denyAccess } from './helpers/deniedAccess'
import { usingTempDir } from './helpers/temporaryFolders'

const CANARY = 'LLM_SUBSCRIPTION_CANARY_9f8e7d6c5b4a'
const OTHER = 'LLM_SUBSCRIPTION_OTHER_1a2b3c4d5e6f'
// An opaque subscription value no shape pattern matches: only the exact
// literal read from the sign-in can scrub it (P1-2's whole point).
const OPAQUE = 'opaque subscription value 7f3a9c2e'

function fileText(meta: unknown, version = 1): string {
  return JSON.stringify({ schema_version: version, providers: { meta } })
}

/** Separators differ by OS; every path comparison in this file goes through here. */
function normalisePath(value: string): string {
  return value.replaceAll('\\', '/')
}

/** A source over an empty temp config home: nothing of the person's is read. */
function tempSource(root: string): SubscriptionKeySource {
  return new SubscriptionKeySource({ platform: 'linux', homeDir: '/none', xdgConfigHome: root })
}

/** The auth file lands where the resolved path says, on every OS. */
async function writeAuthFile(source: SubscriptionKeySource, text: string): Promise<string> {
  const file = source.path()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
  return file
}

describe('readSubscriptionKeyText', () => {
  it('sends the subscription access_token from a device sign-in', () => {
    expect(readSubscriptionKeyText(DEVICE_LOGIN_FILE)).toEqual({
      status: 'ready',
      key: '<placeholder>',
    })
    expect(readSubscriptionKeyText(fileText({ access_token: CANARY }))).toEqual({
      status: 'ready',
      key: CANARY,
    })
  })
  it('sends access_token, never a pay-as-you-go api_key beside it', () => {
    expect(readSubscriptionKeyText(fileText({ api_key: OTHER, access_token: CANARY }))).toEqual({
      status: 'ready',
      key: CANARY,
    })
  })
  it('refuses a pay-as-you-go muse auth set file as unsigned', () => {
    // P1: an ordinary card-billed `muse auth set` key must never read as
    // the subscription credential.
    expect(readSubscriptionKeyText(AUTH_SET_FILE)).toEqual({ status: 'unsigned', key: undefined })
    expect(readSubscriptionKeyText(fileText({ api_key: CANARY }))).toEqual({
      status: 'unsigned',
      key: undefined,
    })
  })
  it('reads unsigned for a signed-out shell or a connector-only file', () => {
    expect(readSubscriptionKeyText(JSON.stringify({ schema_version: 1, providers: {} }))).toEqual({
      status: 'unsigned',
      key: undefined,
    })
    expect(
      readSubscriptionKeyText(fileText({ api_key: CANARY }).replace('"meta"', '"slack_connector"')),
    ).toEqual({ status: 'unsigned', key: undefined })
  })
  it('reads keychain for a pointer file or a keychain lane', () => {
    expect(readSubscriptionKeyText(fileText({ api_key: CANARY }, 2))).toEqual({
      status: 'keychain',
      key: undefined,
    })
    expect(readSubscriptionKeyText(fileText({ storage: 'keychain', api_key: CANARY }))).toEqual({
      status: 'keychain',
      key: undefined,
    })
  })
  it.each(['not json{', '[1,2]', '"just a string"', '{"schema_version": 9, "providers": {}}'])(
    'reads unreadable for %s',
    (text) => {
      expect(readSubscriptionKeyText(text)).toEqual({ status: 'unreadable', key: undefined })
    },
  )
  it.each([
    { access_token: '' },
    { access_token: '  ' },
    { access_token: 'a\rb' },
    { access_token: 'a\nb' },
    { api_key: CANARY },
  ])('reads unsigned for an unusable key %o', (meta) => {
    expect(readSubscriptionKeyText(fileText(meta))).toEqual({
      status: 'unsigned',
      key: undefined,
    })
  })
})

describe('SubscriptionKeySource', () => {
  it.each([
    ['win32', String.raw`C:\Users\r`, undefined, String.raw`C:\Users\r\.config\muse\auth.json`],
    ['win32', String.raw`C:\Users\r`, String.raw`D:\cfg`, String.raw`D:\cfg\muse\auth.json`],
    ['darwin', '/Users/r', undefined, '/Users/r/.config/muse/auth.json'],
    ['linux', '/home/r', undefined, '/home/r/.config/muse/auth.json'],
    ['linux', '/home/r', '/tmp/xdg', '/tmp/xdg/muse/auth.json'],
  ] as const)('resolves the CLI auth file on %s', (platform, homeDir, xdg, expected) => {
    const source = new SubscriptionKeySource({
      platform,
      homeDir,
      xdgConfigHome: xdg,
    })
    expect(normalisePath(source.path())).toBe(normalisePath(expected))
  })
  it('reads a real temp config home through the resolved path', async () => {
    // A real filesystem round-trip: the fixture lands where the resolved
    // path says, and read() (not only path()) parses it. Both sides
    // normalise separators so the comparison holds on Windows too.
    const root = await mkdtemp(path.join(tmpdir(), 'subkey-path-'))
    try {
      await mkdir(path.join(root, 'muse'), { recursive: true })
      await writeFile(path.join(root, 'muse', 'auth.json'), fileText({ access_token: CANARY }))
      const source = new SubscriptionKeySource({
        platform: 'linux',
        homeDir: '/none',
        xdgConfigHome: root,
      })
      expect(normalisePath(source.path())).toBe(normalisePath(path.join(root, 'muse', 'auth.json')))
      expect(await source.read()).toEqual({ status: 'ready', key: CANARY })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('reads a missing auth file as missing', async () => {
    await usingTempDir('subkey-missing-', async (root) => {
      const source = tempSource(root)
      expect(await source.read()).toEqual({ status: 'missing', key: undefined })
    })
  })
  it('reads a file blocking the config dir as missing', async () => {
    // ENOTDIR on POSIX, ENOENT on Windows: either way the file is not there.
    await usingTempDir('subkey-notdir-', async (root) => {
      const source = tempSource(root)
      const dir = path.dirname(source.path())
      await mkdir(path.dirname(dir), { recursive: true })
      await writeFile(dir, 'a file where the muse dir belongs')
      expect(await source.read()).toEqual({ status: 'missing', key: undefined })
    })
  })
  it('reads an unreadable auth file as unreadable', async () => {
    // EACCES on POSIX, EPERM on Windows (deniedAccess): either way a coded
    // failure, never missing.
    await usingTempDir('subkey-denied-', async (root) => {
      const source = tempSource(root)
      await writeAuthFile(source, fileText({ access_token: CANARY }))
      const restore = await denyAccess(path.dirname(source.path()))
      try {
        expect(await source.read()).toEqual({ status: 'unreadable', key: undefined })
      } finally {
        await restore()
      }
    })
  })
  it('reads fresh on every call, so a rotation shows at once', async () => {
    await usingTempDir('subkey-rotation-', async (root) => {
      const source = tempSource(root)
      await writeAuthFile(source, fileText({ access_token: CANARY }))
      expect(await source.read()).toEqual({ status: 'ready', key: CANARY })
      await writeAuthFile(source, fileText({ access_token: OTHER }))
      expect(await source.read()).toEqual({ status: 'ready', key: OTHER })
    })
  })
  it('refuses an oversized file even when its text would parse', async () => {
    // The text would read ready if the parse decided: only the size guard
    // can refuse it. Repetition is size mechanics, not content.
    await usingTempDir('subkey-oversized-', async (root) => {
      const source = tempSource(root)
      const text = fileText({
        access_token: `${CANARY}${'x'.repeat(MUSE_CREDENTIAL_FILE_MAX_BYTES)}`,
      })
      expect(text.length).toBeGreaterThan(MUSE_CREDENTIAL_FILE_MAX_BYTES)
      await writeAuthFile(source, text)
      expect(await source.read()).toEqual({ status: 'unreadable', key: undefined })
    })
  })
  it('retains nothing between reads', async () => {
    await usingTempDir('subkey-noretain-', async (root) => {
      const source = tempSource(root)
      const file = await writeAuthFile(source, fileText({ access_token: CANARY }))
      expect(await source.read()).toEqual({ status: 'ready', key: CANARY })
      await rm(file)
      expect(await source.read()).toEqual({ status: 'missing', key: undefined })
    })
  })
})

function resolver(options: {
  enabled: boolean
  pasted: string | undefined
  text: string | undefined
}) {
  return usingTempDir('subkey-resolver-', async (root) => {
    const source = tempSource(root)
    if (options.text !== undefined) await writeAuthFile(source, options.text)
    return await resolveModelApiCredential({
      readPastedKey: () => Promise.resolve(options.pasted),
      isSubscriptionEnabled: () => options.enabled,
      subscription: source,
    })
  })
}

describe('resolveModelApiCredential', () => {
  it('uses the pasted key while the opt-in is off', async () => {
    await expect(
      resolver({ enabled: false, pasted: 'pasted-key', text: fileText({ access_token: CANARY }) }),
    ).resolves.toEqual({ kind: 'key', key: 'pasted-key', billing: 'payAsYouGo' })
  })
  it('reports none while off with no pasted key', async () => {
    await expect(resolver({ enabled: false, pasted: undefined, text: undefined })).resolves.toEqual(
      { kind: 'none' },
    )
  })
  it('prefers the subscription key while on', async () => {
    await expect(
      resolver({ enabled: true, pasted: 'pasted-key', text: fileText({ access_token: CANARY }) }),
    ).resolves.toEqual({ kind: 'key', key: CANARY, billing: 'museCodePlan' })
  })
  it('refuses a pay-as-you-go file while on, never billing the card as plan', async () => {
    await expect(
      resolver({ enabled: true, pasted: 'pasted-key', text: AUTH_SET_FILE }),
    ).resolves.toEqual({ kind: 'refused', status: 'unsigned' })
  })
  it('refuses instead of falling back to the pasted key', async () => {
    await expect(
      resolver({ enabled: true, pasted: 'pasted-key', text: undefined }),
    ).resolves.toEqual({ kind: 'refused', status: 'missing' })
    await expect(
      resolver({
        enabled: true,
        pasted: 'pasted-key',
        text: JSON.stringify({ schema_version: 1, providers: {} }),
      }),
    ).resolves.toEqual({ kind: 'refused', status: 'unsigned' })
  })
})

describe('refusals carry no key material', () => {
  it('names each refusal from the table', () => {
    expect(subscriptionKeyRefusal('missing')).toBe(UI_TEXT.subscriptionKey.signInAgain)
    expect(subscriptionKeyRefusal('unsigned')).toBe(UI_TEXT.subscriptionKey.signInAgain)
    expect(subscriptionKeyRefusal('unreadable')).toBe(UI_TEXT.subscriptionKey.cannotRead)
    expect(subscriptionKeyRefusal('keychain')).toBe(UI_TEXT.subscriptionKey.keychainBacked)
  })
  it('scans actual outputs for the planted key', async () => {
    // P3: the canary stays in the values under test — nothing is replaced
    // with a placeholder before scanning. Refusals must never carry it;
    // persisted text scrubbed with the key actually read must not keep it.
    const read = await usingTempDir('subkey-scan-', async (root) => {
      const source = tempSource(root)
      await writeAuthFile(source, fileText({ access_token: CANARY }))
      return await source.read()
    })
    if (read.status !== 'ready') throw new Error('fixture did not read ready')
    const outputs = [
      subscriptionKeyRefusal('missing'),
      subscriptionKeyRefusal('unreadable'),
      subscriptionKeyRefusal('keychain'),
      subscriptionKeyRefusal('unsigned'),
      String(new SubscriptionKeyError('unsigned')),
      UI_TEXT.subscriptionKey.paidNeedsKey,
    ]
    for (const output of outputs) {
      expect(output).not.toContain(CANARY)
    }
    const opaqueRead = await usingTempDir('subkey-opaque-', async (root) => {
      const source = tempSource(root)
      await writeAuthFile(source, fileText({ access_token: OPAQUE }))
      return await source.read()
    })
    if (opaqueRead.status !== 'ready') throw new Error('opaque fixture did not read ready')
    const transcript = JSON.stringify({
      messages: [
        { role: 'user', text: `help me debug with ${OPAQUE} inline` },
        { role: 'assistant', text: `tried Bearer ${OPAQUE} twice` },
      ],
    })
    expect(redactSecrets(transcript, [opaqueRead.key])).not.toContain(OPAQUE)
  })
})
