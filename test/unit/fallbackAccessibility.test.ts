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
    entryPoints: ['test/unit/helpers/fallbackHarness.tsx'],
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
  it.each(themes)('%s, every fallback in all 15 languages at 320px', async (theme) => {
    const { page, origin } = rig
    if (page === undefined || origin === undefined) throw new Error('NO_BROWSER')
    for (const locale of ['en', ...TABLE_LOCALES]) {
      await page.goto(`${origin}/?bridge=${bridge}&theme=${theme}&locale=${locale}`)
      await page.waitForFunction('typeof window.showFallback === "function"')
      await page.addScriptTag({ content: axe.source })
      for (const kind of kinds) {
        await page.evaluate(`window.showFallback(${JSON.stringify(kind)})`)
        let selector = 'main h1'
        if (['confirm', 'picker', 'input'].includes(kind)) selector = '[role="dialog"]'
        else if (kind === 'toasts') selector = '.fallback-toast'
        else if (kind === 'status') selector = 'progress'
        await page.locator(selector).waitFor({ state: 'visible' })
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
      }
    }
  })
})
