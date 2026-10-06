import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ghReportTransport,
  githubReportSource,
  type ReportGhOptions,
} from '../../src/core/reporting/sources/github'
import type {
  ReportNetworkPolicy,
  ReportNetworkTransport,
} from '../../src/core/reporting/sources/cache'
import { UI_TEXT } from '../../src/shared/constants'
import { CAPTURED_CHECKS_FAILED, CAPTURED_PULL_LIST } from './helpers/githubCapture'
import { networkContext, networkRig, pauseNetworkAdmission } from './helpers/reportNetwork'

const options = {
  remote: 'https://github.com/RandyNorthrup/muse-spark-code.git',
  headSha: 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5',
  defaultBranch: 'main',
}
function capturedTransport() {
  return vi.fn((request: { url: string }) =>
    Promise.resolve(
      Response.json(request.url.includes('/pulls?') ? CAPTURED_PULL_LIST : CAPTURED_CHECKS_FAILED),
    ),
  )
}

function readGitHub(transport: ReportNetworkTransport) {
  const rig = networkRig({ transport })
  return githubReportSource({ ...options, reader: rig.reader }).read(networkContext())
}

const ghProbe = {
  platform: 'linux' as const,
  pathVariable: '/system/bin',
  fileExists: () => true,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('GitHub report source', () => {
  it('scrubs escaped credentials in captured pull titles before persistent cache writes', async () => {
    const secret = `ghp_${'f'.repeat(36)}`
    const title = `${CAPTURED_PULL_LIST[0]?.title ?? ''} ${secret}`
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(
        request.url.includes('/pulls?')
          ? new Response(
              JSON.stringify([{ ...CAPTURED_PULL_LIST[0], title }]).replace(
                secret,
                () => String.raw`\u0067${secret.slice(1)}`,
              ),
            )
          : Response.json(CAPTURED_CHECKS_FAILED),
      ),
    )
    const rig = networkRig({ transport })
    const result = await githubReportSource({ ...options, reader: rig.reader }).read(
      networkContext(),
    )
    expect(result.record.status).toBe('partial')
    expect(result.data?.pullRequests).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(rig.storage.write).toHaveBeenCalled()
    expect(JSON.stringify(rig.storage.write.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(rig.entries())).not.toContain(secret)
  })

  it('refuses HEAD check runs for a different commit', async () => {
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(
        Response.json(
          request.url.includes('/pulls?')
            ? CAPTURED_PULL_LIST
            : {
                total_count: 1,
                check_runs: [{ ...CAPTURED_CHECKS_FAILED.check_runs[0], head_sha: 'b'.repeat(40) }],
              },
        ),
      ),
    )
    const result = await readGitHub(transport)
    expect(result.data?.runs.some((run) => run.ref.kind === 'head')).toBe(false)
    expect(result.record.reason).toContain('ci-ref-mismatch')
  })
  it('retains the reset time when an initial rate limit prevents every source read', async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791288060' },
        }),
      ),
    )
    const result = await readGitHub(transport)
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toContain('2026-10-06T12:01:00.000Z')
    expect(transport).toHaveBeenCalledOnce()
  })

  it('rejects malformed captured URL fields before reporting them', async () => {
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(
        Response.json(
          request.url.includes('/pulls?')
            ? [{ ...CAPTURED_PULL_LIST[0], html_url: 'not-a-url' }]
            : { total_count: 0, check_runs: [] },
        ),
      ),
    )
    const result = await readGitHub(transport)
    expect(result.record.status).toBe('partial')
    expect(result.data?.pullRequests).toEqual([])
    expect(result.record.reason).toContain('pulls-unavailable')
  })

  it('orders releases and assets independently of the port input order', async () => {
    const releases = [
      {
        version: '0.14.2',
        commit: 'a'.repeat(40),
        at: '2026-10-05T12:00:00Z',
        assets: ['z.vsix', 'a.vsix'],
      },
      {
        version: '0.14.1',
        commit: 'b'.repeat(40),
        at: '2026-10-04T12:00:00Z',
        assets: ['old.vsix'],
      },
    ]
    const firstRig = networkRig({ transport: capturedTransport() })
    const secondRig = networkRig({ transport: capturedTransport() })
    const first = await githubReportSource({
      ...options,
      reader: firstRig.reader,
      additional: { read: () => Promise.resolve({ runs: [], releases }) },
    }).read(networkContext())
    const second = await githubReportSource({
      ...options,
      reader: secondRig.reader,
      additional: {
        read: () =>
          Promise.resolve({
            runs: [],
            releases: releases
              .toReversed()
              .map((release) => ({ ...release, assets: release.assets.toReversed() })),
          }),
      },
    }).read(networkContext())
    expect(first).toEqual(second)
    expect(first.data?.releases[1]?.assets).toEqual(['a.vsix', 'z.vsix'])
  })

  it('refuses conflicting facts for the same pull request rather than choosing an arbitrary state', async () => {
    const transport = vi.fn((request: { url: string }) =>
      Promise.resolve(
        Response.json(
          request.url.includes('/pulls?')
            ? [CAPTURED_PULL_LIST[0], { ...CAPTURED_PULL_LIST[0], state: 'closed' }]
            : CAPTURED_CHECKS_FAILED,
        ),
      ),
    )
    const result = await readGitHub(transport)
    expect(result.record.reason).toContain('github-conflicting-fact')
    expect(result.data).toBeNull()
  })
  it('reads the captured pull and check shapes, preserving the ref scope', async () => {
    const transport = capturedTransport()
    const rig = networkRig({ transport })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      releaseTag: 'v0.14.2',
    }).read(networkContext())
    expect(result.record).toMatchObject({
      status: 'partial',
      reason: 'workflow-release-capture-required',
    })
    expect(result.data?.pullRequests).toEqual([
      expect.objectContaining({ number: 56, isMerged: false }),
    ])
    expect(result.data?.runs).toHaveLength(21)
    expect(new Set(result.data?.runs.map((run) => run.ref.kind))).toEqual(
      new Set(['head', 'default-branch', 'release-tag']),
    )
    expect(
      result.data?.runs.find(
        (run) => run.ref.kind === 'default-branch' && run.conclusion === 'failure',
      ),
    ).toMatchObject({ workflow: 'build / quality (macos-latest)', ref: { name: 'main' } })
    expect(transport).toHaveBeenCalledTimes(4)
  })

  it('never dispatches when signed-in policy lacks a login', async () => {
    const baseline = networkRig()
    const transport = capturedTransport()
    const rig = networkRig({
      transport,
      policy: { ...baseline.deps.policy, mode: 'whenSignedIn', githubSignedIn: false },
    })
    expect(
      await githubReportSource({ ...options, reader: rig.reader }).read(networkContext()),
    ).toMatchObject({
      data: null,
      record: { status: 'unavailable', reason: UI_TEXT.reportUi.signInRequired },
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each([
    { stage: 'cache', change: 'whenSignedIn' },
    { stage: 'cache', change: 'sign-out' },
    { stage: 'egress', change: 'whenSignedIn' },
    { stage: 'egress', change: 'sign-out' },
    { stage: 'host', change: 'whenSignedIn' },
    { stage: 'host', change: 'sign-out' },
  ] as const)('refuses GitHub after $change during $stage admission', async ({ stage, change }) => {
    vi.useFakeTimers()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let mode: ReportNetworkPolicy['mode'] = change === 'sign-out' ? 'whenSignedIn' : 'always'
    let isSignedIn = change === 'sign-out'
    const base = networkRig()
    const transport = capturedTransport()
    if (stage === 'host')
      transport.mockImplementationOnce(async () => {
        entered.resolve(undefined)
        await release.promise
        return Response.json(CAPTURED_PULL_LIST)
      })
    const rig = networkRig({
      transport,
      policy: {
        ...base.deps.policy,
        get mode() {
          return mode
        },
        get githubSignedIn() {
          return isSignedIn
        },
      },
    })
    const admission =
      stage === 'host'
        ? {
            entered: entered.promise,
            release: () => {
              release.resolve(undefined)
            },
          }
        : pauseNetworkAdmission(rig, stage)
    const source = githubReportSource({ ...options, reader: rig.reader })
    const owner = stage === 'host' ? source.read(networkContext()) : undefined
    if (stage === 'host') await admission.entered
    const pending = source.read(networkContext())
    await admission.entered
    await vi.advanceTimersByTimeAsync(0)
    mode = 'whenSignedIn'
    isSignedIn = false
    admission.release()
    const result = await pending
    expect(result.data).toBeNull()
    expect(result.record).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining(UI_TEXT.reportUi.signInRequired),
    })
    expect(transport).toHaveBeenCalledTimes(stage === 'host' ? 1 : 0)
    await owner
  })

  it('rechecks GitHub sign-in before every subsequent page', async () => {
    let isSignedIn = true
    const base = networkRig()
    const transport = capturedTransport().mockImplementationOnce(() => {
      isSignedIn = false
      return Promise.resolve(Response.json(CAPTURED_PULL_LIST))
    })
    const rig = networkRig({
      transport,
      policy: {
        ...base.deps.policy,
        mode: 'whenSignedIn',
        get githubSignedIn() {
          return isSignedIn
        },
      },
    })
    const result = await githubReportSource({ ...options, reader: rig.reader }).read(
      networkContext(),
    )
    expect(result.data?.pullRequests).toHaveLength(1)
    expect(result.record).toMatchObject({
      status: 'partial',
      reason: expect.stringContaining(UI_TEXT.reportUi.signInRequired),
    })
    expect(transport).toHaveBeenCalledOnce()
  })

  it.each([
    { remote: '/local/repo', status: 'notApplicable' },
    { remote: 'https://gitlab.com/a/b', status: 'notApplicable' },
    { headSha: 'main; do-something', status: 'unavailable' },
    { defaultBranch: '', status: 'unavailable' },
  ])('names an unusable Git source $status', async ({ status, ...changed }) => {
    const rig = networkRig()
    const observed14 = await githubReportSource({
      ...options,
      ...changed,
      reader: rig.reader,
    }).read(networkContext())
    expect(observed14.record.status).toBe(status)
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('marks workflow/releases missing rather than presenting empty complete success', async () => {
    const rig = networkRig({ transport: capturedTransport() })
    const observed15 = await githubReportSource({ ...options, reader: rig.reader }).read(
      networkContext(),
    )
    expect(observed15.record.status).toBe('partial')
  })

  it('binds and scrubs a validated workflow/release port', async () => {
    const secret = `ghp_${'f'.repeat(36)}`
    const rig = networkRig({ transport: capturedTransport() })
    const result = await githubReportSource({
      ...options,
      reader: rig.reader,
      additional: {
        read: () =>
          Promise.resolve({
            runs: [],
            releases: [
              { version: '0.14.2', at: '2026-10-05T12:00:00Z', commit: secret, assets: [secret] },
            ],
          }),
      },
    }).read(networkContext())
    expect(result.record.status).toBe('ok')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.data?.releases).toHaveLength(1)
  })

  it('preserves future CI conclusion words', async () => {
    const rig = networkRig({
      transport: vi.fn((request: { url: string }) =>
        Promise.resolve(
          Response.json(
            request.url.includes('/pulls?')
              ? []
              : {
                  total_count: 1,
                  check_runs: [
                    { ...CAPTURED_CHECKS_FAILED.check_runs[0], conclusion: 'future-conclusion' },
                  ],
                },
          ),
        ),
      ),
    })
    const result = await githubReportSource({ ...options, reader: rig.reader }).read(
      networkContext(),
    )
    expect(result.data?.runs[0]?.conclusion).toBe('future-conclusion')
  })

  it('retains successful pulls when the floor stops subsequent check requests', async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        Response.json(CAPTURED_PULL_LIST, {
          headers: { 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': '1791288060' },
        }),
      ),
    )
    const result = await readGitHub(transport)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain('2026-10-06T12:01:00.000Z')
    expect(result.data?.pullRequests).toHaveLength(1)
    expect(transport).toHaveBeenCalledOnce()
  })

  it('bounds full pages and retains facts already read', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      ...CAPTURED_PULL_LIST[0],
      number: index + 1,
    }))
    const transport = vi.fn(() => Promise.resolve(Response.json(fullPage)))
    const rig = networkRig({ transport, maxPages: 2, maxBytes: 256_000 })
    const result = await githubReportSource({ ...options, reader: rig.reader }).read(
      networkContext(),
    )
    expect(result.record.reason).toContain('page-bound')
    expect(transport).toHaveBeenCalledTimes(2)
    expect(result.data?.pullRequests).toHaveLength(100)
  })

  it('has no successful snapshot when every HTTP source fails validation', async () => {
    const rig = networkRig({
      transport: vi.fn(() => Promise.resolve(Response.json({ invented: true }))),
    })
    const observed16 = await githubReportSource({ ...options, reader: rig.reader }).read(
      networkContext(),
    )
    expect(observed16.record.status).toBe('unavailable')
  })
})

describe('gh report transport', () => {
  it('refuses credential-shaped refs and header values before spawning gh', async () => {
    const run = vi.fn<NonNullable<ReportGhOptions['run']>>()
    const secret = `ghp_${'a'.repeat(36)}`
    const transport = ghReportTransport({ run, probe: ghProbe, environment: {}, maxBytes: 4096 })
    await expect(
      transport(
        { url: `https://api.github.com/repos/a/b?ref=${secret}` },
        null,
        new AbortController().signal,
      ),
    ).rejects.toThrow('gh-secret-refused')
    await expect(
      transport({ url: 'https://api.github.com/repos/a/b' }, secret, new AbortController().signal),
    ).rejects.toThrow('gh-secret-refused')
    expect(run).not.toHaveBeenCalled()
  })
  it('uses gh login without any credential environment variable or token argument', async () => {
    const run = vi
      .fn<NonNullable<ReportGhOptions['run']>>()
      .mockResolvedValue({ stdout: 'HTTP/2.0 200 OK\r\nETag: "captured"\r\n\r\n{}', stderr: '' })
    const transport = ghReportTransport({
      run,
      probe: ghProbe,
      environment: {
        PATH: '/system/bin',
        GH_TOKEN: 'fixture-gh',
        gh_token: 'fixture-lower',
        GITHUB_TOKEN: 'fixture-github',
        META_API_KEY: 'fixture-meta',
        OTHER_API_KEY: 'fixture-other',
      },
      maxBytes: 4096,
    })
    const response = await transport(
      { url: 'https://api.github.com/repos/fixture/repo' },
      '"old"',
      new AbortController().signal,
    )
    expect(response.status).toBe(200)
    const args = run.mock.calls[0]?.[1]
    const settings = run.mock.calls[0]?.[2]
    expect(args).toContain('--include')
    expect(args).toContain('If-None-Match: "old"')
    expect(settings).toMatchObject({
      env: { PATH: '/system/bin' },
      windowsHide: true,
      maxBuffer: 4096,
    })
    expect(JSON.stringify(args)).not.toContain('fixture-gh')
    expect(settings?.env).toEqual({ PATH: '/system/bin' })
  })

  it.each([
    { platform: 'linux', pathVariable: ':.:./workspace:/trusted/bin', expected: '/trusted/bin/gh' },
    {
      platform: 'win32',
      pathVariable: String.raw`;.;relative\bin;C:\trusted\bin`,
      expected: String.raw`C:\trusted\bin\gh.exe`,
    },
  ] as const)('resolves gh without workspace PATH entries on $platform', async (probe) => {
    const fileExists = vi.fn(() => true)
    const run = vi
      .fn<NonNullable<ReportGhOptions['run']>>()
      .mockResolvedValue({ stdout: 'HTTP/2 200 OK\n\n{}', stderr: '' })
    await ghReportTransport({
      run,
      probe: { ...probe, fileExists },
      environment: {},
      maxBytes: 4096,
    })({ url: 'https://api.github.com/repos/fixture/repo' }, null, new AbortController().signal)
    expect(run.mock.calls[0]?.[0]).toBe(probe.expected)
    expect(fileExists).toHaveBeenCalledExactlyOnceWith(probe.expected)
  })

  it('refuses a missing gh executable instead of using a bare fallback', async () => {
    const run = vi
      .fn<NonNullable<ReportGhOptions['run']>>()
      .mockResolvedValue({ stdout: 'HTTP/2 200 OK\n\n{}', stderr: '' })
    await expect(
      ghReportTransport({
        run,
        probe: { ...ghProbe, fileExists: () => false },
        environment: {},
        maxBytes: 4096,
      })({ url: 'https://api.github.com/repos/a/b' }, null, new AbortController().signal),
    ).rejects.toThrow('gh-not-found')
    expect(run).not.toHaveBeenCalled()
  })

  it('preserves rate headers from gh nonzero HTTP exits without showing stderr', async () => {
    const run = vi.fn<NonNullable<ReportGhOptions['run']>>().mockRejectedValue({
      stdout: 'HTTP/2.0 429 Too Many Requests\nRetry-After: 60\n\n{}',
      stderr: 'must-never-show',
    })
    const response = await ghReportTransport({
      run,
      probe: ghProbe,
      environment: {},
      maxBytes: 4096,
    })({ url: 'https://api.github.com/repos/a/b' }, null, new AbortController().signal)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
  })

  it('supports gh 304 with no body', async () => {
    const run = vi
      .fn<NonNullable<ReportGhOptions['run']>>()
      .mockResolvedValue({ stdout: 'HTTP/2.0 304 Not Modified\nETag: "v1"\n\n', stderr: '' })
    const observed17 = await ghReportTransport({
      run,
      probe: ghProbe,
      environment: {},
      maxBytes: 4096,
    })({ url: 'https://api.github.com/repos/a/b' }, null, new AbortController().signal)
    expect(observed17.status).toBe(304)
  })

  it.each(['https://evil.invalid/repos/a/b', ['http:', '//api.github.com/repos/a/b'].join('')])(
    'refuses gh endpoint %s',
    async (url) => {
      const run = vi.fn<NonNullable<ReportGhOptions['run']>>()
      await expect(
        ghReportTransport({ run, probe: ghProbe, environment: {}, maxBytes: 4096 })(
          { url },
          null,
          new AbortController().signal,
        ),
      ).rejects.toThrow('gh-endpoint-refused')
      expect(run).not.toHaveBeenCalled()
    },
  )

  it.each(['no HTTP headers', 'HTTP/2 200 OK\ninvalid\n\n{}'])(
    'validates gh output %s',
    async (stdout) => {
      const run = vi
        .fn<NonNullable<ReportGhOptions['run']>>()
        .mockResolvedValue({ stdout, stderr: '' })
      await expect(
        ghReportTransport({ run, probe: ghProbe, environment: {}, maxBytes: 4096 })(
          { url: 'https://api.github.com/repos/a/b' },
          null,
          new AbortController().signal,
        ),
      ).rejects.toThrow('gh-response-invalid')
    },
  )
})
