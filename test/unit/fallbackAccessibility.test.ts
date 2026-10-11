import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import axe from 'axe-core'
import * as z from 'zod/mini'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { portableBridgeSetup } from '../harness/portableBridgeSetup.mjs'
import { MHP_PANEL } from '../../src/shared/constants'

const themes = ['light', 'dark', 'hc-light', 'hc-dark'] as const
const kinds = [
  'confirm',
  'picker',
  'input',
  'toasts',
  'status',
  'settings',
  'walkthrough',
  'diff',
  'terminal',
  'skills',
  'mcp',
  'hooks',
  'memory',
  'worktrees',
]
const resultSchema = z.object({
  violations: z.array(z.object({ id: z.string(), nodes: z.array(z.object({ html: z.string() })) })),
})
const rig: { server?: Server; browser?: Browser; page?: Page; origin?: string } = {}
const errors: string[] = []
const directory = path.resolve('temp/fallback-a11y')

beforeAll(async () => {
  await mkdir(directory, { recursive: true })
  await build({
    entryPoints: {
      main: 'src/webview/portable.tsx',
      whatsNew: 'src/webview/whatsNew/portable.ts',
      bridge: 'src/webview/bridges/select.ts',
      fallbacks: 'src/webview/fallbacks/index.ts',
      fallbackHarness: 'test/unit/helpers/fallbackHarness.tsx',
    },
    outdir: directory,
    bundle: true,
    format: 'esm',
    splitting: true,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const files = new Map<string, { content: string | Buffer; type: string }>()
  const server = createServer((request, response) => {
    const asset = files.get(request.url ?? '')
    if (asset === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, { 'Content-Type': asset.type })
    response.end(asset.content)
  })
  rig.server = server
  for (const file of ['fallbackHarness.js', 'fallbackHarness.css'])
    files.set(`/${file}`, {
      content: await readFile(path.join(directory, file)),
      type: file.endsWith('.css') ? 'text/css' : 'text/javascript',
    })
  // Read exactly the build's emitted chunks, never a path from a request.
  const { readdir } = await import('node:fs/promises')
  const emitted = await readdir(directory)
  for (const file of emitted)
    if (file.endsWith('.js'))
      files.set(`/${file}`, {
        content: await readFile(path.join(directory, file)),
        type: 'text/javascript',
      })
  for (const bridge of ['vscode', 'native', 'companion'])
    for (const surface of ['chat', 'tasks', 'whatsNew']) {
      const binding = { surface: 'startup', sessionId: 'test', surfaceKind: surface }
      const setup = portableBridgeSetup(bridge, MHP_PANEL.wireVersion)
      files.set(`/panel?bridge=${bridge}&surface=${surface}`, {
        content: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Portable startup</title><link rel="stylesheet" href="/${surface === 'whatsNew' ? 'whatsNew' : 'main'}.css"></head><body data-bridge="${bridge}" data-surface="${surface}"><div id="root"></div><a href="#" data-link="0">Link</a><button data-try="0">Try</button><input type="checkbox" id="hide-on-update"><script type="application/json" id="muse-l10n">${JSON.stringify({ locale: 'en', table: EN })}</script><script type="application/json" id="muse-panel">${JSON.stringify(binding)}</script><script>${setup}</script><script type="module" src="/${surface === 'whatsNew' ? 'whatsNew' : 'main'}.js"></script></body></html>`,
        type: 'text/html',
      })
    }
  files.set('/whatsNew.css', {
    content: await readFile(path.join(directory, 'whatsNew.css')),
    type: 'text/css',
  })
  files.set('/main.css', {
    content: await readFile(path.join(directory, 'main.css')),
    type: 'text/css',
  })
  for (const theme of themes)
    for (const locale of ['en', ...TABLE_LOCALES])
      for (const bridge of ['vscode', 'native', 'companion']) {
        const table: unknown =
          locale === 'en' ? EN : JSON.parse(await readFile(`l10n/ui.${locale}.json`, 'utf8'))
        const html = `<!doctype html><html lang="${locale}" data-theme="${theme}"><head><meta charset="utf-8"><title>Fallback accessibility</title><link rel="stylesheet" href="/fallbackHarness.css"></head><body><div id="root"></div><div id="prompts"></div><script type="application/json" id="muse-l10n">${JSON.stringify({ locale, table }).replaceAll('<', String.raw`\u003c`)}</script><script type="module" src="/fallbackHarness.js"></script></body></html>`
        files.set(`/?bridge=${bridge}&theme=${theme}&locale=${locale}`, {
          content: html,
          type: 'text/html',
        })
      }
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('NO_ADDRESS')
  rig.origin = `http://127.0.0.1:${String(address.port)}`
  const chrome = process.env['CHROME_PATH']
  const browser = await chromium.launch(
    chrome === undefined ? { channel: 'chrome' } : { executablePath: chrome },
  )
  rig.browser = browser
  const page = await browser.newPage({ viewport: { width: 320, height: 760 } })
  rig.page = page
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
})

describe.each(['vscode', 'native', 'companion'])('%s portable entry', (bridge) => {
  it.each(['chat', 'tasks', 'whatsNew'])(
    'mounts %s and posts its own vocabulary',
    async (surface) => {
      const { page, origin } = rig
      if (page === undefined || origin === undefined) throw new Error('NO_BROWSER')
      await page.goto(`${origin}/panel?bridge=${bridge}&surface=${surface}`, {
        waitUntil: 'networkidle',
      })
      if (surface === 'whatsNew') {
        await page.locator('[data-link]').click()
        await page.locator('[data-try]').click()
        await page.locator('#hide-on-update').check()
        await expect
          .poll(() => page.evaluate('window.fixturePosts'))
          .toEqual([
            { type: 'openLink', index: 0 },
            { type: 'tryIt', index: 0 },
            { type: 'hideOnUpdate', isHidden: true },
          ])
      } else {
        const type = surface === 'tasks' ? 'tasksReady' : 'ready'
        await page.waitForFunction(
          `window.fixturePosts.some(message => message.type === ${JSON.stringify(type)})`,
        )
        if (surface === 'tasks') {
          await page.evaluate(
            `window.fixtureReceive(${JSON.stringify({ type: 'tasksState', conversation: 'Startup test', items: [{ text: 'Verify entry', status: 'inProgress' }], ended: false, canMoveToWindow: false })})`,
          )
          await page.getByRole('heading', { name: 'Tasks: Startup test' }).waitFor()
          expect(await page.getByRole('textbox').count()).toBe(0)
        }
      }
      expect(errors, `${bridge}/${surface} startup errors`).toEqual([])
    },
  )
})
afterAll(async () => {
  await rig.browser?.close()
  const server = rig.server
  if (server !== undefined)
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
})

describe.each(['vscode', 'native', 'companion'])('%s fallback WCAG 2.2 AA', (bridge) => {
  it.each(
    themes.flatMap((theme) =>
      ['en', ...TABLE_LOCALES].flatMap((locale) => kinds.map((kind) => ({ theme, locale, kind }))),
    ),
  )('$theme/$locale/$kind at 320px', async ({ theme, locale, kind }) => {
    const { page, origin } = rig
    if (page === undefined || origin === undefined) throw new Error('NO_BROWSER')
    await page.goto(`${origin}/?bridge=${bridge}&theme=${theme}&locale=${locale}`)
    await page.waitForFunction('typeof window.showFallback === "function"')
    await page.addScriptTag({ content: axe.source })
    await page.evaluate(`window.showFallback(${JSON.stringify(kind)})`)
    let selector = 'main h1'
    if (['confirm', 'picker', 'input'].includes(kind)) selector = '[role="dialog"]'
    else if (kind === 'toasts') selector = '.fallback-toast'
    else if (kind === 'status') selector = 'progress'
    await page.locator(selector).waitFor({ state: 'visible' })
    // Audit settled colours after finite entrance motion; infinite status animation stays live.
    await page.evaluate(async () => {
      await Promise.all(
        globalThis.document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      )
    })
    expect(errors, `${bridge}/${theme}/${locale}/${kind} browser errors`).toEqual([])
    const raw: unknown = await page.evaluate(
      'axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })',
    )
    const result = resultSchema.parse(raw)
    expect(result.violations, `${bridge}/${theme}/${locale}/${kind}`).toEqual([])
    if (bridge === 'native' && locale === 'en')
      await page.screenshot({
        path: path.join(directory, `${theme}-${kind}.png`),
        animations: 'disabled',
      })
  })
})
