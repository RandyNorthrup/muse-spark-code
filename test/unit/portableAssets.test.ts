import { mkdtemp, writeFile, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import * as z from 'zod/mini'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { portablePage } from '../../src/runtime/panel/portablePage'
import { startCompanionServer } from '../../src/runtime/companion/server'
import { panelEnvelopeSchema, panelLifecycleSchema } from '../../src/shared/hostApi/panel'
import { fallbackUiCallSchema, fallbackUiReplySchema } from '../../src/shared/hostApi/fallbackUi'
import { portableManifestSchema } from '../../src/shared/hostApi/portableAssets'
import { buildPortableBundle } from './helpers/portableBundle'
import { removeFolder } from './helpers/temporaryFolders'

function ignoreSubscription() {
  /* This asset-only fixture has no controller events. */
}
function noSubscription() {
  return ignoreSubscription
}

const rig = { root: '' }
const theme = { kind: 'dark', tokens: {} } as const
beforeAll(async () => {
  rig.root = await mkdtemp(path.join(tmpdir(), 'm104-assets-'))
  await buildPortableBundle(rig.root)
})
afterAll(async () => {
  await removeFolder(rig.root)
})
const directory = () => path.join(rig.root, 'webview', 'portable')

it('admits only exact packaged module paths and refuses an unlisted module or linked asset', async () => {
  const page = await portablePage(directory(), theme)
  expect(page.assets.has('/assets/portable/main.js')).toBe(true)
  expect(page.assets.has('/assets/portable/whatsNew.js')).toBe(true)
  const extra = path.join(directory(), 'unexpected.js')
  await writeFile(extra, 'throw new Error()')
  try {
    await expect(portablePage(directory(), theme)).rejects.toThrow('UNLISTED')
  } finally {
    const { unlink } = await import('node:fs/promises')
    await unlink(extra)
  }
  const manifest = path.join(directory(), 'modules.json')
  const bytes = await readFile(manifest)
  const outside = path.join(rig.root, 'outside.json')
  await writeFile(outside, bytes)
  const { unlink } = await import('node:fs/promises')
  await unlink(manifest)
  await symlink(outside, manifest)
  try {
    await expect(portablePage(directory(), theme)).rejects.toThrow('ASSET_PATH')
  } finally {
    await unlink(manifest)
    await writeFile(manifest, bytes)
  }
})

it('loads the static and deferred authenticated graph under nonce CSP, and refuses altered module bytes', async () => {
  const page = await portablePage(directory(), theme)
  const assets = new Map(page.assets)
  const manifest = portableManifestSchema.parse(
    JSON.parse(await readFile(path.join(directory(), 'modules.json'), 'utf8')),
  )
  const originalManifest = JSON.stringify(manifest).replaceAll('<', String.raw`\u003c`)
  const rendering = { manifest: originalManifest }
  const start = () =>
    startCompanionServer({
      handler: {
        inputSchema: panelEnvelopeSchema,
        outputSchema: panelEnvelopeSchema,
        surfaceSchema: panelLifecycleSchema,
        surface: () => Promise.resolve(),
        post: () => Promise.resolve(),
        subscribe: noSubscription,
      },
      services: {
        inputSchema: fallbackUiReplySchema,
        outputSchema: fallbackUiCallSchema,
        post: () => Promise.resolve(),
        subscribe: noSubscription,
      },
      assets,
      renderPage: (nonce) =>
        page
          .render({ surface: 'asset-view', sessionId: 'fake', surfaceKind: 'chat' }, nonce)
          .replace(originalManifest, () => rendering.manifest),
      limits: {
        maxBodyBytes: 1_048_576,
        maxEventBytes: 1_048_576,
        requestTimeoutMs: 1000,
        idleTimeoutMs: 120_000,
        launchCodeTtlMs: 10_000,
        sessionTtlMs: 120_000,
        maxSessions: 4,
      },
    })
  let companion = await start()
  const code = new URLSearchParams(new URL(companion.launchUrl()).hash.slice(1)).get('k')
  const origin = new URL(companion.url).origin
  const headers = { Origin: origin, 'X-Muse-Panel': '1', 'Content-Type': 'application/json' }
  const session = await fetch(new URL('/session', companion.url), {
    method: 'POST',
    headers,
    body: JSON.stringify({ code }),
  })
  const bearer = session.headers.get('Authorization')
  if (bearer === null) throw new Error('Missing fake bearer')
  const post = (
    supplied: Record<string, string>,
    body = '{"jsonrpc":"2.0","id":"ui-1","result":null}',
  ) => fetch(new URL('/host/message', companion.url), { method: 'POST', headers: supplied, body })
  const noBearer = await post(headers)
  expect(noBearer.status).toBe(401)
  const foreign = await post({
    ...headers,
    Authorization: bearer,
    Origin: 'https://foreign.example.test',
  })
  expect(foreign.status).toBe(403)
  const noHeader = await post({
    Origin: origin,
    'Content-Type': 'application/json',
    Authorization: bearer,
  })
  expect(noHeader.status).toBe(403)
  const invalid = await post({ ...headers, Authorization: bearer }, '{}')
  expect(invalid.status).toBe(400)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext()
    const requests: string[] = []
    context.on('request', (request) => {
      requests.push(request.url())
    })
    const window = await context.newPage()
    const errors: string[] = []
    window.on('pageerror', (error) => {
      errors.push(error.message)
    })
    await window.goto(companion.launchUrl())
    await window.waitForFunction(() => Reflect.get(globalThis.window, 'musePanel') !== undefined)
    const isLazy = await window.evaluate(async () => {
      const loader = globalThis.window.museModules
      if (loader === undefined) throw new Error('Missing fake module loader')
      const value = await loader.import('/assets/portable/fallbacks.js')
      return typeof value === 'object' && value !== null && 'createFallbackUi' in value
    })
    expect(isLazy).toBe(true)
    expect(errors).toEqual([])
    const original = assets.get('/assets/portable/main.js')
    if (original === undefined) throw new Error('Missing main')
    assets.set('/assets/portable/main.js', {
      ...original,
      content: `${Buffer.from(original.content).toString('utf8')};window.tampered = true;`,
    })
    const corrupted = await context.newPage()
    await corrupted.goto(companion.launchUrl())
    await corrupted.waitForFunction(
      () =>
        document.documentElement.dataset['launch'] === 'failed' ||
        Reflect.get(globalThis.window, 'tampered') === true,
    )
    expect(await corrupted.evaluate(() => document.documentElement.dataset['launch'])).toBe(
      'failed',
    )
    expect(
      await corrupted.evaluate(() => {
        const value: unknown = Reflect.get(globalThis.window, 'tampered')
        return value
      }),
    ).toBeUndefined()
    expect(await corrupted.locator('#launch-error').isVisible()).toBe(true)
    assets.set('/assets/portable/main.js', original)
    for (const defect of ['duplicate', 'import-span', 'cycle', 'unlisted-import']) {
      // Each defect uses a fresh server with the same bounded session policy.
      await companion.close()
      companion = await start()
      const changed = structuredClone(manifest)
      const main = changed.modules.find((module) => module.path === '/assets/portable/main.js')
      const imported = main?.imports[0]
      if (main === undefined || imported === undefined)
        throw new Error('Missing static fixture import')
      if (defect === 'duplicate') changed.modules.push(main)
      else if (defect === 'import-span') imported.text = 'different import'
      else imported.target = defect === 'cycle' ? main.path : '/assets/portable/missing.js'
      rendering.manifest = JSON.stringify(portableManifestSchema.parse(changed)).replaceAll(
        '<',
        String.raw`\u003c`,
      )
      const refused = await context.newPage()
      await refused.goto(companion.launchUrl())
      await refused.waitForFunction(
        () =>
          document.documentElement.dataset['launch'] === 'failed' ||
          globalThis.window.musePanel !== undefined,
      )
      expect(await refused.evaluate(() => document.documentElement.dataset['launch']), defect).toBe(
        'failed',
      )
      expect(await refused.locator('#launch-error').isVisible(), defect).toBe(true)
      if (defect === 'unlisted-import')
        expect(requests.some((url) => url.endsWith('/assets/portable/missing.js'))).toBe(false)
    }
    // Unauthenticated module requests cannot execute outside the private fetch closure.
    const refused = await fetch(new URL('/assets/portable/main.js', companion.url))
    expect(refused.status).toBe(401)
    expect(z.string().parse(await window.evaluate(() => location.hash))).toBe('')
    await context.close()
  } finally {
    await browser.close()
    await companion.close()
  }
})
