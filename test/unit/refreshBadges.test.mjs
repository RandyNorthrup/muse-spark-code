import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { compareVersions, imageUrls, refreshReadmeBadges } from '../../scripts/refresh-badges.mjs'

const manifest = { publisher: 'RandyNorthrup', name: 'muse-spark-code', version: '0.13.0' }
const repository = 'RandyNorthrup/muse-spark-code'
const badge = `https://badgen.net/vs-marketplace/v/${manifest.publisher}.${manifest.name}?label=Marketplace&color=blue`
const readme = `<img src="${badge.replaceAll('&', '&amp;')}">`
const camo = 'https://camo.githubusercontent.com/abc/123'
const svg = (version) =>
  `<svg><title>Marketplace: v${version}</title><text>v${version}</text></svg>`

function fixture(overrides = {}) {
  let time = 0
  const log = vi.fn()
  const sleep = vi.fn((milliseconds) => {
    time += milliseconds
  })
  const fetch = vi.fn(async (source, options) => {
    if (options.method === 'PURGE')
      return new globalThis.Response('', { status: overrides.purgeStatus ?? 200 })
    const url = new URL(source)
    if (url.hostname === 'marketplace.visualstudio.com')
      return globalThis.Response.json({
        results: [
          {
            extensions: [
              {
                publisher: { publisherName: manifest.publisher },
                extensionName: manifest.name,
                versions: [{ version: manifest.version }],
              },
            ],
          },
        ],
      })
    if (url.hostname === 'open-vsx.org')
      return globalThis.Response.json({ version: manifest.version })
    if (url.hostname === 'registry.npmjs.org')
      return globalThis.Response.json({ 'dist-tags': { latest: manifest.version } })
    if (url.hostname === 'api.github.com')
      return globalThis.Response.json({ tag_name: `v${manifest.version}` })
    return url.hostname === 'github.com'
      ? new globalThis.Response(
          `<img src="${camo}"><img src="${camo}"><img src="https://elsewhere.test/image">`,
        )
      : new globalThis.Response(svg(manifest.version))
  })
  return { fetch, sleep, now: () => time, log }
}

// The case parses the real README with a cold Markdown parser; hosted macOS
// with coverage took 3.4 s, near the default deadline.
// PLAN.md §8 (2026-10-07).
const README_BADGE_PARSE_TIMEOUT_MS = 15_000

describe('README badge parsing and release comparison', () => {
  it(
    'finds every actual README badge, including GitHub CI and excluding screenshots',
    () => {
      const urls = imageUrls(readFileSync('README.md', 'utf8'))
      expect(urls).toHaveLength(11)
      expect(urls.filter((url) => new URL(url).hostname === 'badgen.net')).toHaveLength(5)
      expect(urls).toContain(
        'https://github.com/RandyNorthrup/muse-spark-code/actions/workflows/ci.yml/badge.svg',
      )
    },
    README_BADGE_PARSE_TIMEOUT_MS,
  )
  it('handles quotes, unquoted src, entities, duplicate URLs and attributes containing >', () => {
    expect(
      imageUrls(`<IMG alt="label > detail" SRC='${badge.replaceAll('&', '&#38;')}'>
      <img src="${badge}"><img src=https://img.shields.io/badge/test-ok-green>
      <img data-src="https://badgen.net/ignored"><img src="media/local.png">
      <img alt=" src='https://badgen.net/fake-src'" src="media/local.png">
      <img src="${'https://badgen.net/insecure'.replace('https:', 'http:')}"><img src="https://badgen.net.evil.test/x">
      <img src="https://user:password@badgen.net/private"><img src="invalid">`),
    ).toEqual([
      badge,
      'https://img.shields.io/badge/test-ok-green',
      'https://badgen.net.evil.test/x',
    ])
  })
  it('discovers a new trusted service and Markdown/reference badges without a maintained URL list', () => {
    const workflow = 'https://github.com/owner/repo/actions/workflows/ci.yml/badge.svg'
    expect(
      imageUrls(
        `![CI](${workflow})\n![coverage][coverage]\n\n[coverage]: https://codecov.io/gh/owner/repo/branch/main/graph/badge.svg`,
      ),
    ).toEqual([workflow, 'https://codecov.io/gh/owner/repo/branch/main/graph/badge.svg'])
    expect(
      imageUrls(`<img src="${camo}"><img src="https://camo.githubusercontent.com.evil.test/x">`, [
        'camo.githubusercontent.com',
      ]),
    ).toEqual([camo])
  })
  it.each([
    ['v0.13.0', '0.13.0', 0],
    ['0.12.1', 'v0.13.0', -1],
    ['0.9.9', '0.10.0', -1],
    ['0.13.1', '0.13.0', 1],
    ['1.0.0', '0.99.0', 1],
    ['0.13.0', '0.130.0', -1],
  ])('compares %s with %s numerically', (actual, expected, order) => {
    expect(compareVersions(actual, expected)).toBe(order)
  })
  it('refuses missing or malformed versions', () => {
    for (const value of [undefined, '', 'not-a-version', '0.13', '0.13.0 trailing']) {
      expect(() => compareVersions(value, manifest.version)).toThrow()
    }
  })
})

describe('public propagation, badge retries and camo purge', () => {
  it('fetches every discovered badge, including CI and a new service, before purging camo', async () => {
    const deps = fixture()
    const ci = 'https://github.com/owner/repo/actions/workflows/ci.yml/badge.svg'
    const coverage = 'https://codecov.io/gh/owner/repo/branch/main/graph/badge.svg'
    await refreshReadmeBadges(
      manifest,
      `${readme}\n\n![CI](${ci})\n![coverage](${coverage})`,
      repository,
      deps,
    )
    const calls = deps.fetch.mock.calls.map(([url]) => url)
    for (const url of [badge, ci, coverage]) {
      expect(calls.indexOf(url)).toBeGreaterThan(-1)
      expect(calls.indexOf(url)).toBeLessThan(calls.indexOf(camo))
    }
  })
  it.each([
    ['marketplace.visualstudio.com', 'Marketplace'],
    ['open-vsx.org', 'Open VSX'],
    ['registry.npmjs.org', 'npm'],
    ['api.github.com', 'GitHub'],
  ])('validates malformed %s metadata before declaring propagation', async (host, channel) => {
    const deps = fixture()
    const fetch = deps.fetch.getMockImplementation()
    deps.fetch.mockImplementation((url, options) =>
      new URL(url).hostname === host ? globalThis.Response.json({}) : fetch(url, options),
    )
    await refreshReadmeBadges(manifest, readme, repository, deps)
    expect(deps.log).toHaveBeenCalledWith(
      `::warning::README badges: propagation deadline reached: ${channel}`,
    )
    expect(deps.now()).toBe(900_000)
  })
  it('rejects a Marketplace result for a different extension', async () => {
    const deps = fixture()
    const fetch = deps.fetch.getMockImplementation()
    deps.fetch.mockImplementation((url, options) =>
      url.includes('extensionquery')
        ? globalThis.Response.json({
            results: [
              {
                extensions: [
                  {
                    publisher: { publisherName: 'OtherPublisher' },
                    extensionName: manifest.name,
                    versions: [{ version: manifest.version }],
                  },
                ],
              },
            ],
          })
        : fetch(url, options),
    )
    await refreshReadmeBadges(manifest, readme, repository, deps)
    expect(deps.log).toHaveBeenCalledWith(
      '::warning::README badges: propagation deadline reached: Marketplace',
    )
  })
  it('uses all four public APIs, exact README URLs and a credential-free PURGE', async () => {
    const deps = fixture()
    await refreshReadmeBadges(manifest, readme, repository, deps)
    expect(deps.fetch).toHaveBeenCalledTimes(7)
    const [url, options] = deps.fetch.mock.calls[0]
    expect(url).toBe('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      filters: [
        {
          pageNumber: 1,
          pageSize: 1,
          criteria: [{ filterType: 7, value: 'RandyNorthrup.muse-spark-code' }],
        },
      ],
      assetTypes: [],
      flags: 513,
    })
    expect(deps.fetch).toHaveBeenCalledWith(badge, expect.objectContaining({ cache: 'no-store' }))
    expect(deps.fetch).toHaveBeenCalledWith(camo, expect.objectContaining({ method: 'PURGE' }))
    expect(
      deps.fetch.mock.calls.every(
        ([, settings]) =>
          settings.signal !== undefined && settings.headers?.Authorization === undefined,
      ),
    ).toBe(true)
    expect(deps.log).toHaveBeenCalledWith(`Camo PURGE ${camo}: 200`)
    expect(deps.sleep).not.toHaveBeenCalled()
  })
  it('polls only unpropagated channels every 30 seconds', async () => {
    const deps = fixture()
    const fetch = deps.fetch.getMockImplementation()
    let npmCalls = 0
    deps.fetch.mockImplementation((url, options) => {
      return url.includes('registry.npmjs.org') && npmCalls++ === 0
        ? globalThis.Response.json({ 'dist-tags': { latest: '0.12.1' } })
        : fetch(url, options)
    })
    await refreshReadmeBadges(manifest, readme, repository, deps)
    expect(deps.sleep.mock.calls).toEqual([[30_000]])
    expect(npmCalls).toBe(2)
    expect(deps.fetch.mock.calls.filter(([url]) => url.includes('extensionquery'))).toHaveLength(1)
  })
  it.each([undefined, '0.12.1', '0.14.0'])(
    'bounds unavailable or mismatched version %s at 15 minutes and still purges',
    async (latest) => {
      const deps = fixture()
      const fetch = deps.fetch.getMockImplementation()
      deps.fetch.mockImplementation((url, options) =>
        url.includes('registry.npmjs.org')
          ? globalThis.Response.json({ 'dist-tags': { latest } })
          : fetch(url, options),
      )
      await refreshReadmeBadges(manifest, readme, repository, deps)
      expect(deps.now()).toBe(900_000)
      expect(deps.sleep).toHaveBeenCalledTimes(30)
      expect(deps.log).toHaveBeenCalledWith(
        '::warning::README badges: propagation deadline reached: npm',
      )
      expect(deps.fetch).toHaveBeenCalledWith(camo, expect.objectContaining({ method: 'PURGE' }))
    },
  )
  it.each([true, false])(
    'retries old badge only and checks original URL again (original refreshes=%s)',
    async (refreshes) => {
      const deps = fixture()
      const fetch = deps.fetch.getMockImplementation()
      let calls = 0
      deps.fetch.mockImplementation((url, options) => {
        if (url.startsWith('https://badgen.net/')) {
          calls++
          return new globalThis.Response(
            svg(calls === 1 || (!refreshes && calls === 3) ? '0.12.1' : manifest.version),
          )
        }
        return fetch(url, options)
      })
      await refreshReadmeBadges(manifest, readme, repository, deps)
      const urls = deps.fetch.mock.calls
        .filter(([url]) => url.startsWith('https://badgen.net/'))
        .map(([url]) => url)
      expect(urls).toEqual([badge, `${badge}&refresh=0.13.0-0`, badge])
      expect(
        deps.log.mock.calls
          .flat()
          .some((message) => message.includes('original badge still stale')),
      ).toBe(!refreshes)
    },
  )
  it.each([svg('0.14.0'), svg('0.13.0'), '<svg>downloads: 12</svg>'])(
    'never cache-busts current, newer or unreadable replies',
    async (body) => {
      const deps = fixture()
      const fetch = deps.fetch.getMockImplementation()
      deps.fetch.mockImplementation((url, options) =>
        url === badge ? new globalThis.Response(body) : fetch(url, options),
      )
      await refreshReadmeBadges(manifest, readme, repository, deps)
      expect(
        deps.fetch.mock.calls.filter(([url]) => url.startsWith('https://badgen.net/')),
      ).toHaveLength(1)
      if (!body.includes('0.')) {
        expect(deps.log).toHaveBeenCalledWith(
          `::warning::README badges: badge request failed or version unreadable: ${badge}`,
        )
      }
    },
  )
  it('warns when cache-busted version stays old; never retries static badges', async () => {
    const deps = fixture()
    const fetch = deps.fetch.getMockImplementation()
    deps.fetch.mockImplementation((url, options) =>
      url.startsWith('https://badgen.net/')
        ? new globalThis.Response(svg('0.12.1'))
        : fetch(url, options),
    )
    await refreshReadmeBadges(
      manifest,
      `${readme}<img src="https://badgen.net/static/sdk/0.12.1">`,
      repository,
      deps,
    )
    expect(deps.log).toHaveBeenCalledWith(
      `::warning::README badges: cache-busted badge still stale: ${badge}`,
    )
    expect(deps.fetch.mock.calls.filter(([url]) => url.includes('/static/'))).toHaveLength(1)
  })
  it.each([false, true])(
    'reports badge failure without retry or release failure (network=%s)',
    async (network) => {
      const deps = fixture({ purgeStatus: 503 })
      const fetch = deps.fetch.getMockImplementation()
      deps.fetch.mockImplementation((url, options) => {
        if (url === badge) {
          if (network) throw new Error('network unavailable')
          return new globalThis.Response('', { status: 503 })
        }
        return fetch(url, options)
      })
      await expect(refreshReadmeBadges(manifest, readme, repository, deps)).resolves.toBeUndefined()
      expect(deps.log).toHaveBeenCalledWith(
        `::warning::README badges: badge request failed or version unreadable: ${badge}`,
      )
      expect(deps.log).toHaveBeenCalledWith(`Camo PURGE ${camo}: 503`)
      expect(deps.log).toHaveBeenCalledWith(
        `::warning::README badges: camo purge returned HTTP 503: ${camo}`,
      )
    },
  )
  it('bounds public network failure, reports page failure and empty badge lists', async () => {
    const deps = fixture()
    deps.fetch.mockRejectedValue(new Error('network unavailable'))
    await expect(refreshReadmeBadges(manifest, '', repository, deps)).resolves.toBeUndefined()
    expect(deps.now()).toBe(900_000)
    expect(deps.log).toHaveBeenCalledWith(
      '::warning::README badges: repository page request failed',
    )
    expect(deps.log).toHaveBeenCalledWith(
      '::warning::README badges: README contains no supported badge URLs',
    )
  })
  it.each([false, true])(
    'reports missing camo URLs or a thrown purge failure (purge=%s)',
    async (purge) => {
      const deps = fixture()
      const fetch = deps.fetch.getMockImplementation()
      deps.fetch.mockImplementation((url, options) => {
        if (options.method === 'PURGE') throw new Error('purge unavailable')
        return !purge && new URL(url).hostname === 'github.com'
          ? new globalThis.Response('<html></html>')
          : fetch(url, options)
      })
      await expect(refreshReadmeBadges(manifest, readme, repository, deps)).resolves.toBeUndefined()
      expect(deps.log).toHaveBeenCalledWith(
        purge
          ? `::warning::README badges: camo purge request failed: ${camo}`
          : '::warning::README badges: repository page contains no camo image URLs',
      )
    },
  )
})

describe('release workflow wiring', () => {
  it('runs last after successful all-published summary; setup failures also remain nonblocking', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    const job = workflow.split('\n  refresh-badges:\n', 2)[1]
    expect(job).toContain(
      "needs.summary.result == 'success' && needs.summary.outputs.all-published == 'true'",
    )
    expect(job).toContain('needs: summary')
    expect(job).toContain('continue-on-error: true')
    expect(job).toContain('run: node scripts/refresh-badges.mjs')
    expect(job).toContain('if: failure()')
    expect(job).not.toContain('secrets.')
    expect(job).not.toMatch(/\n {2}[a-z][\w-]*:/)
    expect(workflow).toContain('all-published: ${{ steps.report.outputs.all-published }}')
  })
})
