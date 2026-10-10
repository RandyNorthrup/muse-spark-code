import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

const output = 'temp/cm962-harness'
await mkdir(output, { recursive: true })
await build({
  entryPoints: ['test/harness/teamRoles.tsx'],
  outfile: `${output}/teamRoles.js`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome132',
  jsx: 'automatic',
})
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome is unavailable')
const { server, port } = await serveRepo(process.cwd())
const browser = await chromium.launch(
  path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
)
const axe = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
const themes = ['light', 'dark', 'hc-light', 'hc-dark', 'one-dark-pro', 'dracula']
const scenes = ['empty', 'template', 'validation', 'suggestions', 'preview', 'in-place', 'agents']
const languages = [
  'en',
  'zh-cn',
  'zh-tw',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt-br',
  'ru',
  'it',
  'tr',
  'pl',
  'cs',
  'hu',
]
const results = []
const shots = []
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  const cases = languages.flatMap((language) =>
    themes.flatMap((theme) =>
      (language === 'en' ? [320, 690] : [320]).flatMap((width) =>
        (language === 'en' ? scenes : ['template']).map((scene) => ({
          language,
          theme,
          width,
          scene,
        })),
      ),
    ),
  )
  for (const { language, theme, width, scene } of cases) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(
      `http://127.0.0.1:${String(port)}/test/harness/teamRoles.html?lang=${language}&theme=${theme}&scene=${scene}`,
    )
    try {
      await page.locator('[data-team-ready]').waitFor()
    } catch (error) {
      throw new Error(`${language}/${theme}/${String(width)}/${scene}: ${errors.join(' ')}`, {
        cause: error,
      })
    }
    await page
      .locator(scene === 'agents' ? '[role=tree]' : '.team-editor-role, #roles-title')
      .first()
      .waitFor()
    await page.addScriptTag({ content: axe })
    const report = await page.evaluate(async () => await globalThis.axe.run())
    const overflow = await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    )
    const row = {
      language,
      theme,
      width,
      scene,
      violations: report.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
      overflow,
      errors: [...errors],
    }
    results.push(row)
    errors.length = 0
    if (language === 'en' && width === 320) {
      const file = `${output}/${scene}-${theme}.png`
      await page.screenshot({ path: file, fullPage: true })
      const bytes = await readFile(file)
      shots.push({
        file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width,
        height: await page.evaluate(() => globalThis.document.documentElement.scrollHeight),
      })
    }
    if (overflow || row.violations.length > 0 || row.errors.length > 0)
      throw new Error(JSON.stringify(row))
    process.stdout.write(`PASS ${language} ${theme} ${String(width)} ${scene}\n`)
  }
} finally {
  await browser.close()
  await new Promise((resolve) => {
    server.close(resolve)
  })
  await writeFile(`${output}/results.json`, JSON.stringify({ results, shots }, null, 2) + '\n')
}
