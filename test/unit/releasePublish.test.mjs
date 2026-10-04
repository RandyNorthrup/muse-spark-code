import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  failureReason,
  publishRegistry,
  retryNetwork,
  verifyPublished,
} from '../../scripts/publish-registry.mjs'
import { releaseSummary } from '../../scripts/release-summary.mjs'
import { findBuild, verifyBuild } from '../../scripts/release-reuse.mjs'

const manifest = { publisher: 'RandyNorthrup', name: 'muse-spark-code', version: '0.10.1' }
const bytes = Buffer.from('release artifact bytes')
function packageManifest(command) {
  return JSON.stringify({
    name: command === 'unzip' ? 'muse-spark-code' : 'muse-spark-code-acp',
    version: manifest.version,
  })
}
const fixture = { directory: '', artifact: '' }
beforeEach(() => {
  mkdirSync('dist', { recursive: true })
  fixture.directory = mkdtempSync(path.join('dist', 'release-test-'))
  fixture.artifact = path.join(fixture.directory, 'artifact.vsix')
  writeFileSync(fixture.artifact, bytes)
})
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }))

describe('registry recovery', () => {
  it('retries fetch timeouts by their error name', async () => {
    const error = new globalThis.DOMException(
      'The operation was aborted due to timeout',
      'TimeoutError',
    )
    const action = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok')
    const sleep = vi.fn().mockResolvedValue()
    await expect(retryNetwork(action, sleep)).resolves.toBe('ok')
    expect(sleep).toHaveBeenCalledWith(20_000)
  })
  it.each([
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'getaddrinfo ENOTFOUND registry.npmjs.org',
    'HTTP 502',
    'HTTP 503',
    'HTTP 504',
    'npm ERR! code E503',
    'Failed request: (503)',
    'statusCode: 503',
    'registry request failed\n  status: 503',
  ])('retries %s exactly three times with 20/60-second backoff', async (message) => {
    const action = vi.fn().mockRejectedValue(new Error(message))
    const sleep = vi.fn().mockResolvedValue()
    await expect(retryNetwork(action, sleep)).rejects.toThrow(message)
    expect(action).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[20_000], [60_000]])
  })
  it.each([
    'EOTP',
    'HTTP 401',
    'HTTP 403',
    'HTTP 400',
    'Failed request: (403)',
    'invalid package',
    'version already exists',
  ])('never retries permanent failure %s', async (message) => {
    const action = vi.fn().mockRejectedValue(new Error(message))
    const sleep = vi.fn()
    await expect(retryNetwork(action, sleep)).rejects.toThrow(message)
    expect(action).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
  it('recovers after two resets using the real publish wrapper', async () => {
    const run = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('ECONNRESET')
      })
      .mockImplementationOnce(() => {
        throw new Error('ETIMEDOUT')
      })
      .mockReturnValue('ok')
    const sleep = vi.fn().mockResolvedValue()
    await publishRegistry('marketplace', fixture.artifact, manifest, { run, sleep })
    expect(run).toHaveBeenCalledTimes(3)
    expect(run).toHaveBeenLastCalledWith('./node_modules/.bin/vsce', [
      'publish',
      '--packagePath',
      fixture.artifact,
    ])
    expect(sleep.mock.calls).toEqual([[20_000], [60_000]])
  })
  it('keeps npm provenance, script suppression and the ./ tarball prefix', async () => {
    const run = vi.fn()
    await publishRegistry('npm', fixture.artifact, manifest, { run })
    expect(run).toHaveBeenCalledWith('npm', [
      'publish',
      `./${fixture.artifact}`,
      '--access',
      'public',
      '--ignore-scripts',
      '--provenance',
    ])
  })
  it('accepts existing Marketplace bytes only after decoding gallery gzip', async () => {
    const run = vi.fn(() => {
      throw new Error('version already exists')
    })
    const fetch = vi.fn().mockResolvedValue(new globalThis.Response(gzipSync(bytes)))
    await publishRegistry('marketplace', fixture.artifact, manifest, { run, fetch })
    expect(fetch.mock.calls[0][0]).toContain('/vsextensions/muse-spark-code/0.10.1/vspackage')
  })
  it.each(['marketplace', 'openvsx'])(
    'refuses a different existing %s artifact',
    async (channel) => {
      const fetch = vi.fn(async (url) =>
        url.includes('/api/')
          ? globalThis.Response.json({ files: { download: 'https://open-vsx.org/file.vsix' } })
          : new globalThis.Response('different bytes'),
      )
      await expect(verifyPublished(channel, fixture.artifact, manifest, { fetch })).rejects.toThrow(
        'differs',
      )
    },
  )
  it('follows Open VSX files.download, then verifies actual bytes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        globalThis.Response.json({ files: { download: 'https://open-vsx.org/file.vsix' } }),
      )
      .mockResolvedValueOnce(new globalThis.Response(bytes))
    await verifyPublished('openvsx', fixture.artifact, manifest, { fetch })
    expect(fetch.mock.calls[1][0]).toBe('https://open-vsx.org/file.vsix')
  })
  it('validates malformed Open VSX metadata at the schema boundary', async () => {
    const fetch = vi.fn().mockResolvedValue(globalThis.Response.json({ files: {} }))
    await expect(
      verifyPublished('openvsx', fixture.artifact, manifest, { fetch }),
    ).rejects.toHaveProperty('name', 'ZodError')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('refuses HTTP download URLs even when their bytes would match', async () => {
    const insecure = new URL('https://open-vsx.org/file.vsix')
    insecure.protocol = 'http:'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(globalThis.Response.json({ files: { download: insecure.href } }))
      .mockResolvedValueOnce(new globalThis.Response(bytes))
    await expect(verifyPublished('openvsx', fixture.artifact, manifest, { fetch })).rejects.toThrow(
      'must use HTTPS',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([404, 503])('refuses HTTP %s even with matching artifact bytes', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new globalThis.Response(bytes, { status }))
    await expect(
      verifyPublished('marketplace', fixture.artifact, manifest, { fetch }),
    ).rejects.toThrow(`HTTP ${status}`)
  })
  it.each([{ files: {} }, { files: { download: 'not-a-url' } }])(
    'refuses malformed metadata',
    async (metadata) => {
      await expect(
        verifyPublished('openvsx', fixture.artifact, manifest, {
          fetch: vi.fn().mockResolvedValue(globalThis.Response.json(metadata)),
        }),
      ).rejects.toThrow()
    },
  )
  it('does not convert an existing-version error into success on mismatch', async () => {
    const run = vi.fn(() => {
      throw new Error('already published')
    })
    const fetch = vi.fn().mockResolvedValue(new globalThis.Response('wrong artifact'))
    await expect(
      publishRegistry('marketplace', fixture.artifact, manifest, { run, fetch }),
    ).rejects.toThrow('differs')
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('compares npm sha512 integrity to our tarball, not just the version', async () => {
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    const run = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('cannot publish over previously published version')
      })
      .mockReturnValue(`${integrity}\n`)
    await publishRegistry('npm', fixture.artifact, manifest, { run })
    expect(run).toHaveBeenLastCalledWith('npm', [
      'view',
      'muse-spark-code-acp@0.10.1',
      'dist.integrity',
    ])
    await expect(
      verifyPublished('npm', fixture.artifact, manifest, {
        run: vi.fn().mockReturnValue('sha512-d3Jvbmc='),
      }),
    ).rejects.toThrow('differs')
    await expect(
      verifyPublished('npm', fixture.artifact, manifest, { run: vi.fn().mockReturnValue('') }),
    ).rejects.toThrow()
  })
  it('validates npm integrity at the schema boundary', async () => {
    await expect(
      verifyPublished('npm', fixture.artifact, manifest, { run: vi.fn().mockReturnValue('{}') }),
    ).rejects.toHaveProperty('name', 'ZodError')
  })
  it('creates an absent namespace and retries transient Open VSX publishing', async () => {
    const fetch = vi.fn().mockResolvedValue(new globalThis.Response(null, { status: 404 }))
    const run = vi
      .fn()
      .mockReturnValueOnce('created')
      .mockImplementationOnce(() => {
        throw new Error('HTTP 503')
      })
      .mockReturnValue('published')
    const sleep = vi.fn().mockResolvedValue()
    await publishRegistry('openvsx', fixture.artifact, manifest, { run, fetch, sleep })
    expect(run.mock.calls[0][0]).toBe(process.execPath)
    expect(run.mock.calls[0][1][0]).toMatch(/[/\\]ovsx[/\\]bin[/\\]ovsx$/)
    expect(run.mock.calls[0][1].slice(1)).toEqual([
      '--debug',
      'create-namespace',
      manifest.publisher,
    ])
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledWith(20_000)
  })
  it('refuses auth errors while checking namespace', async () => {
    const run = vi.fn()
    await expect(
      publishRegistry('openvsx', fixture.artifact, manifest, {
        run,
        fetch: vi.fn().mockResolvedValue(new globalThis.Response(null, { status: 403 })),
      }),
    ).rejects.toThrow('HTTP 403')
    expect(run).not.toHaveBeenCalled()
  })
})

/** A CLI failure as execFileSync throws it, with output in its stderr. */
function cliFailure(stderr) {
  return Object.assign(new Error('Command failed'), { stderr })
}

describe('publish failure labels', () => {
  it.each([
    ['npm error code EOTP\nnpm error This operation requires a one-time password', 'EOTP'],
    ['npm error code E401\nnpm error 401 Unauthorized', '(401)'],
    ['ERROR  Failed request: (403) Forbidden', '(403)'],
    ['npm error code E404\nnpm error 404 Not Found', '(404)'],
    ['read ECONNRESET', 'network attempts exhausted'],
    ['getaddrinfo ENOTFOUND registry.npmjs.org', 'network attempts exhausted'],
    ['something unexpected', 'publication refused'],
  ])('labels %j as %s', (stderr, label) => {
    expect(failureReason(cliFailure(stderr))).toContain(label)
  })

  it('labels a mismatch from our own check, not from the CLI', () => {
    expect(
      failureReason(new Error('npm published integrity differs from the release tarball')),
    ).toBe('the published artifact does not match the release')
  })

  it('never carries the CLI text, so a token in it cannot reach the log', () => {
    const token = 'npm_PLANTEDsecretTOKEN1234567890'
    for (const stderr of [
      `npm error code EOTP //registry.npmjs.org/:_authToken=${token}`,
      `401 Unauthorized ${token}`,
      `unknown failure ${token}`,
    ]) {
      expect(failureReason(cliFailure(stderr))).not.toContain(token)
    }
  })
})

describe('partial release summary dry exercise', () => {
  const success = { result: 'success', outputs: { outcome: 'published' } }
  it.each(['published', 'failed'])(
    'writes the actual CLI step summary and exits correctly for %s',
    (outcome) => {
      const summaryFile = path.join(fixture.directory, 'summary.md')
      const outputFile = path.join(fixture.directory, 'output.txt')
      const child = spawnSync(process.execPath, ['scripts/release-summary.mjs'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          RELEASE_NEEDS: JSON.stringify({
            release: success,
            publish: success,
            openvsx: success,
            npm: { result: outcome === 'published' ? 'success' : 'failure', outputs: { outcome } },
          }),
          GITHUB_STEP_SUMMARY: summaryFile,
          GITHUB_OUTPUT: outputFile,
        },
      })
      expect(child.status).toBe(outcome === 'published' ? 0 : 1)
      expect(readFileSync(summaryFile, 'utf8')).toContain(`| npm (ACP) | ${outcome} |`)
      expect(readFileSync(outputFile, 'utf8')).toBe(
        `all-published=${String(outcome === 'published')}\n`,
      )
    },
  )
  it('reports each channel and allows the M80 tag only when all published', () => {
    const summary = releaseSummary({
      release: success,
      publish: success,
      openvsx: success,
      npm: success,
    })
    expect(summary.failed).toBe(false)
    expect(summary.allPublished).toBe(true)
    expect(summary.markdown.match(/\| published \|/g)).toHaveLength(4)
  })
  it.each(['release', 'publish', 'openvsx', 'npm'])(
    'fails a half-published release when %s fails',
    (job) => {
      const summary = releaseSummary({
        release: success,
        publish: success,
        openvsx: success,
        npm: success,
        [job]: { result: 'failure' },
      })
      expect(summary.failed).toBe(true)
      expect(summary.allPublished).toBe(false)
      expect(summary.markdown).toContain('| failed |')
    },
  )
  it('reports missing secrets distinctly and holds the major tag', () => {
    const summary = releaseSummary({
      release: success,
      publish: success,
      openvsx: { result: 'success', outputs: { outcome: 'skipped-no-secret' } },
      npm: success,
    })
    expect(summary.failed).toBe(false)
    expect(summary.allPublished).toBe(false)
    expect(summary.markdown).toContain('| Open VSX | skipped-no-secret |')
  })
  it.each(['skipped', 'cancelled', 'failure', 'success'])(
    'refuses %s without a channel output',
    (result) => {
      expect(
        releaseSummary({ release: success, publish: success, openvsx: success, npm: { result } })
          .failed,
      ).toBe(true)
    },
  )
})

describe('exact-tree CI release reuse', () => {
  const tree = 'a'.repeat(40)
  const repository = 'RandyNorthrup/muse-spark-code'
  const run = {
    id: 42,
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'release-prep',
    head_sha: 'b'.repeat(40),
    repository: { full_name: repository },
    head_repository: { full_name: repository },
  }
  const artifacts = [
    'muse-spark-code-vsix',
    'muse-spark-code-acp',
    'muse-spark-code-sboms',
    `source-tree-${tree}`,
  ].map((name) => ({ name, expired: false }))
  function request(runs = [run], files = artifacts) {
    return vi
      .fn()
      .mockImplementation((endpoint) =>
        Promise.resolve(
          endpoint.includes('/artifacts?') ? { artifacts: files } : { workflow_runs: runs },
        ),
      )
  }
  function receipt() {
    const names = [
      'muse-spark-code-0.10.1.vsix',
      'muse-spark-code-acp-0.10.1.tgz',
      'muse-spark-code.cdx.json',
      'muse-spark-code-acp.cdx.json',
    ]
    const hashes = Object.fromEntries(
      names.map((name) => {
        writeFileSync(path.join(fixture.directory, name), bytes)
        return [name, createHash('sha256').update(bytes).digest('hex')]
      }),
    )
    rmSync(fixture.artifact)
    const record = { tree, commit: 'c'.repeat(40), sha256: hashes }
    writeFileSync(path.join(fixture.directory, 'release-build.json'), JSON.stringify(record))
    return record
  }
  it('matches the recorded merge tree even when the PR head SHA is different', async () => {
    expect(await findBuild(repository, tree, request())).toBe(run.id)
  })
  it.each([
    { head_repository: { full_name: 'fork/muse-spark-code' } },
    { head_repository: null },
    { repository: { full_name: 'fork/muse-spark-code' } },
    { event: 'workflow_dispatch' },
    { event: 'pull_request_target' },
    { event: 'push', head_branch: 'feature' },
    { path: '.github/workflows/release.yml' },
    { conclusion: 'failure' },
    { status: 'in_progress' },
  ])('refuses an ineligible run %j before reading its artifacts', async (change) => {
    const fetch = request([{ ...run, ...change }])
    expect(await findBuild(repository, tree, fetch)).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('accepts own-repository pushes to main', async () => {
    expect(
      await findBuild(repository, tree, request([{ ...run, event: 'push', head_branch: 'main' }])),
    ).toBe(run.id)
  })
  it('falls back when no run exists, the tree differs, or any artifact expired/missing', async () => {
    expect(await findBuild(repository, tree, request([]))).toBeUndefined()
    expect(await findBuild(repository, 'd'.repeat(40), request())).toBeUndefined()
    for (const artifact of artifacts) {
      expect(
        await findBuild(
          repository,
          tree,
          request(
            [run],
            artifacts.filter((entry) => entry !== artifact),
          ),
        ),
      ).toBeUndefined()
      expect(
        await findBuild(
          repository,
          tree,
          request(
            [run],
            artifacts.map((entry) => (entry === artifact ? { ...entry, expired: true } : entry)),
          ),
        ),
      ).toBeUndefined()
    }
  })
  it('continues to the next page and rejects malformed API data', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        workflow_runs: Array.from({ length: 100 }, () => ({ ...run, event: 'workflow_dispatch' })),
      })
      .mockResolvedValueOnce({ workflow_runs: [run] })
      .mockResolvedValueOnce({ artifacts })
    expect(await findBuild(repository, tree, fetch)).toBe(run.id)
    expect(fetch.mock.calls[1][0]).toContain('page=2')
    await expect(
      findBuild(repository, tree, vi.fn().mockResolvedValue({ workflow_runs: [{}] })),
    ).rejects.toHaveProperty('name', 'ZodError')
    await expect(findBuild(repository, tree, request([run], [{}]))).rejects.toHaveProperty(
      'name',
      'ZodError',
    )
  })
  it('checks both actual package manifests after all recorded hashes', () => {
    receipt()
    const execute = vi.fn(packageManifest)
    verifyBuild(fixture.directory, tree, manifest.version, execute)
    expect(execute.mock.calls.map(([command]) => command)).toEqual(['unzip', 'tar'])
    expect(execute.mock.calls[0][1].at(-1)).toBe('extension/package.json')
    expect(execute.mock.calls[1][1].at(-1)).toBe('package/package.json')
  })
  it('refuses a different receipt tree', () => {
    receipt()
    expect(() =>
      verifyBuild(fixture.directory, 'd'.repeat(40), manifest.version, packageManifest),
    ).toThrow('source tree mismatch')
  })
  it.each(['unzip', 'tar'])('refuses the wrong version or identity in %s', (changed) => {
    receipt()
    for (const change of [{ version: '0.10.0' }, { name: 'other-package' }]) {
      expect(() =>
        verifyBuild(fixture.directory, tree, manifest.version, (command) =>
          JSON.stringify({
            ...JSON.parse(packageManifest(command)),
            ...(command === changed && change),
          }),
        ),
      ).toThrow('package version or identity mismatch')
    }
  })
  it('refuses changed bytes in each of the four assets', () => {
    const record = receipt()
    for (const name of Object.keys(record.sha256)) {
      writeFileSync(path.join(fixture.directory, name), 'corrupt')
      expect(() => verifyBuild(fixture.directory, tree, manifest.version, packageManifest)).toThrow(
        'asset SHA-256 mismatch',
      )
      writeFileSync(path.join(fixture.directory, name), bytes)
    }
  })
  it('refuses extra assets, omitted hashes and malformed receipts', () => {
    const record = receipt()
    writeFileSync(path.join(fixture.directory, 'extra.vsix'), bytes)
    expect(() => verifyBuild(fixture.directory, tree, manifest.version, packageManifest)).toThrow(
      'asset inventory mismatch',
    )
    rmSync(path.join(fixture.directory, 'extra.vsix'))
    delete record.sha256['muse-spark-code.cdx.json']
    writeFileSync(path.join(fixture.directory, 'release-build.json'), JSON.stringify(record))
    expect(() => verifyBuild(fixture.directory, tree, manifest.version, packageManifest)).toThrow(
      'asset inventory mismatch',
    )
    writeFileSync(path.join(fixture.directory, 'release-build.json'), '{}')
    expect(() =>
      verifyBuild(fixture.directory, tree, manifest.version, packageManifest),
    ).toThrowError(expect.objectContaining({ name: 'ZodError' }))
  })
  it.each(['find', 'verify'])('the %s CLI reports fallback without failing its job', (mode) => {
    const summary = path.join('dist', `relfast-${mode}-summary.md`)
    const output = path.join('dist', `relfast-${mode}-output.txt`)
    try {
      writeFileSync(summary, '')
      writeFileSync(output, '')
      const child = spawnSync(
        process.execPath,
        ['scripts/release-reuse.mjs', mode, fixture.directory],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            FORCE_REBUILD: 'true',
            GITHUB_REPOSITORY: 'invalid repository',
            GH_TOKEN: '',
            GITHUB_STEP_SUMMARY: summary,
            GITHUB_OUTPUT: output,
          },
        },
      )
      expect(child.status, child.stderr).toBe(0)
      expect(readFileSync(summary, 'utf8')).toContain(
        mode === 'find'
          ? 'Full rebuild: RELEASE_FORCE_REBUILD requested.'
          : 'Full rebuild: CI artifacts failed',
      )
      expect(readFileSync(output, 'utf8')).toContain(
        mode === 'find' ? 'run-id=\n' : 'reused=false\n',
      )
    } finally {
      rmSync(summary, { force: true })
      rmSync(output, { force: true })
    }
  })
})
