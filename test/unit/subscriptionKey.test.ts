// C-M95-SUB: the subscription key source. Fakes only: every fixture is
// built in a temp dir or an in-memory file map. No real CLI auth file is
// ever read here.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readSubscriptionKeyText,
  resolveModelApiCredential,
  subscriptionKeyRefusal,
  SubscriptionKeyError,
  SubscriptionKeySource,
  type SubscriptionKeyFileState,
  type SubscriptionKeySourceDeps,
} from '../../src/core/backends/modelapi/subscriptionKey'
import { UI_TEXT } from '../../src/shared/constants'

const CANARY = 'LLM_SUBSCRIPTION_CANARY_9f8e7d6c5b4a'
const OTHER = 'LLM_SUBSCRIPTION_OTHER_1a2b3c4d5e6f'

function fileText(meta: unknown, version = 1): string {
  return JSON.stringify({ schema_version: version, providers: { meta } })
}

function memoryDeps(files: Map<string, string>, states: Map<string, SubscriptionKeyFileState>) {
  let reads = 0
  const deps: SubscriptionKeySourceDeps = {
    platform: 'linux',
    homeDir: '/home/user',
    xdgConfigHome: undefined,
    readFile: (file: string) => {
      reads += 1
      const text = files.get(file)
      return text === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(text)
    },
    stat: (file: string) => {
      const state = states.get(file)
      return state === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(state)
    },
  }
  return { deps, reads: () => reads }
}

function seed(files: Map<string, string>, states: Map<string, SubscriptionKeyFileState>) {
  return {
    write(file: string, text: string, state: SubscriptionKeyFileState) {
      files.set(file, text)
      states.set(file, state)
    },
  }
}

describe('readSubscriptionKeyText', () => {
  it('takes api_key first', () => {
    expect(readSubscriptionKeyText(fileText({ api_key: CANARY, access_token: OTHER }))).toEqual({
      status: 'ready',
      key: CANARY,
    })
  })
  it('falls back to a lone access_token', () => {
    expect(readSubscriptionKeyText(fileText({ access_token: CANARY }))).toEqual({
      status: 'ready',
      key: CANARY,
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
  it.each([{ api_key: '' }, { api_key: '  ' }, { api_key: 'a\rb' }, { api_key: 'a\nb' }])(
    'reads unsigned for an unusable key %o',
    (meta) => {
      expect(readSubscriptionKeyText(fileText(meta))).toEqual({
        status: 'unsigned',
        key: undefined,
      })
    },
  )
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
    expect(source.path().replaceAll('\\', '/')).toBe(expected.replaceAll('\\', '/'))
  })
  it('reads a real temp config home through the resolved path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'subkey-path-'))
    try {
      await writeFile(path.join(root, 'auth.json'), fileText({ api_key: CANARY }))
      const source = new SubscriptionKeySource({
        platform: 'linux',
        homeDir: '/none',
        xdgConfigHome: root,
      })
      expect(source.path()).toBe(path.join(root, 'muse', 'auth.json'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('reports missing without touching the reader', async () => {
    const { deps, reads } = memoryDeps(new Map(), new Map())
    const source = new SubscriptionKeySource(deps)
    expect(await source.read()).toEqual({ status: 'missing', key: undefined })
    expect(reads()).toBe(0)
  })
  it('caches by size and mtime, and reloads on rotation', async () => {
    const files = new Map<string, string>()
    const states = new Map<string, SubscriptionKeyFileState>()
    const { deps, reads } = memoryDeps(files, states)
    const { write } = seed(files, states)
    const source = new SubscriptionKeySource({ ...deps, homeDir: '/home/u' })
    const file = source.path()
    write(file, fileText({ api_key: CANARY }), { size: 10, mtimeMs: 1000 })
    expect(await source.read()).toEqual({ status: 'ready', key: CANARY })
    expect(await source.read()).toEqual({ status: 'ready', key: CANARY })
    expect(reads()).toBe(1)
    write(file, fileText({ api_key: OTHER }), { size: 11, mtimeMs: 2000 })
    expect(await source.read()).toEqual({ status: 'ready', key: OTHER })
    expect(reads()).toBe(2)
  })
  it('refuses an oversized file without reading it', async () => {
    const files = new Map<string, string>()
    const states = new Map<string, SubscriptionKeyFileState>()
    const { deps, reads } = memoryDeps(files, states)
    const source = new SubscriptionKeySource(deps)
    states.set(source.path(), { size: 64 * 1024 + 1, mtimeMs: 1 })
    expect(await source.read()).toEqual({ status: 'unreadable', key: undefined })
    expect(reads()).toBe(0)
  })
  it('redacts the cached key and nothing else', async () => {
    const files = new Map<string, string>()
    const states = new Map<string, SubscriptionKeyFileState>()
    const { deps } = memoryDeps(files, states)
    const source = new SubscriptionKeySource(deps)
    expect(source.redact(`holds ${CANARY} here`)).toBe(`holds ${CANARY} here`)
    seed(files, states).write(source.path(), fileText({ api_key: CANARY }), {
      size: 10,
      mtimeMs: 1,
    })
    await source.read()
    expect(source.redact(`holds ${CANARY} and ${CANARY} here ${OTHER}`)).toBe(
      `holds [redacted] and [redacted] here ${OTHER}`,
    )
  })
})

function resolver(options: {
  enabled: boolean
  pasted: string | undefined
  text: string | undefined
}) {
  const files = new Map<string, string>()
  const states = new Map<string, SubscriptionKeyFileState>()
  const source = new SubscriptionKeySource({
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    readFile: (file: string) => {
      const text = files.get(file)
      return text === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(text)
    },
    stat: (file: string) => {
      const state = states.get(file)
      return state === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(state)
    },
  })
  if (options.text !== undefined) {
    seed(files, states).write(source.path(), options.text, { size: 9, mtimeMs: 7 })
  }
  return resolveModelApiCredential({
    readPastedKey: () => Promise.resolve(options.pasted),
    isSubscriptionEnabled: () => options.enabled,
    subscription: source,
  })
}

describe('resolveModelApiCredential', () => {
  it('uses the pasted key while the opt-in is off', async () => {
    await expect(
      resolver({ enabled: false, pasted: 'pasted-key', text: fileText({ api_key: CANARY }) }),
    ).resolves.toEqual({ kind: 'key', key: 'pasted-key', billing: 'payAsYouGo' })
  })
  it('reports none while off with no pasted key', async () => {
    await expect(resolver({ enabled: false, pasted: undefined, text: undefined })).resolves.toEqual(
      { kind: 'none' },
    )
  })
  it('prefers the subscription key while on', async () => {
    await expect(
      resolver({ enabled: true, pasted: 'pasted-key', text: fileText({ api_key: CANARY }) }),
    ).resolves.toEqual({ kind: 'key', key: CANARY, billing: 'museCodePlan' })
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
  it('scans every output for the planted key', async () => {
    const files = new Map<string, string>()
    const states = new Map<string, SubscriptionKeyFileState>()
    const { deps } = memoryDeps(files, states)
    const source = new SubscriptionKeySource(deps)
    seed(files, states).write(source.path(), fileText({ api_key: CANARY }), {
      size: 10,
      mtimeMs: 1,
    })
    const read = await source.read()
    const outputs = [
      subscriptionKeyRefusal('missing'),
      subscriptionKeyRefusal('unreadable'),
      subscriptionKeyRefusal('keychain'),
      JSON.stringify({ ...read, key: read.key === undefined ? undefined : 'PRESENT' }),
      source.redact(`prefix ${CANARY} suffix`),
      source.digestFor(CANARY),
      String(new SubscriptionKeyError('unsigned')),
    ]
    for (const output of outputs) {
      expect(output).not.toContain(CANARY)
    }
    expect(outputs.some((output) => output.includes('[redacted]'))).toBe(true)
  })
})
