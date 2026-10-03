// The browser check's runtime store (M81 A1, design spec v4 §§4.1–4.4) on a
// real folder with a scripted network: the pinned archive downloaded after
// consent, checked, extracted and published once; a published runtime
// verified by its receipt and metadata, and hashed again when they changed;
// redirects, sizes and hashes held to the pin; concurrent installs
// converging on one verified winner; a corrupt winner refused, never
// overwritten; cancellation, admission and the lifetime's bound; and every
// failure one of the closed reasons.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimePrepareRequest } from '../../src/core/browser/runtimeTypes'
import { createLifetime } from '../../src/core/browser/workLifetime'
import shipped from '../../src/host/browser/runtime/browserRuntime.json'
import { prepareRuntime, type RuntimeStoreDeps } from '../../src/host/browser/runtime/runtimeStore'
import { buildZip, type ZipFileSpec } from './helpers/zipBuilder'

const DAY = 86_400_000
const PUBLISHED = 1_790_706_629_983
const URL_LINUX = shipped.platforms.linux64.url
const EXECUTABLE = 'chrome-headless-shell-linux64/chrome-headless-shell'
const SHELL = Buffer.from('#!/bin/sh\necho pinned headless shell\n')
const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

function storage(): string {
  const made = mkdtempSync(path.join(tmpdir(), 'm81-store-'))
  folders.push(made)
  return made
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

interface Pin {
  readonly archive: Buffer
  readonly manifest: typeof shipped
}

/** A pin whose linux64 record is a small test archive of the pinned shape. */
function pin(
  files: readonly ZipFileSpec[] = [
    { name: EXECUTABLE, data: SHELL, mode: 0o10_0755 },
    {
      name: 'chrome-headless-shell-linux64/libEGL.so',
      data: Buffer.alloc(512, 1),
      mode: 0o10_0755,
    },
    { name: 'chrome-headless-shell-linux64/locales/en-US.pak', data: Buffer.from('pak') },
  ],
): Pin {
  const archive = buildZip(files)
  const manifest = structuredClone(shipped)
  manifest.platforms.linux64 = {
    url: URL_LINUX,
    archiveBytes: archive.length,
    archiveSha256: sha256(archive),
    entryCount: files.length,
    extractedBytes: files.reduce((sum, file) => sum + (file.size ?? file.data.length), 0),
    executable: EXECUTABLE,
    executableBytes: SHELL.length,
    executableSha256: sha256(SHELL),
    executableEntries: [EXECUTABLE, 'chrome-headless-shell-linux64/libEGL.so'],
  }
  return { archive, manifest }
}

type Served = (url: string, init: RequestInit) => Response | Promise<Response>

function deps(test: Pin, serve?: Served, overrides: Partial<RuntimeStoreDeps> = {}) {
  const fetch = vi.fn(async (url: string, init: RequestInit) =>
    serve === undefined
      ? new Response(new Uint8Array(test.archive), {
          status: 200,
          headers: { 'Content-Length': String(test.archive.length) },
        })
      : await serve(url, init),
  )
  const store: RuntimeStoreDeps = {
    platform: 'linux',
    arch: 'x64',
    now: () => PUBLISHED + DAY,
    fetch,
    manifest: test.manifest,
    ...overrides,
  }
  return { store, fetch }
}

function request(
  storageDir: string,
  overrides: Partial<RuntimePrepareRequest> = {},
  ms = 10_000,
): RuntimePrepareRequest & { readonly consented: string[] } {
  const consented: string[] = []
  return {
    storageDir,
    lifetime: createLifetime(ms, [], 1000),
    admissionStillValid: () => true,
    consent: (version, bytes) => {
      consented.push(`${version} ${String(bytes)}`)
      return Promise.resolve('download')
    },
    consented,
    ...overrides,
  }
}

function finalDir(dir: string): string {
  return path.join(dir, 'browser-runtime', '154.0.8037.92', 'linux64')
}

/** A redirect to `location`. */
function hop(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } })
}

describe('the runtime store (M81 A1)', () => {
  it('asks, downloads the exact pinned URL, verifies, extracts and publishes once, and leaves no stage', async () => {
    const dir = storage()
    const test = pin()
    const { store, fetch } = deps(test)
    const prepare = request(dir)
    const result = await prepareRuntime(prepare, store)
    expect(prepare.consented).toEqual([`154.0.8037.92 ${String(test.archive.length)}`])
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([URL_LINUX])
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
    expect(result).toEqual({
      ok: true,
      runtime: {
        version: '154.0.8037.92',
        platform: 'linux64',
        executable: path.join(realpathSync(finalDir(dir)), ...EXECUTABLE.split('/')),
        manifestDigest: expect.stringMatching(/^[\da-f]{64}$/),
        executableDigest: sha256(SHELL),
        executableBytes: SHELL.length,
        executableMtimeMs: expect.any(Number),
        publishedAtMs: PUBLISHED,
      },
    })
    expect(readFileSync(path.join(finalDir(dir), ...EXECUTABLE.split('/')))).toEqual(SHELL)
    const receipt = JSON.parse(
      readFileSync(path.join(finalDir(dir), '.muse-receipt.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(receipt).toMatchObject({
      version: '154.0.8037.92',
      platform: 'linux64',
      archiveSha256: test.manifest.platforms.linux64.archiveSha256,
    })
    expect(
      readdirSync(path.join(dir, 'browser-runtime')).filter((name) => name.startsWith('.stage-')),
    ).toEqual([])
    prepare.lifetime.end()
  })

  it('uses a published runtime without asking or downloading, hashing it again only when its metadata changed', async () => {
    const dir = storage()
    const test = pin()
    const first = request(dir)
    await prepareRuntime(first, deps(test).store)
    first.lifetime.end()
    const again = deps(test)
    const second = request(dir)
    const result = await prepareRuntime(second, again.store)
    expect(result.ok).toBe(true)
    expect(second.consented).toEqual([])
    expect(again.fetch).not.toHaveBeenCalled()

    // Touched but the same bytes: hashed again, still the pin.
    const executable = path.join(finalDir(dir), ...EXECUTABLE.split('/'))
    utimesSync(executable, new Date(), new Date(Date.now() + 5000))
    expect(await prepareRuntime(request(dir), again.store)).toMatchObject({ ok: true })

    // Other bytes at the same length: refused.
    const tampered = Buffer.from(SHELL)
    tampered[0] = 0x23 + 1
    writeFileSync(executable, tampered)
    expect(await prepareRuntime(request(dir), again.store)).toEqual({
      ok: false,
      reason: 'runtimeIntegrity',
    })
    // Another length: refused, and never overwritten by a new download.
    appendFileSync(executable, 'x')
    expect(await prepareRuntime(request(dir), again.store)).toEqual({
      ok: false,
      reason: 'runtimeIntegrity',
    })
    expect(again.fetch).not.toHaveBeenCalled()
  })

  it('refuses a published folder whose receipt is missing, malformed or another pin’s', async () => {
    for (const receipt of [undefined, 'not json', JSON.stringify({ schemaVersion: 1 })]) {
      const dir = storage()
      const test = pin()
      await prepareRuntime(request(dir), deps(test).store)
      const file = path.join(finalDir(dir), '.muse-receipt.json')
      if (receipt === undefined) {
        rmSync(file)
      } else {
        writeFileSync(file, receipt)
      }
      expect(await prepareRuntime(request(dir), deps(test).store), String(receipt)).toEqual({
        ok: false,
        reason: 'runtimeIntegrity',
      })
    }
  })

  it('downloads nothing without consent, and creates nothing when the user declined', async () => {
    const dir = storage()
    const test = pin()
    const { store, fetch } = deps(test)
    const result = await prepareRuntime(
      request(dir, { consent: () => Promise.resolve('decline') }),
      store,
    )
    expect(result).toEqual({ ok: false, reason: 'runtimeDeclined' })
    expect(fetch).not.toHaveBeenCalled()
    expect(existsSync(path.join(dir, 'browser-runtime'))).toBe(false)
  })

  it('refuses an unsupported platform, a stale pin and a manifest that is not one, before any download', async () => {
    const test = pin()
    const dir = storage()
    expect(
      await prepareRuntime(request(dir), deps(test, undefined, { arch: 'arm64' }).store),
    ).toEqual({
      ok: false,
      reason: 'runtimeUnsupported',
    })
    expect(
      await prepareRuntime(
        request(dir),
        deps(test, undefined, { now: () => PUBLISHED + 45 * DAY }).store,
      ),
    ).toEqual({ ok: false, reason: 'runtimeOutdated' })
    expect(
      await prepareRuntime(request(dir), deps(test, undefined, { manifest: {} }).store),
    ).toEqual({
      ok: false,
      reason: 'runtimeIntegrity',
    })
  })

  it('refuses when admission is gone, before and after the consent', async () => {
    const test = pin()
    expect(
      await prepareRuntime(
        request(storage(), { admissionStillValid: () => false }),
        deps(test).store,
      ),
    ).toEqual({ ok: false, reason: 'notOffered' })
    let isAdmitted = true
    const { store, fetch } = deps(test)
    const result = await prepareRuntime(
      request(storage(), {
        admissionStillValid: () => isAdmitted,
        consent: () => {
          isAdmitted = false
          return Promise.resolve('download')
        },
      }),
      store,
    )
    expect(result).toEqual({ ok: false, reason: 'notOffered' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('follows at most three redirects within the pinned storage path, and refuses any other', async () => {
    const test = pin()
    const within = `https://storage.googleapis.com/chrome-for-testing-public/154.0.8037.92/linux64/mirror.zip`
    let calls = 0
    const followed = await prepareRuntime(
      request(storage()),
      deps(test, (url) => {
        calls += 1
        return url === URL_LINUX
          ? hop(within)
          : new Response(new Uint8Array(test.archive), { status: 200 })
      }).store,
    )
    expect(followed.ok).toBe(true)
    expect(calls).toBe(2)
    for (const location of [
      'https://evil.example/chrome-for-testing-public/x.zip',
      'https://storage.googleapis.com/chrome-for-testing-public/x.zip',
      'https://storage.googleapis.com/other-bucket/x.zip',
      'https://user:pass@storage.googleapis.com/chrome-for-testing-public/x.zip',
    ]) {
      expect(
        await prepareRuntime(request(storage()), deps(test, () => hop(location)).store),
        location,
      ).toEqual({
        ok: false,
        reason: 'runtimeMissing',
      })
    }
    expect(await prepareRuntime(request(storage()), deps(test, () => hop(within)).store)).toEqual({
      ok: false,
      reason: 'runtimeMissing',
    })
  })

  it('refuses a failed request, a wrong length, a transfer past its 1% slack and a wrong hash', async () => {
    const test = pin()
    const cases: [Served, string][] = [
      [() => new Response('not found', { status: 404 }), 'runtimeMissing'],
      [() => Promise.reject(new TypeError('fetch failed: ECONNRESET 10.1.2.3')), 'runtimeMissing'],
      [
        () =>
          new Response(new Uint8Array(test.archive), {
            status: 200,
            headers: { 'Content-Length': '1' },
          }),
        'runtimeIntegrity',
      ],
      [
        () =>
          new Response(
            new Uint8Array(Buffer.concat([test.archive, Buffer.alloc(test.archive.length)])),
            { status: 200 },
          ),
        'runtimeIntegrity',
      ],
      [
        () =>
          new Response(new Uint8Array(Buffer.concat([test.archive, Buffer.from('x')])), {
            status: 200,
          }),
        'runtimeIntegrity',
      ],
      [
        () => new Response(new Uint8Array(test.archive.length).fill(1), { status: 200 }),
        'runtimeIntegrity',
      ],
    ]
    for (const [serve, reason] of cases) {
      const dir = storage()
      expect(await prepareRuntime(request(dir), deps(test, serve).store), reason).toEqual({
        ok: false,
        reason,
      })
      expect(existsSync(finalDir(dir)), reason).toBe(false)
      expect(
        readdirSync(path.join(dir, 'browser-runtime')).filter((name) => name.startsWith('.stage-')),
        reason,
      ).toEqual([])
    }
  })

  it('refuses a pinned archive the ZIP reader refuses, and an executable that is not the pin’s', async () => {
    const traversal = pin([
      { name: EXECUTABLE, data: SHELL, mode: 0o10_0755 },
      { name: '../outside', data: Buffer.from('x') },
    ])
    expect(await prepareRuntime(request(storage()), deps(traversal).store)).toEqual({
      ok: false,
      reason: 'runtimeIntegrity',
    })
    const other = pin()
    other.manifest.platforms.linux64.executableSha256 = sha256(Buffer.from('another shell'))
    expect(await prepareRuntime(request(storage()), deps(other).store)).toEqual({
      ok: false,
      reason: 'runtimeIntegrity',
    })
  })

  it('lets two windows install at once: each its own stage, one winner, both verified', async () => {
    const dir = storage()
    const test = pin()
    const [first, second] = await Promise.all([
      prepareRuntime(request(dir), deps(test).store),
      prepareRuntime(request(dir), deps(test).store),
    ])
    expect(first.ok && second.ok).toBe(true)
    expect(first.ok && second.ok && first.runtime.executable === second.runtime.executable).toBe(
      true,
    )
    expect(
      readdirSync(path.join(dir, 'browser-runtime')).filter((name) => name.startsWith('.stage-')),
    ).toEqual([])
  })

  it('refuses a corrupt winner and never overwrites or merges it', async () => {
    const dir = storage()
    const test = pin()
    mkdirSync(path.join(finalDir(dir), 'chrome-headless-shell-linux64'), { recursive: true })
    writeFileSync(
      path.join(finalDir(dir), 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      'planted',
    )
    expect(await prepareRuntime(request(dir), deps(test).store)).toEqual({
      ok: false,
      reason: 'runtimeIntegrity',
    })
    expect(
      readFileSync(
        path.join(finalDir(dir), 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        'utf8',
      ),
    ).toBe('planted')
  })

  it('stops a transfer under way when the preparation ends, and at its own bound', async () => {
    const test = pin()
    const stalled: Served = (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(test.archive.subarray(0, 10))
            init.signal?.addEventListener('abort', () => {
              controller.error(new Error('aborted'))
            })
          },
        }),
        { status: 200 },
      )
    const dir = storage()
    const cancelled = request(dir)
    const pending = prepareRuntime(cancelled, deps(test, stalled).store)
    setTimeout(() => {
      cancelled.lifetime.end()
    }, 50)
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' })
    expect(await prepareRuntime(request(storage(), {}, 100), deps(test, stalled).store)).toEqual({
      ok: false,
      reason: 'preparationTimedOut',
    })
    // Its own stage is gone with it.
    await vi.waitFor(() => {
      expect(
        readdirSync(path.join(dir, 'browser-runtime')).filter((name) => name.startsWith('.stage-')),
      ).toEqual([])
    })
  })

  it('sweeps a stage whose owner process is gone, and keeps one whose owner is unknown', async () => {
    const dir = storage()
    const root = path.join(dir, 'browser-runtime')
    mkdirSync(path.join(root, '.stage-dead'), { recursive: true })
    writeFileSync(path.join(root, '.stage-dead', 'owner'), '2147483646')
    mkdirSync(path.join(root, '.stage-unknown'), { recursive: true })
    await prepareRuntime(request(dir), deps(pin()).store)
    expect(existsSync(path.join(root, '.stage-dead'))).toBe(false)
    expect(existsSync(path.join(root, '.stage-unknown'))).toBe(true)
  })
})
