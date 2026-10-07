import { sortIncomplete } from '../../../scripts/a11y.mjs'
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../../scripts/lib/harnessServer.mjs'
import { sharedUiText } from '../../../scripts/lib/deferredBundles.mjs'
import { createRequire } from 'node:module'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { Buffer } from 'node:buffer'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const shipping = process.argv.includes('--shipping')
const scratch = path.join(root, 'temp/m113-v')
mkdirSync(scratch, { recursive: true })
await build({
  stdin: {
    contents: `export * from './test/unit/reportRenderFixtures';
      export { EN } from './src/shared/l10n/en';
      export { verifyReport } from './src/core/reporting/render/canonical';`,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: 'temp/m113-v/fixtures.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20.18',
})
const { renderFixture, RENDERERS, REPORT_THEMES, EN, verifyReport } = await import(
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
let sizes
if (!shipping) {
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
sizes = {
  reportingPanelKiB: statSync(path.join(scratch, 'reportingPanel.cjs')).size / 1024,
  reportingPageKiB: statSync(path.join(scratch, 'reportingPage.js')).size / 1024,
  reportingCssKiB: statSync(path.join(scratch, 'reportingPage.css')).size / 1024,
}

} else {
  sizes = { reportingPanelKiB: statSync(path.join(root, 'dist/reportingPanel.js')).size / 1024, reportingPageKiB: statSync(path.join(root, 'dist/webview/reportingPage.js')).size / 1024, reportingCssKiB: statSync(path.join(root, 'dist/webview/reportingPage.css')).size / 1024 }
}
process.stdout.write(`${JSON.stringify(sizes)}\n`)
const { server, port } = await serveRepo(path.resolve(root))
// Exercise the compiled host adapter, including its HTML builder and iframe
// nonce authorization. The browser loads the exact production shell it emits.
const panels = { current: undefined }
const require = createRequire(shipping ? pathToFileURL(path.join(root, 'dist/reportingPanel.js')) : import.meta.url)
const exported = { exports: {} }
const fakeVscode = {
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: (_base, ...parts) => parts.join('/') },
  window: {
    createWebviewPanel: () => {
      const webview = {
        cspSource: `http://127.0.0.1:${port}`,
        asWebviewUri: (file) => ({
          toString: () => `http://127.0.0.1:${port}/${shipping ? 'dist/webview' : 'temp/m113-v'}/${path.basename(file)}`,
        }),
        onDidReceiveMessage: (receive) => {
          webview.receive = receive
          return { dispose: () => false }
        },
        postMessage: (state) => {
          webview.state = state
        },
      }
      panels.current = { webview, onDidDispose: () => ({ dispose: () => false }) }
      return panels.current
    },
  },
}
vm.runInNewContext(readFileSync(shipping ? path.join(root, 'dist/reportingPanel.js') : path.join(scratch, 'reportingPanel.cjs'), 'utf8'), {
  module: exported,
  exports: exported.exports,
  Buffer,
  crypto: webcrypto,
  require: (name) => {
    const provided = { vscode: fakeVscode, './uiText.js': { EN } }
    return provided[name] ?? require(name)
  },
})
const productionShells = {}
for (const [index, theme] of ['light', 'dark', 'hc-dark', 'hc-light'].entries()) {
  const tab = exported.exports.createReportPanel(
    {
      context: { extensionUri: '', l10n: { locale: 'en', table: EN }, log: { warn: () => false } },
      workspaceKey: 'fixture',
      engine: () => ({
        reports: { run: async () => ({ status: 'generated', document: fixtureDocument }) },
        verify: verifyReport,
        render: RENDERERS,
      }),
      now: () => fixtureDocument.header.asOf,
      theme: () => REPORT_THEMES[index],
    },
    EN,
    'en',
  )
  await tab.open('project')
  panels.current.webview.receive({ type: 'reportingReady' })
  scenes[theme] = panels.current.webview.state
  const nonce = /style-src [^;]+ 'nonce-([^']+)'/.exec(panels.current.webview.html)?.[1]
  const palette = JSON.parse(
    readFileSync(path.join(root, `test/harness/themes/${theme}.json`), 'utf8'),
  )
  const variables = Object.entries(palette.variables)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')
  productionShells[theme] = panels.current.webview.html
    .replace('</head>', () => `<style nonce="${nonce}">:root{${variables}}</style></head>`)
    .replace('<body>', () => `<body class="${palette.bodyClass}">`)
  writeFileSync(path.join(scratch, `production-${theme}.html`), productionShells[theme])
}
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
        // Ordinary browsers request a favicon; VS Code's webview does not.
        await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }))
        const errors = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        const state = {
          ...globalThis.structuredClone(scenes[theme]),
          ...{
            history: { history: [{ id: 'saved', header: scenes[theme].header }] },
            diff: { diff: scenes.diff },
            error: { status: EN.reportUi.generationFailed, isError: true },
          }[scene],
        }
        await page.addInitScript((initial) => {
          Reflect.set(globalThis, 'acquireVsCodeApi', () => ({
            postMessage: (message) => {
              if (message.type === 'reportingReady')
                globalThis.dispatchEvent(new globalThis.MessageEvent('message', { data: initial }))
            },
            getState: () => null,
            setState: () => null,
          }))
        }, state)
        await page.goto(`http://127.0.0.1:${port}/temp/m113-v/production-${theme}.html`)
        await page.locator('.reporting-document').waitFor()
        const inner = page.frameLocator('.reporting-document')
        const appliedStyle = await inner
          .locator('.table')
          .first()
          .evaluate((table) => ({
            overflowX: globalThis.getComputedStyle(table).overflowX,
            foreground: globalThis.getComputedStyle(globalThis.document.body).color,
            cssRules: [...globalThis.document.styleSheets].reduce(
              (total, sheet) => total + sheet.cssRules.length,
              0,
            ),
            overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
          }))
        if (
          appliedStyle.overflowX !== 'auto' ||
          appliedStyle.cssRules === 0 ||
          appliedStyle.overflow
        )
          errors.push(`Production iframe style/width regression: ${JSON.stringify(appliedStyle)}`)
        await page.keyboard.press('Tab')
        const keyboardFocus = await page
          .locator('.reporting-actions button')
          .first()
          .evaluate((button) => button === globalThis.document.activeElement)
        if (!keyboardFocus) throw new Error('Report picker did not receive keyboard focus')
        if (scene === 'diff') await page.locator('.reporting-diff').waitFor()
        await page.evaluate(axeSource)
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
        // Standalone export still has its own style authorization; the iframe
        // above is the production CSP regression, and is measured directly.
        await rendered.setContent(
          RENDERERS.html(
            fixtureDocument,
            'en',
            REPORT_THEMES[['light', 'dark', 'hc-dark', 'hc-light'].indexOf(theme)],
          ),
        )
        const innerResult = await rendered.evaluate(
          axeSource +
            '; axe.run(globalThis.document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })',
        )
        const innerViolations = innerResult.violations.map(({ id }) => id)
        await rendered.close()
        const classify = (findings) => sortIncomplete(findings.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => ({ ...node, reasons: [...node.any, ...node.all, ...node.none].map((check) => check.data?.messageKey).filter((key) => typeof key === 'string') })) })))
        const outerIncomplete = classify(result.incomplete.filter(({ id }) => id !== 'frame-tested'))
        const innerIncomplete = classify(innerResult.incomplete)
        checks.push({
          undecided: [...outerIncomplete.undecided, ...innerIncomplete.undecided].map(({ id }) => id),
          unseen: outerIncomplete.unseen + innerIncomplete.unseen,
          glyphOnly: outerIncomplete.glyphOnly + innerIncomplete.glyphOnly,
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
          appliedStyle,
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
    ({ violations, innerViolations, errors, overflow, undecided }) =>
      violations.length > 0 || innerViolations.length > 0 || errors.length > 0 || overflow || undecided.length > 0,
  )
)
  process.exitCode = 1
