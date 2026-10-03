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

const manifest = { publisher: 'RandyNorthrup', name: 'muse-spark-code', version: '0.10.1' }
const bytes = Buffer.from('release artifact bytes')
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
