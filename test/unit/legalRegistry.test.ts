// M97 lane R: the optional registry reader against a scripted fetch fake.
// The response bodies served here are the live captures (2026-10-04,
// macmini): npm's version document for is-even@1.0.0, PyPI's `info` object
// for Django 5.0, npm's `"Not Found"` and PyPI's `{"message": "Not Found"}`
// 404s. Shaped variants (missing/oversize licenses, expression preference)
// travel the same captured paths. Bodies are real `Response` streams, so the
// byte bound reads exactly as it does against the services. (A loopback
// socket fake is impossible in this sandbox: `listen` fails EPERM, verified
// 2026-10-04; the fake lives at the fetch seam production injects.)

import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { requestUrl } from './helpers/legalRequest'
import {
  LEGAL_FINDING_ID_MAX_CHARS,
  LEGAL_REGISTRY_HOSTS,
  LEGAL_REGISTRY_MAX_QUERIES,
  LEGAL_REGISTRY_RESPONSE_MAX_BYTES,
} from '../../src/shared/constants'
import {
  enrichFromRegistries,
  isRegistryTarget,
  type LegalRegistryTarget,
} from '../../src/runtime/legal/legalRegistry'

const NPM_DOC = readFileSync(
  new URL('fixtures/legalRegistry/npm-is-even-1.0.0.json', import.meta.url),
  'utf8',
)
const PYPI_INFO: unknown = JSON.parse(
  readFileSync(new URL('fixtures/legalRegistry/pypi-django-info.json', import.meta.url), 'utf8'),
)

type ScriptedRoute = { readonly status: number; readonly body: string } | { readonly hang: true }

function scriptedFetch(
  routes: Readonly<Record<string, ScriptedRoute>>,
  requested: string[],
): typeof fetch {
  const spy = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)
    requested.push(url)
    const route = routes[new URL(url).pathname]
    if (route === undefined) return Promise.resolve(new Response('"Not Found"', { status: 404 }))
    if ('hang' in route) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'))
          },
          { once: true },
        )
      })
    }
    return Promise.resolve(new Response(route.body, { status: route.status }))
  }
  return spy
}

const LOOPBACK_HOSTS = { npm: '127.0.0.1:1', pypi: '127.0.0.1:1' }

function target(overrides?: Partial<LegalRegistryTarget>): LegalRegistryTarget {
  return { ecosystem: 'npm', name: 'is-even', version: '1.0.0', ...overrides }
}

describe('M97 registry targets (lane R)', () => {
  const cases: [string, string, string, boolean][] = [
    ['npm', 'is-even', '1.0.0', true],
    ['npm', '@types/node', '22.20.4', true],
    ['pypi', 'Django', '5.0', true],
    ['gems', 'rails', '8.0', false],
    ['npm', '../evil', '1.0', false],
    ['npm', 'has space', '1.0', false],
    ['npm', '', '1.0', false],
    ['npm', 'ok', '', false],
    ['npm', 'ok', '../1', false],
    ['npm', 'ok', '1.0 ', false],
    ['pypi', 'ok/name', '1.0', false],
  ]
  it.each(cases)('accepts %s %s@%s: %s', (ecosystem, name, version, accepted) => {
    expect(isRegistryTarget({ ecosystem, name, version })).toBe(accepted)
  })
  it('refuses an overlong name and a non-object', () => {
    expect(
      isRegistryTarget({
        ecosystem: 'npm',
        name: 'x'.repeat(215),
        version: '1',
      }),
    ).toBe(false)
    expect(isRegistryTarget('is-even')).toBe(false)
    expect(isRegistryTarget(undefined)).toBe(false)
  })
})

describe('M97 registry reads (lane R)', () => {
  it('reads npm and PyPI licenses from the captured shapes', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch(
      {
        '/is-even/1.0.0': { status: 200, body: NPM_DOC },
        '/pypi/Django/5.0/json': { status: 200, body: JSON.stringify({ info: PYPI_INFO }) },
      },
      requested,
    )
    const report = await enrichFromRegistries({
      targets: [target(), target({ ecosystem: 'pypi', name: 'Django', version: '5.0' })],
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(report.hosts).toEqual(['127.0.0.1:1', '127.0.0.1:1'])
    expect(requested).toEqual([
      'http://127.0.0.1:1/is-even/1.0.0',
      'http://127.0.0.1:1/pypi/Django/5.0/json',
    ])
    expect(report.licenses).toMatchObject([
      { status: 'found', license: 'MIT', httpStatus: 200 },
      { status: 'found', license: 'BSD-3-Clause', httpStatus: 200 },
    ])
    expect(report.bytesReceived).toBeGreaterThan(0)
    expect(report.isTruncated).toBe(false)
  })
  it('encodes a scoped npm name the captured way', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch(
      { '/@scope%2Fpkg/2.0.0': { status: 200, body: '{"license":"Apache-2.0"}' } },
      requested,
    )
    const report = await enrichFromRegistries({
      targets: [{ ecosystem: 'npm', name: '@scope/pkg', version: '2.0.0' }],
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(requested).toEqual(['http://127.0.0.1:1/@scope%2Fpkg/2.0.0'])
    expect(report.licenses).toMatchObject([{ status: 'found', license: 'Apache-2.0' }])
  })
  it('keeps missing packages unknown with the captured 404 bodies', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch(
      {
        '/nope/9.9.9': { status: 404, body: '"Not Found"' },
        '/pypi/nope/9.9.9/json': { status: 404, body: '{"message": "Not Found"}' },
      },
      requested,
    )
    const report = await enrichFromRegistries({
      targets: [
        target({ name: 'nope', version: '9.9.9' }),
        target({ ecosystem: 'pypi', name: 'nope', version: '9.9.9' }),
      ],
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(report.licenses).toMatchObject([
      { status: 'unknown', license: undefined, httpStatus: 404 },
      { status: 'unknown', license: undefined, httpStatus: 404 },
    ])
  })
  it('marks errors without failing its siblings', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch(
      {
        '/ok/1.0.0': { status: 200, body: '{"license":"MIT"}' },
        '/down/1.0.0': { status: 500, body: 'boom' },
        '/garbled/1.0.0': { status: 200, body: 'not json' },
        '/bare/1.0.0': { status: 200, body: '{}' },
        '/textual/1.0.0': {
          status: 200,
          body: `{"license":"${'x'.repeat(LEGAL_FINDING_ID_MAX_CHARS + 1)}"}`,
        },
      },
      requested,
    )
    const report = await enrichFromRegistries({
      targets: [
        target({ name: 'ok', version: '1.0.0' }),
        target({ name: 'down', version: '1.0.0' }),
        target({ name: 'garbled', version: '1.0.0' }),
        target({ name: 'bare', version: '1.0.0' }),
        target({ name: 'textual', version: '1.0.0' }),
      ],
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(report.licenses).toMatchObject([
      { status: 'found', license: 'MIT' },
      { status: 'error', httpStatus: 500 },
      { status: 'error', httpStatus: 200 },
      { status: 'unknown', httpStatus: 200 },
      { status: 'unknown', httpStatus: 200 },
    ])
  })
  it('prefers the PyPI expression over the legacy license field', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch(
      {
        '/pypi/dualled/1.0/json': {
          status: 200,
          body: JSON.stringify({
            info: { name: 'dualled', license_expression: 'MIT', license: 'ISC' },
          }),
        },
      },
      requested,
    )
    const report = await enrichFromRegistries({
      targets: [{ ecosystem: 'pypi', name: 'dualled', version: '1.0' }],
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(report.licenses).toMatchObject([{ status: 'found', license: 'MIT' }])
  })
  it('refuses a response past the byte bound instead of buffering it', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch(
      {
        '/big/1.0.0': {
          status: 200,
          body: `{"license":"MIT","padding":"${'x'.repeat(LEGAL_REGISTRY_RESPONSE_MAX_BYTES)}"}`,
        },
      },
      requested,
    )
    const report = await enrichFromRegistries({
      targets: [target({ name: 'big', version: '1.0.0' })],
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(report.licenses).toMatchObject([{ status: 'refused', license: undefined }])
  })
  it('dedupes repeat targets and stops at the query bound', async () => {
    const requested: string[] = []
    const fetch = vi.fn(
      scriptedFetch({ '/dup/1.0.0': { status: 200, body: '{"license":"MIT"}' } }, requested),
    )
    const targets = [
      target({ name: 'dup', version: '1.0.0' }),
      target({ name: 'dup', version: '1.0.0' }),
    ]
    for (let index = 0; index <= LEGAL_REGISTRY_MAX_QUERIES; index += 1) {
      targets.push(target({ name: `extra-${String(index)}`, version: '1.0.0' }))
    }
    const report = await enrichFromRegistries({
      targets,
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(requested.filter((line) => line.includes('/dup/1.0.0'))).toHaveLength(1)
    expect(report.queried).toHaveLength(LEGAL_REGISTRY_MAX_QUERIES)
    expect(report.isTruncated).toBe(true)
    expect(report.skipped.at(-1)).toMatchObject({ reason: 'over-limit' })
    expect(fetch).toHaveBeenCalledTimes(LEGAL_REGISTRY_MAX_QUERIES)
  })
  it('builds only the documented hosts over HTTPS by default', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch({}, requested)
    const report = await enrichFromRegistries({
      targets: [target(), target({ ecosystem: 'pypi', name: 'Django', version: '5.0' })],
      fetch,
    })
    expect(requested).toEqual([
      `https://${LEGAL_REGISTRY_HOSTS.npm}/is-even/1.0.0`,
      `https://${LEGAL_REGISTRY_HOSTS.pypi}/pypi/Django/5.0/json`,
    ])
    expect(report.licenses).toMatchObject([{ status: 'unknown' }, { status: 'unknown' }])
  })
  it('aborts promptly on the caller’s signal', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch({ '/is-even/1.0.0': { status: 200, body: NPM_DOC } }, requested)
    const controller = new AbortController()
    controller.abort()
    await expect(
      enrichFromRegistries({
        targets: [target()],
        fetch,
        signal: controller.signal,
        hosts: LOOPBACK_HOSTS,
      }),
    ).rejects.toThrow()
    expect(requested).toEqual([])
  })
  it('marks a hanging registry without losing its siblings', async () => {
    const requested: string[] = []
    const fetch = scriptedFetch(
      {
        '/slow/1.0.0': { hang: true },
        '/ok/1.0.0': { status: 200, body: '{"license":"MIT"}' },
      },
      requested,
    )
    const report = await enrichFromRegistries({
      targets: [
        target({ name: 'slow', version: '1.0.0' }),
        target({ name: 'ok', version: '1.0.0' }),
      ],
      fetch,
      hosts: LOOPBACK_HOSTS,
    })
    expect(report.licenses).toMatchObject([
      { status: 'error', license: undefined },
      { status: 'found', license: 'MIT' },
    ])
  }, 30_000)
})
