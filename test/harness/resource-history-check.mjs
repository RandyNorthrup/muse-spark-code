import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'

if (process.argv.slice(2).length > 0)
  throw new Error('Resource history acceptance takes no arguments')

const root = process.cwd()
const output = path.join(root, 'temp/m107-j/harness')
await mkdir(output, { recursive: true })
const built = await build({
  entryPoints: {
    'resource-history-entry': 'test/harness/resource-history-entry.mjs',
    main: 'src/webview/main.tsx',
  },
  outdir: output,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome128',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  minify: true,
  metafile: true,
  jsx: 'automatic',
  plugins: [compactBrowserEnglish],
})
const normalize = (file) => file.replaceAll('\\', '/')
const outputs = Object.entries(built.metafile.outputs)
const section = outputs.find(([, value]) =>
  Object.keys(value.inputs).some((file) => normalize(file).endsWith('/usage/ResourcesSection.tsx')),
)
if (section === undefined || !section[0].includes('ResourcesSection-'))
  throw new Error('Resource history section is not lazy')
await writeFile(path.join(output, 'meta.json'), JSON.stringify(built.metafile, null, 2))
const eager = new Set()
const visit = (file, found) => {
  if (found.has(file)) return
  found.add(file)
  const imports = built.metafile.outputs[file].imports
  for (const imported of imports) {
    if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path, found)
  }
}
for (const [file, value] of outputs) {
  if (
    normalize(value.entryPoint ?? '') === 'src/webview/main.tsx' ||
    normalize(value.entryPoint ?? '') === 'test/harness/resource-history-entry.mjs'
  )
    visit(file, eager)
}
const deferred = new Set()
visit(section[0], deferred)
const sectionBytes =
  [...deferred]
    .filter((file) => !eager.has(file))
    .reduce((sum, file) => sum + built.metafile.outputs[file].bytes, 0) +
  (built.metafile.outputs[section[0]].cssBundle === undefined
    ? 0
    : built.metafile.outputs[built.metafile.outputs[section[0]].cssBundle].bytes)
if (sectionBytes > 25 * 1024)
  throw new Error(`Resource history exceeds its own 25 KiB budget: ${String(sectionBytes)}`)
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome is required for resource history acceptance')
const browser = await chromium.launch({
  ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
  headless: true,
})
const { server, port } = await serveRepo(root)
const results = []
try {
  for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
    const captured = JSON.parse(
      await readFile(path.join(root, 'test/harness/themes', `${theme}.json`), 'utf8'),
    )
    for (const width of [690, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
      })
      const variables = Object.entries(captured.variables)
        .map(([key, value]) => `${key}: ${value};`)
        .join(' ')
      const html = `<!doctype html><html lang="en"><head><title>Resources</title><style>:root { ${variables} } body { background: var(--vscode-editor-background); color: var(--vscode-foreground); font: 14px sans-serif; margin: 8px; } h2 { font-size: 20px; }</style><link rel="stylesheet" href="/temp/m107-j/harness/resource-history-entry.css"></head><body><div id="root"></div><script type="module" src="/temp/m107-j/harness/resource-history-entry.js"></script><script src="/node_modules/axe-core/axe.min.js"></script></body></html>`
      await page.route('**/resource-history.html', async (route) => {
        await route.fulfill({ contentType: 'text/html', body: html })
      })
      await page.goto(`http://127.0.0.1:${String(port)}/temp/m107-j/harness/resource-history.html`)
      await page.getByRole('table', { name: 'Harness work' }).waitFor()
      const result = await page.evaluate(async () => {
        const audit = await globalThis.axe.run()
        return {
          axe: audit.violations.map((issue) => ({
            id: issue.id,
            nodes: issue.nodes.map((node) => node.target),
          })),
          overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
          readings: Array.from(
            globalThis.document.querySelectorAll('[data-reading]'),
            (node) => node.dataset.reading,
          ),
          levels: Array.from(
            globalThis.document.querySelectorAll('[data-level]'),
            (node) => node.dataset.level,
          ),
        }
      })
      await page.screenshot({
        path: path.join(output, `${theme}-${String(width)}.png`),
        fullPage: true,
      })
      results.push({ theme, width, errors, ...result })
      await page.close()
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => {
    server.close(resolve)
  })
}
await writeFile(
  path.join(output, 'results.json'),
  JSON.stringify({ sectionBytes, results }, null, 2),
)
console.log(JSON.stringify({ sectionBytes, results }, null, 2))
if (results.some((result) => result.errors.length > 0 || result.axe.length > 0 || result.overflow))
  throw new Error('Resource history browser acceptance failed')
