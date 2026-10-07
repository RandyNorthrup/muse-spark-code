import { createServer } from 'node:http'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import * as esbuild from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { companionUpload } from '../../src/runtime/companion/upload'
import { videoFixture } from './helpers/media/fixtures'
import { COMPANION_BROWSER_ENTRY } from './helpers/media/companionBrowser'
import { findChrome } from '../../scripts/lib/chrome.mjs'

const state = {
  root: '',
  origin: '',
  browser: undefined,
  server: undefined,
  outputs: {},
  uploads: [],
  cookies: [],
  cancelled: new globalThis.AbortController(),
}
const themes = ['light', 'dark', 'hc-light', 'hc-dark']
const normalize = (filename) => filename.replaceAll('\\', '/')

beforeAll(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), 'e3-browser-'))
  const built = await esbuild.build({
    entryPoints: [COMPANION_BROWSER_ENTRY],
    outdir: state.root,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  state.outputs = built.metafile.outputs
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome is required for this lane receipt')
  state.browser = await chromium.launch(
    path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
  )
  state.server = createServer((request, response) => {
    const requested = new URL(request.url ?? '/', state.origin).pathname
    const filename = path.basename(requested)
    void (async () => {
      if (requested === '/upload') {
        state.cookies.push(request.headers.cookie)
        await companionUpload({
          origin: state.origin,
          bearer: 'test-window-token',
          customHeader: { name: 'x-muse-guard', value: '1' },
          metadataHeader: 'x-muse-media',
          maxBytes: 1024 * 1024,
          temporaryRoot: state.root,
          signal: state.cancelled.signal,
          isCurrent: () => true,
          admit: () => Promise.resolve({ ok: true }),
          consume: async (source) => {
            state.uploads.push({
              name: source.name,
              info: source.info,
              bytes: await readFile(source.path),
              path: source.path,
            })
            return 'opaque-token'
          },
        })(request, response)
        return
      }
      if (requested === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end(
          '<!doctype html><html lang="en"><head><title>E3 media test</title><link rel="stylesheet" href="/companionBrowser.css"></head><body><main id="root"></main><script type="module" src="/companionBrowser.js"></script></body></html>',
        )
        return
      }
      if (!/^[\w-]+\.(?:js|css)$/u.test(filename)) {
        response.writeHead(404)
        response.end()
        return
      }
      try {
        const body = await readFile(path.join(state.root, filename))
        response.setHeader(
          'Content-Type',
          filename.endsWith('.js') ? 'text/javascript' : 'text/css',
        )
        response.end(body)
      } catch {
        response.writeHead(404)
        response.end()
      }
    })()
  })
  await new Promise((resolve) => {
    state.server.listen(0, '127.0.0.1', resolve)
  })
  const address = state.server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test listener')
  state.origin = `http://127.0.0.1:${String(address.port)}`
})
afterAll(async () => {
  state.cancelled.abort()
  await state.browser?.close()
  if (state.server !== undefined)
    await new Promise((resolve) => {
      state.server.close(resolve)
    })
  if (state.root !== '') await rm(state.root, { recursive: true, force: true })
})

describe('companion media at 320 px in real Chromium', () => {
  it('keeps browser scratch outside the checkout in the OS temporary directory', () => {
    expect(normalize(path.dirname(state.root))).toBe(normalize(tmpdir()))
  })
  it('loads the controls and preview only through a lazy browser chunk', () => {
    const outputs = new Map(
      Object.entries(state.outputs).map(([name, output]) => [normalize(name), output]),
    )
    const main = [...outputs].find(
      ([, output]) => normalize(output.entryPoint ?? '') === COMPANION_BROWSER_ENTRY,
    )
    expect(main).toBeDefined()
    const eager = new Set()
    const visit = (name) => {
      if (eager.has(name)) return
      eager.add(name)
      for (const imported of outputs.get(name).imports)
        if (!imported.external && imported.kind !== 'dynamic-import')
          visit(normalize(imported.path))
    }
    visit(main[0])
    const owners = [...outputs].filter(([, output]) =>
      Object.keys(output.inputs).some(
        (name) => normalize(name) === 'src/webview/media/CompanionMedia.tsx',
      ),
    )
    expect(owners).toHaveLength(1)
    expect(eager.has(owners[0][0])).toBe(false)
  })
  it('uploads a picked File through the real guarded route without browser byte reads', async () => {
    const page = await state.browser.newPage()
    try {
      await page.goto(state.origin)
      await page.getByLabel('Attach file…').setInputFiles({
        name: 'renamed.webm',
        mimeType: 'video/webm',
        buffer: Buffer.from(videoFixture()),
      })
      await page.locator('#root[data-attached="true"]').waitFor()
      expect(state.uploads).toHaveLength(1)
      expect(state.uploads[0].info.mediaType).toBe('video/mp4')
      expect(state.uploads[0].bytes).toEqual(Buffer.from(videoFixture()))
      await expect
        .poll(async () => {
          try {
            await readFile(state.uploads[0].path)
            return false
          } catch {
            return true
          }
        })
        .toBe(true)
    } finally {
      await page.close()
    }
  })
  it.each(['録画.mp4', 'запись.mp4', 'café 100% 🎥.mp4'])(
    'uploads Unicode filename %s through real browser headers',
    async (name) => {
      const page = await state.browser.newPage()
      const previous = state.uploads.length
      try {
        await page.goto(state.origin)
        await page.getByLabel('Attach file…').setInputFiles({
          name,
          mimeType: 'video/mp4',
          buffer: Buffer.from(videoFixture()),
        })
        await expect.poll(() => state.uploads.length).toBe(previous + 1)
        await page.locator('#root[data-attached="true"]').waitFor()
        expect(state.uploads.at(-1).name).toBe(name)
        expect(state.uploads.at(-1).bytes).toEqual(Buffer.from(videoFixture()))
      } finally {
        await page.close()
      }
    },
  )
  it('omits unrelated same-origin HttpOnly cookies while the no-cookie guard stays on', async () => {
    const context = await state.browser.newContext()
    const page = await context.newPage()
    const previous = state.uploads.length
    try {
      await context.addCookies([
        { name: 'unrelated-app', value: 'fake-cookie', url: state.origin, httpOnly: true },
      ])
      await page.goto(state.origin)
      expect(await context.cookies()).toHaveLength(1)
      await page.getByLabel('Attach file…').setInputFiles({
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from(videoFixture()),
      })
      await expect.poll(() => state.uploads.length).toBe(previous + 1)
      expect(state.cookies.at(-1)).toBeUndefined()
      await page.locator('#root[data-attached="true"]').waitFor()
    } finally {
      await context.close()
    }
  })
  it.each(themes)(
    '%s has no accessibility violations in controls or recording preview',
    async (theme) => {
      const variables = JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8'))
      const page = await state.browser.newPage({ viewport: { width: 320, height: 760 } })
      try {
        await page.goto(state.origin)
        await page.getByLabel('Attach file…').waitFor()
        await page.evaluate((colors) => {
          for (const [name, value] of Object.entries(colors))
            globalThis.document.documentElement.style.setProperty(name, value)
        }, variables.variables)
        await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
        const scan = async () =>
          await page.evaluate(async () => {
            const result = await globalThis.axe.run(globalThis.document, {
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
              },
            })
            return result.violations.map((violation) => ({
              id: violation.id,
              nodes: violation.nodes.map((node) => node.target),
            }))
          })
        expect(await scan()).toEqual([])
        await page.getByRole('button', { name: 'Start recording' }).click()
        await page.getByRole('button', { name: 'Stop recording' }).click()
        await page.getByLabel('Preview screen recording').waitFor()
        expect(await scan()).toEqual([])
        const dimensions = await page.evaluate(() => ({
          viewport: globalThis.innerWidth,
          content: globalThis.document.documentElement.scrollWidth,
        }))
        expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport)
        await page.getByRole('button', { name: 'Discard' }).focus()
        await page.keyboard.press('Enter')
        await page.locator('#root[data-disposed="true"]').waitFor()
        expect(await page.locator('#root').getAttribute('data-attached')).toBeNull()
      } finally {
        await page.close()
      }
    },
  )
})
