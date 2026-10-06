import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../../scripts/lib/harnessServer.mjs'
import { sharedUiText } from '../../../scripts/lib/deferredBundles.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const scratch = path.join(root, 'temp/m113-v')
mkdirSync(scratch, { recursive: true })
await build({
  entryPoints: ['test/unit/reportRenderFixtures.ts'],
  outfile: 'temp/m113-v/fixtures.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20.18',
})
const { renderFixture, RENDERERS, REPORT_THEMES } = await import(
  pathToFileURL(path.join(scratch, 'fixtures.mjs')).href
)
const fixtureDocument = renderFixture()
const scenes = {}
for (const [index, name] of ['light', 'dark', 'hc-dark', 'hc-light'].entries()) {
  scenes[name] = {
    type: 'reportingState',
    busy: false,
    header: fixtureDocument.header,
    html: RENDERERS.html(fixtureDocument, 'en', REPORT_THEMES[index]),
    history: null,
    diff: null,
    status: '',
    isError: false,
  }
}
scenes.diff = {
  from: fixtureDocument.header,
  to: fixtureDocument.header,
  sections: [
    {
      id: 'milestones',
      label: 'milestones',
      added: fixtureDocument.needsYou.rows,
      removed: [],
      changed: [
        {
          key: '0-owner',
          before: fixtureDocument.needsYou.rows[0],
          after: {
            ...fixtureDocument.needsYou.rows[0],
            cells: { detail: { type: 'text', value: 'Release channel chosen.' } },
          },
        },
      ],
      unchangedRows: 2,
    },
  ],
}
writeFileSync(path.join(scratch, 'scenes.json'), JSON.stringify(scenes))
const nodeBundle = await build({
  entryPoints: ['src/host/reporting/reportPanelEntry.ts'],
  outfile: 'temp/m113-v/reportingPanel.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20.18',
  minify: true,
  metafile: true,
  external: ['vscode'],
  plugins: [sharedUiText],
})
const browserBundle = await build({
  entryPoints: ['src/webview/reporting/main.tsx'],
  outfile: 'temp/m113-v/reportingPage.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome132',
  minify: true,
  metafile: true,
})
writeFileSync(path.join(scratch, 'node-meta.json'), JSON.stringify(nodeBundle.metafile))
writeFileSync(path.join(scratch, 'browser-meta.json'), JSON.stringify(browserBundle.metafile))
const sizes = {
  reportingPanelKiB: statSync(path.join(scratch, 'reportingPanel.cjs')).size / 1024,
  reportingPageKiB: statSync(path.join(scratch, 'reportingPage.js')).size / 1024,
  reportingCssKiB: statSync(path.join(scratch, 'reportingPage.css')).size / 1024,
}
process.stdout.write(`${JSON.stringify(sizes)}\n`)
const { server, port } = await serveRepo(path.resolve(root))
const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
})
const checks = []
const axeSource = readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8')
try {
  for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
    for (const width of [690, 320]) {
      for (const scene of ['report', 'history', 'diff', 'error']) {
        const page = await browser.newPage({ viewport: { width, height: 960 } })
        const errors = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        await page.goto(
          `http://127.0.0.1:${port}/test/harness/reporting/index.html?theme=${theme}&scene=${scene}`,
        )
        await page.locator('.reporting-document').waitFor()
        await page.keyboard.press('Tab')
        const keyboardFocus = await page
          .locator('.reporting-actions button')
          .first()
          .evaluate((button) => button === globalThis.document.activeElement)
        if (!keyboardFocus) throw new Error('Report picker did not receive keyboard focus')
        if (scene === 'diff') await page.locator('.reporting-diff').waitFor()
        await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') })
        const result = await page.evaluate(async () => {
          const axe = globalThis.axe
          return await axe.run(globalThis.document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
            },
          })
        })
        const violations = result.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        }))
        const overflow = await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
        )
        // Check the exact static document on its own, since an empty sandbox prevents axe's frame handshake.
        const rendered = await browser.newPage({ viewport: { width, height: 960 } })
        await rendered.setContent(scenes[theme].html)
        const innerResult = await rendered.evaluate(
          axeSource +
            '; axe.run(globalThis.document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })',
        )
        const innerViolations = innerResult.violations.map(({ id }) => id)
        await rendered.close()
        checks.push({
          theme,
          width,
          scene,
          violations,
          incomplete: result.incomplete.map(({ id }) => id),
          innerViolations,
          keyboardFocus,
          innerIncomplete: innerResult.incomplete.map(({ id }) => id),
          errors,
          overflow,
        })
        process.stdout.write(
          `${theme} ${width} ${scene}: ${violations.length} violations, overflow=${overflow}\n`,
        )
        if (theme === 'light' && width === 320 && scene === 'report')
          await page.screenshot({
            path: path.join(root, 'docs/certification/m113-v-320-light.png'),
          })
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
writeFileSync(
  path.join(root, 'docs/certification/m113-v-a11y.json'),
  JSON.stringify({ sizes, checks }, undefined, 2) + '\n',
)
if (
  checks.some(
    ({ violations, innerViolations, errors, overflow }) =>
      violations.length > 0 || innerViolations.length > 0 || errors.length > 0 || overflow,
  )
)
  process.exitCode = 1
