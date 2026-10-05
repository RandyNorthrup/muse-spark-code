// Lane P: the endpoint policy, credential records, PKCE and providers.json
// (M95, D74). No network, no storage of real secrets: answers and keys are
// injected or synthetic.

import * as fsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isCredentialBound,
  parseCredentialRecord,
  type CredentialAuth,
  type CredentialRecord,
} from '../../src/core/providers/credentialRecord'
import {
  checkEndpointUrl,
  classifyAddress,
  originOf,
  verifyRequestAnswers,
} from '../../src/core/providers/endpointPolicy'
import {
  base64Url,
  createPkcePair,
  isPkceState,
  isPkceVerifier,
  pkceChallenge,
} from '../../src/core/providers/pkce'
import {
  emptyProvidersFile,
  readProvidersFile,
  userPriceCard,
  writeProvidersFileAtomic,
  type OpenRouterRouting,
  type ProviderAuth,
  type ProviderEntry,
  type ProvidersFile,
  type UserPriceCard,
} from '../../src/core/providers/providersFile'

vi.mock('node:fs/promises', { spy: true })

describe('classifyAddress', () => {
  it('tells loopback, private, link-local and metadata apart', () => {
    expect(classifyAddress('127.0.0.1')).toBe('loopback')
    expect(classifyAddress('127.200.10.5')).toBe('loopback')
    expect(classifyAddress('::1')).toBe('loopback')
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback')
    expect(classifyAddress('10.1.2.3')).toBe('private')
    expect(classifyAddress('172.16.0.1')).toBe('private')
    expect(classifyAddress('172.31.255.255')).toBe('private')
    expect(classifyAddress('192.168.1.1')).toBe('private')
    expect(classifyAddress('100.100.100.200')).toBe('private')
    expect(classifyAddress('fc00::1')).toBe('private')
    expect(classifyAddress('169.254.10.20')).toBe('link-local')
    expect(classifyAddress('fe80::1')).toBe('link-local')
    expect(classifyAddress('169.254.169.254')).toBe('metadata')
    expect(classifyAddress('168.63.129.16')).toBe('metadata')
    expect(classifyAddress('fd00:ec2::254')).toBe('metadata')
    expect(classifyAddress('8.8.8.8')).toBe('public')
    expect(classifyAddress('2606:4700:4700::1111')).toBe('public')
  })

  it('classifies IPv6 by value, never by a dotted suffix', () => {
    for (const [address, expected] of [
      ['fe80::8.8.8.8', 'link-local'],
      ['fc00::127.0.0.1', 'private'],
      ['fc00::7f00:1', 'private'],
      ['fd00:ec2:0:0:0:0:0:254', 'metadata'],
      ['FD00:0EC2::0254', 'metadata'],
      ['::ffff:7f00:1', 'loopback'],
      ['0:0:0:0:0:ffff:a9fe:a9fe', 'metadata'],
      ['::7f00:1', 'loopback'],
      ['64:ff9b::a9fe:a9fe', 'metadata'],
      ['64:ff9b::10.0.0.1', 'private'],
      ['64:ff9b::808:808', 'public'],
    ]) {
      expect(classifyAddress(address ?? ''), address).toBe(expected)
    }
    expect(checkEndpointUrl('http://[fc00::7f00:1]:8080', ['fc00::127.0.0.1']).kind).toBe('refused')
    expect(verifyRequestAnswers('private', ['fd00:ec2:0:0:0:0:0:254']).ok).toBe(false)
  })

  it('refuses the unspecified address, zones and non-addresses', () => {
    expect(classifyAddress('0.0.0.0')).toBe('unusable')
    expect(classifyAddress('::')).toBe('unusable')
    expect(classifyAddress('fe80::1%eth0')).toBe('unusable')
    expect(classifyAddress('not-an-address')).toBe('unusable')
    expect(classifyAddress('224.0.0.1')).toBe('unusable')
  })
})

describe('checkEndpointUrl', () => {
  it('allows loopback HTTP and HTTPS as local', () => {
    expect(checkEndpointUrl('http://127.0.0.1:11434/v1', ['127.0.0.1'])).toEqual({
      kind: 'ok',
      origin: 'http://127.0.0.1:11434',
      network: 'local',
    })
    expect(checkEndpointUrl('http://localhost:1234/v1', ['127.0.0.1', '::1'])).toMatchObject({
      kind: 'ok',
    })
  })

  it('allows public HTTPS and refuses plain HTTP off loopback', () => {
    expect(checkEndpointUrl('https://api.openai.com/v1', ['93.184.215.14'])).toEqual({
      kind: 'ok',
      origin: 'https://api.openai.com',
      network: 'public',
    })
    // eslint-disable-next-line unicorn/prefer-https -- the refused address is plain http on purpose
    expect(checkEndpointUrl('http://api.openai.com/v1', ['93.184.215.14'])).toEqual({
      kind: 'refused',
      reason: 'http-off-loopback',
    })
  })

  it('restricts HTTP hostnames to localhost even with loopback answers', () => {
    const insecure = new URL('https://provider.example/v1')
    insecure.protocol = 'http:'
    expect(checkEndpointUrl(insecure.href, ['127.0.0.1'])).toEqual({
      kind: 'refused',
      reason: 'http-off-loopback',
    })
    expect(checkEndpointUrl('http://[::1]/v1', ['::1']).kind).toBe('ok')
    expect(checkEndpointUrl('http://localhost/v1', ['127.0.0.1', '::1']).kind).toBe('ok')
  })

  it('asks once for private HTTPS and records nothing yet', () => {
    expect(checkEndpointUrl('https://nas.lan:8443/v1', ['192.168.1.10'])).toEqual({
      kind: 'confirm-private',
      origin: 'https://nas.lan:8443',
    })
  })

  it('refuses userinfo, queries, fragments and odd schemes', () => {
    expect(checkEndpointUrl('https://user@api.openai.com/v1', ['93.184.215.14']).kind).toBe(
      'refused',
    )
    expect(checkEndpointUrl('https://api.openai.com/v1?x=1', ['93.184.215.14'])).toEqual({
      kind: 'refused',
      reason: 'has-query',
    })
    expect(checkEndpointUrl('https://api.openai.com/v1#frag', ['93.184.215.14'])).toEqual({
      kind: 'refused',
      reason: 'has-fragment',
    })
    expect(checkEndpointUrl('ftp://api.openai.com/v1', ['93.184.215.14'])).toEqual({
      kind: 'refused',
      reason: 'unsupported-scheme',
    })
  })

  it('refuses link-local, metadata and localhost resolving elsewhere', () => {
    expect(checkEndpointUrl('http://169.254.10.20:8080/', ['169.254.10.20'])).toEqual({
      kind: 'refused',
      reason: 'link-local',
    })
    expect(checkEndpointUrl('http://169.254.169.254/', ['169.254.169.254'])).toEqual({
      kind: 'refused',
      reason: 'metadata',
    })
    expect(checkEndpointUrl('http://localhost:8080/', ['127.0.0.1', '192.168.1.5'])).toEqual({
      kind: 'refused',
      reason: 'mixed-answers',
    })
    expect(checkEndpointUrl('https://provider.example/', ['93.184.215.14', '10.0.0.5'])).toEqual({
      kind: 'refused',
      reason: 'mixed-answers',
    })
  })
})

describe('verifyRequestAnswers', () => {
  it('holds the saved network and refuses rebinding', () => {
    expect(verifyRequestAnswers('public', ['93.184.215.14'])).toEqual({ ok: true })
    expect(verifyRequestAnswers('public', ['10.0.0.5']).ok).toBe(false)
    expect(verifyRequestAnswers('local', ['127.0.0.1'])).toEqual({ ok: true })
    expect(verifyRequestAnswers('local', ['93.184.215.14']).ok).toBe(false)
    expect(verifyRequestAnswers('private', ['192.168.1.10'])).toEqual({ ok: true })
    expect(verifyRequestAnswers('private', ['169.254.169.254'])).toEqual({
      ok: false,
      reason: 'metadata',
    })
  })
})

describe('originOf', () => {
  it('normalizes origins for credential binding', () => {
    expect(originOf('HTTPS://API.OPENAI.COM:443/v1')).toBe('https://api.openai.com')
    expect(originOf('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434')
    expect(originOf('https://api.openai.com/v1?x=1')).toBeUndefined()
  })
})

describe('credentialRecord', () => {
  const auth: CredentialAuth = 'apiKey'
  const record: CredentialRecord = { v: 1, auth, origin: 'https://api.openai.com' }

  it('parses the record and refuses anything else', () => {
    expect(parseCredentialRecord(record)).toEqual(record)
    expect(parseCredentialRecord({ v: 1, auth: 'apiKey' })).toBeUndefined()
    expect(
      parseCredentialRecord({ v: 2, auth: 'apiKey', origin: 'https://api.openai.com' }),
    ).toBeUndefined()
    expect(parseCredentialRecord('https://api.openai.com')).toBeUndefined()
  })

  it('binds the exact origin: scheme, name and port all count', () => {
    expect(isCredentialBound(record, 'https://api.openai.com/v1/responses')).toBe(true)
    // An edited file moving the endpoint refuses, naming both origins.
    expect(isCredentialBound(record, 'https://api.openai.com:8443/v1')).toBe(false)
    // eslint-disable-next-line unicorn/prefer-https -- the downgraded scheme is the attack
    expect(isCredentialBound(record, 'http://api.openai.com/v1')).toBe(false)
    expect(isCredentialBound(record, 'https://evil.example/v1')).toBe(false)
  })
})

function zeroBytes(count: number): Uint8Array {
  return new Uint8Array(count)
}

describe('pkce', () => {
  it('builds a verifier, its S256 challenge and state from injected bytes', () => {
    const pair = createPkcePair(zeroBytes)
    expect(pair.verifier).toBe('A'.repeat(43))
    expect(pair.challenge).toBe(pkceChallenge(pair.verifier))
    expect(pair.challenge).toMatch(/^[A-Za-z0-9\-_]{43}$/)
    expect(isPkceVerifier(pair.verifier)).toBe(true)
    expect(isPkceState(pair.state)).toBe(true)
    // The RFC 7636 appendix B vector, recomputed here.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('rejects malformed verifiers and states', () => {
    expect(isPkceVerifier('short')).toBe(false)
    expect(isPkceVerifier('A'.repeat(43) + ' ')).toBe(false)
    expect(isPkceState('ok-state-secret-16')).toBe(true)
    expect(isPkceState('tiny')).toBe(false)
    expect(base64Url(new Uint8Array([255, 254]))).toBe('__4')
  })

  it('draws fresh secrets from real random bytes', () => {
    const first = createPkcePair()
    const second = createPkcePair()
    expect(first.verifier).not.toBe(second.verifier)
    expect(isPkceVerifier(first.verifier)).toBe(true)
  })
})

describe('providersFile', () => {
  let dir = ''
  afterEach(async () => {
    vi.restoreAllMocks()
    if (dir === '') {
      return
    }

    await rm(dir, { recursive: true, force: true })
    dir = ''
  })

  const auth: ProviderAuth = 'apiKey'
  const routing: OpenRouterRouting = { privacy: 'zdr', allowFallbacks: true }
  const entry: ProviderEntry = {
    id: 'openai',
    preset: 'openai',
    address: 'https://api.openai.com',
    auth,
    models: ['gpt-5.6-luna'],
    pinned: ['gpt-5.6-luna'],
  }
  const file: ProvidersFile = {
    v: 1,
    defaultModel: 'openai/gpt-5.6-luna',
    providers: [entry],
  }
  const userPrices: Record<string, UserPriceCard> = {
    'gpt-5.6-luna': { input: 2e-6, output: 8e-6 },
  }

  it('starts empty, round-trips atomically and reads back', async () => {
    expect(emptyProvidersFile()).toEqual({ v: 1, providers: [] })
    dir = await mkdtemp(path.join(tmpdir(), 'providers-'))
    const filePath = path.join(dir, 'muse-spark-code', 'providers.json')
    expect(await readProvidersFile(filePath)).toMatchObject({ ok: false, reason: 'missing' })
    expect(await writeProvidersFileAtomic(filePath, file)).toEqual({ ok: true })
    const read = await readProvidersFile(filePath)
    expect(read).toEqual({ ok: true, file })
  })

  it('keeps simultaneous saves isolated with adjacent temporary files', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'providers-'))
    vi.spyOn(Date, 'now').mockReturnValue(1)
    const firstPath = path.join(dir, 'a.json')
    const secondPath = path.join(dir, 'b.json')
    const second = { ...file, defaultModel: 'openai/other' }
    expect(
      await Promise.all([
        writeProvidersFileAtomic(firstPath, file),
        writeProvidersFileAtomic(secondPath, second),
      ]),
    ).toEqual([{ ok: true }, { ok: true }])
    expect(await readProvidersFile(firstPath)).toEqual({ ok: true, file })
    expect(await readProvidersFile(secondPath)).toEqual({ ok: true, file: second })
    const files = await readdir(dir)
    expect(files.toSorted((a, b) => a.localeCompare(b))).toEqual(['a.json', 'b.json'])
  })

  it('cleans an adjacent temporary file when rename fails', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'providers-'))
    const rename = vi.spyOn(fsPromises, 'rename')
    const destination = path.join(dir, 'occupied')
    await mkdir(destination)
    expect(await writeProvidersFileAtomic(destination, file)).toMatchObject({
      ok: false,
      reason: 'io-error',
    })
    const temporary = rename.mock.calls.at(0)?.[0]
    expect(typeof temporary).toBe('string')
    expect(path.dirname(String(temporary))).toBe(dir)
    expect(await readdir(dir)).toEqual(['occupied'])
  })

  it('requires custom model windows and output caps and preserves them on reload', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'providers-'))
    const filePath = path.join(dir, 'custom.json')
    const custom = { ...entry, id: 'custom', preset: 'custom', models: ['unknown'] }
    const missing = { v: 1, providers: [custom] }
    expect(await writeProvidersFileAtomic(filePath, missing)).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    for (const limits of [
      { contextTokens: 0, outputTokens: 1 },
      { contextTokens: 100, outputTokens: -1 },
      { contextTokens: 100.5, outputTokens: 1 },
      { contextTokens: 100, outputTokens: 101 },
      { contextTokens: Infinity, outputTokens: 1 },
    ]) {
      expect(
        await writeProvidersFileAtomic(filePath, {
          v: 1,
          providers: [{ ...custom, modelLimits: { unknown: limits } }],
        }),
      ).toMatchObject({ ok: false, reason: 'invalid' })
    }
    const valid = {
      v: 1,
      providers: [
        { ...custom, modelLimits: { unknown: { contextTokens: 32_768, outputTokens: 4096 } } },
      ],
    }
    expect(await writeProvidersFileAtomic(filePath, valid)).toEqual({ ok: true })
    expect(await readProvidersFile(filePath)).toEqual({ ok: true, file: valid })
  })

  it('reports unparseable and invalid files without repairing them', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'providers-'))
    const bad = path.join(dir, 'bad.json')
    const wrong = path.join(dir, 'wrong.json')
    await writeProvidersFileAtomic(bad, file)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(bad, '{oops', 'utf8')
    await writeFile(wrong, '{"v":1,"providers":[{"id":"meta"}]}', 'utf8')
    expect(await readProvidersFile(bad)).toMatchObject({ ok: false, reason: 'unparseable' })
    expect(await readProvidersFile(wrong)).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('reads user-entered prices and routing as sourced cards', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'providers-'))
    const filePath = path.join(dir, 'providers.json')
    const routerEntry: ProviderEntry = {
      id: 'openrouter',
      preset: 'openrouter',
      address: 'https://openrouter.ai',
      auth,
      models: ['openai/gpt-oss-20b'],
      prices: userPrices,
      routing,
    }
    expect(await writeProvidersFileAtomic(filePath, { v: 1, providers: [routerEntry] })).toEqual({
      ok: true,
    })
    const read = await readProvidersFile(filePath)
    expect(read.ok && read.file.providers[0]?.routing).toEqual(routing)
    const card = userPriceCard(userPrices, 'gpt-5.6-luna')
    expect(card).toMatchObject({ input: 2e-6, output: 8e-6, source: 'user' })
    expect(userPriceCard(userPrices, 'no-such-model')).toBeUndefined()
  })

  it('refuses to write an invalid value before touching the disk', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'providers-'))
    const filePath = path.join(dir, 'providers.json')
    const written = await writeProvidersFileAtomic(filePath, { v: 2, providers: [] })
    expect(written).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await readProvidersFile(filePath)).toMatchObject({ ok: false, reason: 'missing' })
  })
})
