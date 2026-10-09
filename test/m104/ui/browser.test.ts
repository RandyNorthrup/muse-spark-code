import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import type axe from 'axe-core'
import { chromium, webkit, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { EN, type UiText } from '../../../src/shared/l10n/en'
import { tableProblems } from '../../../src/shared/l10n/check'
import { setUiText } from '../../../src/shared/l10n/text'
import { renderWhatsNewPage } from '../../../src/host/whatsNew/whatsNewHtml'
import { parseWhatsNewContent } from '../../../src/core/whatsNew/whatsNewContent'
import { whatsNewFixtureContent } from './whatsNewContent'
import { TABLE_LOCALES } from '../../../src/shared/l10n/locales'

declare global {
  interface Window {
    axe: typeof axe
  }
}

const themes = ['light', 'dark', 'hc-light', 'hc-dark']
const locales = ['en', ...TABLE_LOCALES]
const modes = ['plans', 'diff', 'manager', 'walkthrough', 'roles', 'tasks', 'report', 'whatsNew']
const themeSchema = z.object({ bodyClass: z.string(), variables: z.record(z.string(), z.string()) })
const violationsSchema = z.array(
  z.object({ id: z.string(), nodes: z.array(z.object({ target: z.array(z.string()) })) }),
)
const fixture: { server?: Server; origin: string } = { origin: '' }
const browsers = new Map<string, Browser>()
const labelsSchema = z.object({
  plansTitle: z.string(),
  mcpTitleModelApi: z.string(),
  onboardingTitle: z.string(),
  tasksTabTitle: z.string(),
  reportTitle: z.string(),
  reviewAccepted: z.string(),
  whatsNewTitle: z.string(),
})
const labels = new Map<string, z.infer<typeof labelsSchema>>()

function isTable(value: unknown, locale: string): value is UiText {
  return tableProblems(EN, value, { locale, isStrict: false }).length === 0
}

beforeAll(async () => {
  const graph = await build({
    entryPoints: ['test/harness/presentation.tsx'],
    outdir: path.resolve('temp/m104-pc/browser'),
    write: false,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome128',
    minify: true,
    jsx: 'automatic',
    logLevel: 'silent',
  })
  const assets = new Map(
    graph.outputFiles.map((file) => [
      path.relative(path.resolve('temp/m104-pc/browser'), file.path).replaceAll('\\', '/'),
      file.contents,
    ]),
  )
  const axe = await readFile('node_modules/axe-core/axe.min.js')
  const notesScript = await build({
    entryPoints: ['test/harness/whatsNew.ts'],
    write: false,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome128',
    minify: true,
    logLevel: 'silent',
  })
  const notesStyles = await build({
    entryPoints: ['src/webview/whatsNew/whatsNew.css'],
    write: false,
    bundle: true,
    minify: true,
    logLevel: 'silent',
  })
  const notesCss = notesStyles.outputFiles[0]?.text
  if (notesCss === undefined) throw new Error('MISSING_NOTES_CSS')
  const tables = new Map<string, unknown>([['en', EN]])
  for (const locale of TABLE_LOCALES)
    tables.set(locale, JSON.parse(await readFile(`l10n/ui.${locale}.json`, 'utf8')))
  for (const [locale, table] of tables) labels.set(locale, labelsSchema.parse(table))
  const captured = new Map<string, z.infer<typeof themeSchema>>()
  for (const theme of themes)
    captured.set(
      theme,
      themeSchema.parse(JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8'))),
    )
  fixture.server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/') {
      const locale = url.searchParams.get('lang') ?? 'en'
      const theme = captured.get(url.searchParams.get('theme') ?? 'light')!
      const table = tables.get(locale)
      const css = Object.entries(theme.variables)
        .map(([key, value]) => `${key}:${value}`)
        .join(';')
      response.setHeader('Content-Type', 'text/html')
      if (url.searchParams.get('mode') === 'whatsNew') {
        if (!isTable(table, locale)) throw new Error('INVALID_FIXTURE_TABLE')
        setUiText(table, locale)
        const page = renderWhatsNewPage({
          releases: parseWhatsNewContent(whatsNewFixtureContent).releases,
          current: '0.14.3',
          from: undefined,
          isShownOnUpdate: true,
          locale,
          cspSource: fixture.origin,
          nonce: 'fixture-nonce',
          scriptUri: `${fixture.origin}/notes.js`,
          styleUri: `${fixture.origin}/notes.css?theme=${url.searchParams.get('theme') ?? 'light'}`,
        })
        response.end(page.html.replace('<body>', () => `<body class="${theme.bodyClass}">`))
        return
      }
      response.end(
        `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>Presentation fixture</title><style>:root{${css}}</style><link rel="stylesheet" href="/presentation.css"></head><body class="${theme.bodyClass}"><button id="opener">Fixture opener</button><div id="surface"></div><pre id="events" hidden></pre><script type="application/json" id="muse-l10n">${JSON.stringify({ locale, table }).replaceAll('<', String.raw`\u003c`)}</script><script src="/axe.js"></script><script type="module" src="/presentation.js"></script></body></html>`,
      )
      return
    }
    const theme = captured.get(url.searchParams.get('theme') ?? 'light')!
    const css = Object.entries(theme.variables)
      .map(([key, value]) => `${key}:${value}`)
      .join(';')
    let asset: Uint8Array | undefined
    switch (url.pathname) {
      case '/notes.js': {
        asset = notesScript.outputFiles[0]?.contents
        break
      }
      case '/notes.css': {
        asset = Buffer.from(`${notesCss}\n:root{${css}}`)
        break
      }
      case '/axe.js': {
        asset = axe
        break
      }
      default: {
        asset = assets.get(url.pathname.slice(1))
      }
    }
    response.statusCode = asset === undefined ? 404 : 200
    response.setHeader(
      'Content-Type',
      url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
    )
    response.end(asset)
  })
  await new Promise<void>((resolve) => fixture.server!.listen(0, '127.0.0.1', resolve))
  const address = fixture.server.address()
  if (address === null || typeof address === 'string') throw new Error('FIXTURE_BIND_FAILED')
  fixture.origin = `http://127.0.0.1:${String(address.port)}`
  browsers.set('chromium', await chromium.launch({ channel: 'chrome', headless: true }))
  const webkitExecutable = process.env['M104_WEBKIT_EXECUTABLE']
  browsers.set(
    'webkit',
    await webkit.launch({
      headless: true,
      ...(webkitExecutable !== undefined && { executablePath: webkitExecutable }),
    }),
  )
  // Cold engine/page setup is shared; each case retains its default deadline.
  for (const browser of browsers.values()) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await page.goto(fixture.origin)
      await page.locator('main').waitFor()
    } finally {
      await context.close()
    }
  }
})

afterAll(async () => {
  setUiText(EN, 'en')
  for (const browser of browsers.values()) await browser.close()
  await new Promise<void>((resolve, reject) =>
    fixture.server?.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    }),
  )
})

async function exercise(page: Page, mode: string): Promise<void> {
  switch (mode) {
    case 'plans': {
      await page.getByRole('button', { name: 'Exact plan' }).press('Enter')
      await page.locator('.presentation-document').waitFor()
      expect(
        await page
          .locator('.presentation-document')
          .evaluate((element) => element === document.activeElement),
      ).toBe(true)
      expect(await page.locator('.presentation-document').textContent()).toBe(
        '<script>Exact saved text</script>',
      )
      await page.locator('.fallback-actions button').first().click()
      expect(await page.locator('#events').textContent()).toContain('"open":"plan.md"')
      return
    }
    case 'diff': {
      await page.locator('.fallback-actions button').first().press('Enter')
      await page.getByRole('status').waitFor()
      expect(
        await page.getByRole('status').evaluate((element) => element === document.activeElement),
      ).toBe(true)
      expect(await page.locator('#events').textContent()).toContain('"decision":"accept"')
      return
    }
    case 'manager':
    case 'roles': {
      await page.locator('main button').first().click()
      expect(await page.locator('#events').textContent()).toContain(
        mode === 'roles' ? 'role' : 'server',
      )
      return
    }
    case 'walkthrough': {
      await page.locator('main button').first().press('Enter')
      expect(await page.locator('#events').textContent()).toContain('openSettings')
      return
    }
    case 'tasks': {
      await page.getByText('Exact task', { exact: true }).waitFor()
      await page.locator('.todo-window').click()
      expect(await page.locator('#events').textContent()).toContain('moveTasksToWindow')
      return
    }
    case 'whatsNew': {
      await page.locator('button[data-try]').first().press('Enter')
      await page.locator('a[data-link]').first().press('Enter')
      await page.locator('#hide-on-update').check()
      const events = await page.locator('#events').textContent()
      expect(events).toContain('"type":"tryIt","index":0')
      expect(events).toContain('"type":"openLink","index":0')
      expect(events).toContain('"type":"hideOnUpdate","isHidden":true')
      expect(page.url()).toContain('mode=whatsNew')
      return
    }
    default: {
      expect(await page.locator('.report-preview').inputValue()).toBe('Exact sealed preview')
      await page.locator('.report-actions button').first().click()
      expect(await page.locator('#events').textContent()).toContain('copy')
    }
  }
}

for (const engine of ['chromium', 'webkit']) {
  describe(engine, () => {
    for (const theme of themes) {
      it.each(locales.flatMap((locale) => modes.map((mode) => ({ locale, mode }))))(
        `${theme} installed language $locale / $mode: exact actions and WCAG`,
        async ({ locale, mode }) => {
          const browser = browsers.get(engine)!
          const context = await browser.newContext({ viewport: { width: 690, height: 760 } })
          await context.route('**/*', async (route) => {
            if (route.request().url().startsWith(`${fixture.origin}/`)) await route.continue()
            else await route.abort()
          })
          const page = await context.newPage()
          const errors: string[] = []
          page.on('pageerror', (error) => {
            errors.push(error.message)
          })
          try {
            await page.goto(`${fixture.origin}/?mode=${mode}&theme=${theme}&lang=${locale}`)
            await page.locator(mode === 'report' ? '[role="dialog"]' : 'main').waitFor()
            expect(await page.locator('html').getAttribute('lang')).toBe(locale)
            const text = labels.get(locale)!
            const title = {
              plans: text.plansTitle,
              manager: text.mcpTitleModelApi,
              walkthrough: text.onboardingTitle,
              tasks: text.tasksTabTitle.replace('{conversation}', 'Fixture'),
              report: text.reportTitle,
              whatsNew: text.whatsNewTitle,
            }
            if (Object.hasOwn(title, mode))
              await expect
                .poll(() => page.locator('h1,h2').first().textContent())
                .toBe(Reflect.get(title, mode))
            await exercise(page, mode)
            // Contrast is checked at the settled paint after finite entrance motion.
            await page.evaluate(async () => {
              await Promise.all(
                globalThis.document
                  .getAnimations()
                  .filter(
                    (animation) => animation.effect?.getComputedTiming().iterations !== Infinity,
                  )
                  .map((animation) => animation.finished),
              )
            })
            const violations: unknown = await page.evaluate(async () => {
              const axe = globalThis.window.axe
              const surface =
                globalThis.document.querySelector('#surface') ?? globalThis.document.body
              const result = await axe.run(surface, {
                runOnly: {
                  type: 'tag',
                  values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
                },
              })
              return result.violations
            })
            expect(violationsSchema.parse(violations), `${mode}/${theme}/${locale}`).toEqual([])
            expect(errors).toEqual([])
          } finally {
            await context.close()
          }
        },
      )
    }
    it('keeps dialogs modal, traps keyboard focus and restores the opener', async () => {
      const context = await browsers.get(engine)!.newContext()
      const page = await context.newPage()
      try {
        await page.goto(`${fixture.origin}/?mode=dialog`)
        const opener = page.locator('#opener')
        await opener.focus()
        await opener.press('Enter')
        await page.getByRole('dialog').waitFor()
        expect(
          await opener.evaluate((element) => element instanceof HTMLElement && element.inert),
        ).toBe(true)
        await page.keyboard.press('Shift+Tab')
        expect(
          await page
            .getByRole('dialog')
            .evaluate((element) => element.contains(document.activeElement)),
        ).toBe(true)
        await page.keyboard.press('Escape')
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        await expect
          .poll(() =>
            opener.evaluate(
              (element) =>
                element instanceof HTMLElement &&
                element === document.activeElement &&
                !element.inert,
            ),
          )
          .toBe(true)
        expect(await page.locator('#events').textContent()).toBe('[null]')
      } finally {
        await context.close()
      }
    })
  })
}
