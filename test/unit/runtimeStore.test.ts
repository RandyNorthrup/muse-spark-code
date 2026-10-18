// The runtime store's closed reasons (src/host/browser/runtime/runtimeStore.ts):
// every failure of a preparation becomes one fixed reason word — a refused
// download is missing, a wrong archive is integrity, an ended lifetime is
// its ending — and nothing the failure said leaves the module.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimePrepareRequest, RuntimePreparation } from '../../src/core/browser/runtimeTypes'
import manifest from '../../src/host/browser/runtime/browserRuntime.json'
import { prepareRuntime, type RuntimeStoreDeps } from '../../src/host/browser/runtime/runtimeStore'

function request(
  storageDir: string,
  overrides: Partial<RuntimePrepareRequest> = {},
): RuntimePrepareRequest {
  const controller = new AbortController()
  return {
    storageDir,
    lifetime: {
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
      step: (run) => run(controller.signal),
      onEnd: () => undefined,
    },
    admissionStillValid: () => true,
    consent: () => Promise.resolve('download'),
    ...overrides,
  }
}

function deps(
  fetch: RuntimeStoreDeps['fetch'],
  overrides: Partial<RuntimeStoreDeps> = {},
): RuntimeStoreDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    now: () => Date.now(),
    fetch,
    manifest,
    ...overrides,
  }
}

async function storage(): Promise<{ readonly dir: string; readonly cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'runtime-store-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const notFound: RuntimeStoreDeps['fetch'] = () =>
  Promise.resolve(new Response('gone', { status: 404 }))

describe('prepareRuntime failures', () => {
  it('reads a refused download as missing, in closed words', async () => {
    const area = await storage()
    try {
      const preparation: RuntimePreparation = await prepareRuntime(
        request(area.dir),
        deps(notFound),
      )
      expect(preparation).toEqual({ ok: false, reason: 'runtimeMissing' })
    } finally {
      await area.cleanup()
    }
  })

  it('reads a declined consent as declined without downloading', async () => {
    const area = await storage()
    try {
      let downloads = 0
      const preparation: RuntimePreparation = await prepareRuntime(
        request(area.dir, { consent: () => Promise.resolve('decline') }),
        deps(() => {
          downloads += 1
          return Promise.resolve(new Response('gone', { status: 404 }))
        }),
      )
      expect(preparation).toEqual({ ok: false, reason: 'runtimeDeclined' })
      expect(downloads).toBe(0)
    } finally {
      await area.cleanup()
    }
  })

  it('reads a wrong archive length as an integrity failure', async () => {
    const area = await storage()
    try {
      const preparation: RuntimePreparation = await prepareRuntime(
        request(area.dir),
        deps(() =>
          Promise.resolve(new Response('x', { status: 200, headers: { 'content-length': '1' } })),
        ),
      )
      expect(preparation).toEqual({ ok: false, reason: 'runtimeIntegrity' })
    } finally {
      await area.cleanup()
    }
  })

  it('reads a redirect off the pinned origin as missing', async () => {
    const area = await storage()
    try {
      const preparation: RuntimePreparation = await prepareRuntime(
        request(area.dir),
        deps(() =>
          Promise.resolve(
            new Response('elsewhere', {
              status: 302,
              headers: { location: 'https://elsewhere.example/archive.zip' },
            }),
          ),
        ),
      )
      expect(preparation).toEqual({ ok: false, reason: 'runtimeMissing' })
    } finally {
      await area.cleanup()
    }
  })

  it('reads an ended lifetime as cancelled, with nothing attached', async () => {
    const area = await storage()
    try {
      const controller = new AbortController()
      controller.abort()
      const preparation: RuntimePreparation = await prepareRuntime(
        request(area.dir, {
          lifetime: {
            signal: controller.signal,
            deadlineAt: Date.now(),
            step: (run) => run(controller.signal),
            onEnd: () => undefined,
          },
        }),
        deps(notFound),
      )
      expect(preparation).toEqual({ ok: false, reason: 'cancelled' })
    } finally {
      await area.cleanup()
    }
  })

  it('reads a lost admission as not offered', async () => {
    const area = await storage()
    try {
      const preparation: RuntimePreparation = await prepareRuntime(
        request(area.dir, { admissionStillValid: () => false }),
        deps(notFound),
      )
      expect(preparation).toEqual({ ok: false, reason: 'notOffered' })
    } finally {
      await area.cleanup()
    }
  })

  it('reads a broken pin as an integrity failure', async () => {
    const area = await storage()
    try {
      const preparation: RuntimePreparation = await prepareRuntime(
        request(area.dir),
        deps(notFound, { manifest: {} }),
      )
      expect(preparation).toEqual({ ok: false, reason: 'runtimeIntegrity' })
    } finally {
      await area.cleanup()
    }
  })
})
