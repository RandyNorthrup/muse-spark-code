import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkReadmeBadges,
  readmeImageUrls,
  renderPackageReadme,
} from '../../scripts/check-badges.mjs'

const version = '0.14.0'
const insecureExample = 'https://example.test/example'.replace('https:', 'http:')
const badge = `https://img.shields.io/badge/Marketplace-v${version}-blue`
const document = (url = badge) => ({
  name: 'store',
  markdown: `![badge](<${url}>)`,
  labels: ['Marketplace'],
})
const offline = { skipReason: 'fake-only unit test' }
const svg = (text = `Marketplace: v${version}`) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><title>${text}</title><text>${text}</text></svg>`
// shields.io's own layout (captured 2026-10-06): a title, then shadow and
// face <text> nodes for the label and the value, nothing between them.
const shields = (value) =>
  `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Marketplace: v${value}"><title>Marketplace: v${value}</title><g><text>Marketplace</text><text>Marketplace</text><text>v${value}</text><text>v${value}</text></g></svg>`
const response = (body = svg(), contentType = 'image/svg+xml', status = 200) =>
  new globalThis.Response(body, { status, headers: { 'content-type': contentType } })

// The case starts the real badge CLI cold under Node; a hosted runner with
// coverage took 3.1 s, near the default deadline.
// PLAN.md §8 (2026-10-07).
const COLD_CLI_TIMEOUT_MS = 15_000

describe('badge discovery and package templates', () => {
  it('finds HTML, Markdown and reference images, deduplicates and ignores code examples', () => {
    expect(
      readmeImageUrls(`<IMG alt="label > detail" SRC='${badge}?a=1&amp;b=2'>

![badge](<${badge}?a=1&b=2>)
![badge][ref]

[ref]: https://badgen.net/npm/dw/package

\`<img src="${insecureExample}">\`

\`\`\`html
<img src="${insecureExample}">
\`\`\``),
    ).toEqual([`${badge}?a=1&b=2`, 'https://badgen.net/npm/dw/package'])
  })
  it('renders any manifest version in both landing pages and retains dynamic counts', async () => {
    const docs = [
      ['docs/marketplace-readme.md', ['Marketplace', 'Open VSX']],
      ['docs/npm-readme.md', ['npm', 'GitHub release']],
    ].map(([name, labels]) => ({
      name,
      labels,
      markdown: renderPackageReadme(readFileSync(name, 'utf8'), '0.99.2'),
    }))
    await expect(checkReadmeBadges(docs, '0.99.2', offline)).resolves.toContain('network skipped')
    for (const doc of docs) {
      expect(doc.markdown).toContain('-v0.99.2-')
      expect(doc.markdown).not.toContain('{version}')
    }
    expect(docs[1].markdown).toContain('https://badgen.net/npm/dw/')
    expect(() => renderPackageReadme('{version}', 'invalid')).toThrow()
  })
})

describe('badge policy guards', () => {
  it.each([
    'https://img.shields.io/badge/test-ok-green'.replace('https:', 'http:'),
    'media/banner.png',
    'https://user:password@img.shields.io/badge/test-ok-green',
    'https://untrusted.test/badge/test-ok-green',
    'https://badgen.net.evil.test/badge/test-ok-green',
    'https://github.com/owner/repo/arbitrary.svg',
  ])('rejects insecure or store-untrusted image %s', async (url) => {
    await expect(
      checkReadmeBadges([{ ...document(url), labels: [] }], version, offline),
    ).rejects.toThrow()
  })
  it.each([
    'https://badgen.net/vs-marketplace/v/owner.name',
    'https://img.shields.io/visual-studio-marketplace/v/owner.name',
    'https://badgen.net/open-vsx/version/owner/name',
    'https://img.shields.io/open-vsx/v/owner/name',
    'https://badgen.net/npm/v/name',
    'https://badgen.net/github/release/owner/name',
    'https://img.shields.io/github/v/release/owner/name',
  ])('rejects a dynamic store version %s', async (url) => {
    await expect(checkReadmeBadges([document(url)], version, offline)).rejects.toThrow(
      'dynamic version badge',
    )
    await expect(
      checkReadmeBadges([{ ...document(url), labels: [] }], version, offline),
    ).resolves.toContain('network skipped')
  })
  it('rejects a static mismatch, missing label and unresolved template', async () => {
    await expect(
      checkReadmeBadges([document(badge.replace(version, '0.13.0'))], version, offline),
    ).rejects.toThrow('version mismatch')
    await expect(
      checkReadmeBadges([{ ...document(), labels: ['npm'] }], version, offline),
    ).rejects.toThrow('missing static npm')
    await expect(
      checkReadmeBadges([document(badge.replace(version, '{version}'))], version, offline),
    ).rejects.toThrow('version mismatch')
  })
  it('accepts the pinned vsce workflow exception and rejects unnamed or CI skips', async () => {
    const docs = [
      {
        ...document('https://github.com/owner/repo/actions/workflows/ci.yml/badge.svg'),
        labels: [],
      },
    ]
    await expect(checkReadmeBadges(docs, version, offline)).resolves.toContain('network skipped')
    await expect(checkReadmeBadges(docs, version, { skipReason: ' ' })).rejects.toThrow(
      'named reason',
    )
    await expect(checkReadmeBadges(docs, version, { ...offline, ci: true })).rejects.toThrow(
      'forbidden in CI',
    )
  })
  it(
    'wires the check into quality, CI and both packagers and rejects the CI environment override',
    () => {
      expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['quality:gates']).toContain(
        'check:badges',
      )
      expect(readFileSync('.github/workflows/build.yml', 'utf8')).toContain(
        'typecheck check:badges',
      )
      expect(readFileSync('scripts/package-vsix.mjs', 'utf8')).toContain(
        "['scripts/check-badges.mjs', '--packaged-vsix', stage]",
      )
      expect(() =>
        execFileSync(process.execPath, ['scripts/check-badges.mjs'], {
          env: { ...process.env, CI: 'true', BADGE_CHECK_SKIP_NETWORK: 'fake-only test' },
          stdio: 'pipe',
        }),
      ).toThrow('forbidden in CI')
    },
    COLD_CLI_TIMEOUT_MS,
  )
})

describe('public image responses', () => {
  it('checks every unique badge and raster without authorization', async () => {
    const png = 'https://raw.githubusercontent.com/owner/repo/main/banner.png'
    const fetch = vi.fn(async (url) =>
      url === png ? response('png bytes', 'image/png') : response(),
    )
    await expect(
      checkReadmeBadges(
        [document(), { name: 'GitHub', markdown: `![badge](${badge})\n![banner](${png})` }],
        version,
        { fetch },
      ),
    ).resolves.toContain('2 HTTPS images')
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const [, options] of fetch.mock.calls) {
      expect(options.cache).toBe('no-store')
      expect(options.signal).toBeDefined()
      expect(options.headers).toBeUndefined()
    }
  })
  it('reads a shields.io badge whose label and value nodes adjoin', async () => {
    await expect(
      checkReadmeBadges([document()], version, { fetch: vi.fn(() => response(shields(version))) }),
    ).resolves.toContain('1 HTTPS images')
    await expect(
      checkReadmeBadges([document()], version, { fetch: vi.fn(() => response(shields('0.13.0'))) }),
    ).rejects.toThrow('label/version mismatch')
  })
  it.each([
    ['404', () => response(svg(), 'image/svg+xml', 404)],
    ['HTML', () => response('<html>blocked</html>', 'text/html')],
    ['wrong SVG content type', () => response(svg(), 'text/plain')],
    ['malformed XML', () => response('<svg>')],
    ['wrong root', () => response(svg().replace('<svg ', '<html ').replace('</svg>', '</html>'))],
    ['missing namespace', () => response(svg().replace(' xmlns="http://www.w3.org/2000/svg"', ''))],
    ['error badge', () => response(svg(`Marketplace: v${version} not found`))],
    ['retired badge', () => response(svg(`Marketplace: v${version} retired`))],
    ['wrong label', () => response(svg(`Open VSX: v${version}`))],
    ['wrong version', () => response(svg('Marketplace: v0.13.0'))],
    ['doctype', () => response(`<!DOCTYPE svg>${svg()}`)],
  ])('rejects %s', async (_name, reply) => {
    await expect(
      checkReadmeBadges([document()], version, { fetch: vi.fn(reply) }),
    ).rejects.toThrow()
  })
  it('rejects unavailable requests, insecure final URLs and nonimage content', async () => {
    await expect(
      checkReadmeBadges([document()], version, {
        fetch: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).rejects.toThrow('offline')
    const reply = response()
    Object.defineProperty(reply, 'url', {
      value: 'https://example.test/image.svg'.replace('https:', 'http:'),
    })
    await expect(
      checkReadmeBadges([document()], version, { fetch: vi.fn().mockResolvedValue(reply) }),
    ).rejects.toThrow('redirected away')
    await expect(
      checkReadmeBadges([{ ...document('https://example.test/banner.png'), labels: [] }], version, {
        fetch: vi.fn(() => response('missing', 'text/html')),
      }),
    ).rejects.toThrow('did not return an image')
  })
})

describe('checkout images ahead of public main', () => {
  const roots = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })
  function fixture(mainPaths = []) {
    const root = mkdtempSync(path.join(tmpdir(), 'ci0150c-images-'))
    roots.push(root)
    const relative = 'media/readme/new.png'
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    const image = new PNG({ width: 1, height: 1 })
    writeFileSync(path.join(root, relative), PNG.sync.write(image))
    const url = `https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/${relative}`
    const fetch = vi.fn(async (target) =>
      target === url
        ? response('image bytes', 'image/png')
        : globalThis.Response.json({
            truncated: false,
            tree: mainPaths.map((name) => ({ path: name, type: 'blob' })),
          }),
    )
    return {
      root,
      relative,
      url,
      fetch,
      check: () =>
        checkReadmeBadges([{ ...document(url), labels: [] }], version, {
          repositoryRoot: root,
          fetch,
          ci: true,
        }),
    }
  }
  it('validates a new PNG locally while main has no such file', async () => {
    const f = fixture()
    await expect(f.check()).resolves.toContain('1 new checkout images')
    expect(f.fetch).toHaveBeenCalledTimes(1)
    expect(f.fetch).not.toHaveBeenCalledWith(f.url, expect.anything())
  })
  it('continues checking public bytes for an image already on main', async () => {
    const f = fixture(['media/readme/new.png'])
    await expect(f.check()).resolves.toContain('0 new checkout images')
    expect(f.fetch).toHaveBeenCalledWith(f.url, expect.anything())
    const fetchMain = f.fetch.getMockImplementation()
    f.fetch.mockImplementation(async (url) =>
      url === f.url ? response('missing', 'image/png', 404) : fetchMain(url),
    )
    await expect(f.check()).rejects.toThrow('Badge image HTTP 404')
  })
  it.each(['missing', 'empty', 'invalid PNG'])(
    'refuses a %s checkout image before networking',
    async (kind) => {
      const f = fixture()
      const file = path.join(f.root, f.relative)
      if (kind === 'missing') rmSync(file)
      else writeFileSync(file, kind === 'empty' ? '' : 'not a PNG')
      await expect(f.check()).rejects.toThrow()
      expect(f.fetch).not.toHaveBeenCalled()
      await expect(
        checkReadmeBadges([{ ...document(f.url), labels: [] }], version, {
          repositoryRoot: f.root,
          ...offline,
        }),
      ).rejects.toThrow()
    },
  )
  it('refuses an incomplete or malformed public-main inventory', async () => {
    const f = fixture()
    for (const body of [{ tree: [], truncated: true }, { tree: [] }]) {
      f.fetch.mockResolvedValue(globalThis.Response.json(body))
      await expect(f.check()).rejects.toThrow()
    }
  })
  it.each([undefined, ''])(
    'omits authorization for an absent or empty job token: %s',
    async (githubToken) => {
      const f = fixture(['media/readme/new.png'])
      await expect(
        checkReadmeBadges([{ ...document(f.url), labels: [] }], version, {
          repositoryRoot: f.root,
          fetch: f.fetch,
          ci: true,
          githubToken,
        }),
      ).resolves.toContain('0 new checkout images')
      for (const [, options] of f.fetch.mock.calls) expect(options.headers).toBeUndefined()
    },
  )
  it('sends a job token to the GitHub API inventory only, never to an image host', async () => {
    const f = fixture(['media/readme/new.png'])
    await expect(
      checkReadmeBadges([{ ...document(f.url), labels: [] }], version, {
        repositoryRoot: f.root,
        fetch: f.fetch,
        ci: true,
        githubToken: 'job-token',
      }),
    ).resolves.toContain('0 new checkout images')
    const [[treeUrl, treeOptions], [imageUrl, imageOptions]] = f.fetch.mock.calls
    expect(new URL(treeUrl).hostname).toBe('api.github.com')
    expect(treeOptions.headers).toEqual({ authorization: 'Bearer job-token' })
    expect(imageUrl).toBe(f.url)
    expect(imageOptions.headers).toBeUndefined()
    await f.check()
    expect(f.fetch.mock.calls[2][1].headers).toBeUndefined()
  })
  it('refuses an unavailable public-main inventory', async () => {
    const f = fixture()
    f.fetch.mockResolvedValue(response('missing', 'text/plain', 404))
    await expect(f.check()).rejects.toThrow('Public main tree HTTP 404')
  })
  it('names the inventory request when it gets no answer', async () => {
    const f = fixture()
    f.fetch.mockImplementation(refused)
    vi.useFakeTimers()
    try {
      const { error } = await settle(f.check())
      expect(error.message).toBe(
        'No answer from https://api.github.com/repos/RandyNorthrup/muse-spark-code/git/trees/main?recursive=1 after 4 attempts in 33 s: fetch failed',
      )
      expect(f.fetch).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Hosted runners got no answer from one of the image URLs for more than
// half a minute at a time (five jobs in three runs of PR #147).
const REQUEST_MS = 15_000
const overdue = () =>
  new globalThis.DOMException('The operation was aborted due to timeout', 'TimeoutError')
const answer = () => Promise.resolve(response(shields(version)))
/** No answer inside the attempt's deadline: the abort arrives REQUEST_MS later. */
function pastDeadline() {
  return new Promise((_resolve, reject) => {
    globalThis.setTimeout(() => {
      reject(overdue())
    }, REQUEST_MS)
  })
}
/** No connection: fetch fails at once. */
function refused() {
  return Promise.reject(new TypeError('fetch failed'))
}
/** A fetch that notes the fake clock's time of every request. */
function counted(reply) {
  const times = []
  const fetch = vi.fn(() => {
    times.push(Date.now())
    return reply(times.length)
  })
  return { fetch, sinceFirst: () => times.map((time) => time - times[0]) }
}
// The event loop's own turn, kept from before the fake clock replaces it.
const realTurn = globalThis.setImmediate
/** Runs a check to its end under the fake clock, a second at a time. */
async function settle(check) {
  let outcome
  const watch = async () => {
    try {
      outcome = { value: await check }
    } catch (error) {
      outcome = { error }
    }
  }
  void watch()
  for (let second = 0; outcome === undefined && second < 300; second += 1) {
    await vi.advanceTimersByTimeAsync(1000)
    await new Promise((resolve) => {
      realTurn(resolve)
    })
  }
  if (outcome === undefined) throw new Error('the check did not end in 300 s of fake time')
  return outcome
}

describe('badge requests that get no answer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['its deadline passes', pastDeadline, [0, 18_000, 43_000, 78_000]],
    ['the connection fails', refused, [0, 3000, 13_000, 33_000]],
  ])(
    'are made again when %s: four attempts, pauses of 3, 10 and 20 s, then verified',
    async (_case, failure, requestTimes) => {
      const { fetch, sinceFirst } = counted((attempt) => (attempt < 4 ? failure() : answer()))
      const { value } = await settle(checkReadmeBadges([document()], version, { fetch }))
      expect(value).toContain('1 HTTPS images')
      expect(sinceFirst()).toEqual(requestTimes)
      for (const [, options] of fetch.mock.calls) expect(options.signal.aborted).toBe(false)
    },
  )

  it('fail the check after the fourth attempt, naming the URL, the attempts and the time waited', async () => {
    const deadline = vi.spyOn(globalThis.AbortSignal, 'timeout')
    try {
      const { fetch, sinceFirst } = counted(pastDeadline)
      const { error } = await settle(checkReadmeBadges([document()], version, { fetch }))
      expect(error.message).toBe(
        `No answer from ${badge} after 4 attempts in 93 s: The operation was aborted due to timeout`,
      )
      expect(sinceFirst()).toEqual([0, 18_000, 43_000, 78_000])
      // Each attempt has the whole deadline to itself.
      expect(deadline.mock.calls).toEqual(Array.from({ length: 4 }, () => [REQUEST_MS]))
    } finally {
      deadline.mockRestore()
    }
  })

  it("name fetch's own reason for a failed connection", async () => {
    const { fetch } = counted(() =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
        }),
      ),
    )
    const { error } = await settle(checkReadmeBadges([document()], version, { fetch }))
    expect(error.message).toBe(
      `No answer from ${badge} after 4 attempts in 33 s: fetch failed (ECONNRESET)`,
    )
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('are made again when the body does not arrive in time', async () => {
    const { fetch, sinceFirst } = counted((attempt) => {
      if (attempt > 1) return answer()
      const stalled = response(shields(version))
      stalled.text = () => Promise.reject(overdue())
      return Promise.resolve(stalled)
    })
    const { value } = await settle(checkReadmeBadges([document()], version, { fetch }))
    expect(value).toContain('1 HTTPS images')
    expect(sinceFirst()).toEqual([0, 3000])
  })

  it.each([
    ['HTTP 500', () => response(svg(), 'image/svg+xml', 500), 'HTTP 500'],
    ['HTTP 503', () => response(svg(), 'image/svg+xml', 503), 'HTTP 503'],
    ['a wrong type', () => response('<html></html>', 'text/html'), 'not return SVG'],
    ['a wrong version', () => response(shields('0.13.0')), 'version mismatch'],
    [
      'a redirect away from HTTPS',
      () =>
        Object.defineProperty(response(), 'url', {
          value: 'https://example.test/image.svg'.replace('https:', 'http:'),
        }),
      'redirected away',
    ],
  ])(
    'is never repeated after %s: the first answer fails the check, with no pause',
    async (_case, reply, message) => {
      const fetch = vi.fn(() => Promise.resolve(reply()))
      // The fake clock never moves here: a pause would leave this pending.
      await expect(checkReadmeBadges([document()], version, { fetch })).rejects.toThrow(message)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('is never repeated after an error that is no network failure', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(checkReadmeBadges([document()], version, { fetch })).rejects.toThrow('offline')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
