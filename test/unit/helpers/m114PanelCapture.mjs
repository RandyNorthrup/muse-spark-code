// P2 observations use actual components and the existing fake host. Images are
// archived outside git; this receipt is not S's reviewed visual baseline.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../../scripts/lib/harnessServer.mjs'
import { auditRoot, digest, readAudit } from './m114AuditCapture.mjs'

export const panelReceipt = path.join(auditRoot, 'docs/certification/m114-p2-after/manifest.json')
const images = 'temp/m114-p2-after'
const special = new Set(['crash', 'secret', 'icons', 'deferred-modal'])
const fixtures = 'temp/m114-p2-fixtures'
const source = [
  "import React,{lazy} from 'react';import {createRoot} from 'react-dom/client';",
  "import {ErrorBoundary} from './src/webview/components/ErrorBoundary';",
  "import {DeferredSurface} from './src/webview/components/DeferredSurface';",
  "import {SecretPromptDialog} from './src/webview/components/SecretPromptDialog';",
  "import * as icons from './src/webview/components/icons';",
  'const noop=()=>{};const Pending=lazy(()=>new Promise(()=>{}));',
  "function Crash(){throw new Error('Test-only render failure');}",
  "const scene=new URLSearchParams(location.search).get('scene');",
  "createRoot(globalThis.document.getElementById('root')).render(scene==='crash'",
  '? <ErrorBoundary onError={noop} onReload={noop} onReportProblem={noop}><Crash/></ErrorBoundary>',
  ': scene===\'secret\'?<SecretPromptDialog redactedText="[redacted]" onEdit={noop} onSendAnyway={noop}/>',
  ": scene==='icons'?<div style={{display:'flex',flexWrap:'wrap',gap:16,padding:16}}>{Object.entries(icons).map(([name,Icon])=><span key={name} title={name}><Icon/><span>{name}</span></span>)}</div>",
  ':<DeferredSurface isModal onClose={noop}><Pending/></DeferredSurface>);',
].join('\n')

async function prepare(port) {
  const directory = path.join(auditRoot, fixtures)
  await mkdir(directory, { recursive: true })
  await build({
    stdin: { contents: source, resolveDir: auditRoot, loader: 'jsx' },
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    outfile: path.join(directory, 'fixture.js'),
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(
    path.join(directory, 'index.html'),
    '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/dist/webview/main.css"></head><body><main id="root"></main><script src="fixture.js"></script></body></html>',
  )
  await build({
    entryPoints: [path.join(auditRoot, 'src/host/whatsNew/whatsNewHtml.ts')],
    outfile: path.join(directory, 'notes.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { renderWhatsNewPage } = await import(pathToFileURL(path.join(directory, 'notes.mjs')).href)
  const notes = JSON.parse(await readFile(path.join(auditRoot, 'dist/whatsNew.json'), 'utf8'))
  const releases = (Array.isArray(notes) ? notes : notes.releases)
    .filter((r) => r.version !== 'Unreleased')
    .slice(0, 1)
  const page = renderWhatsNewPage({
    releases,
    from: undefined,
    current: releases[0].version,
    isShownOnUpdate: true,
    cspSource: `http://127.0.0.1:${port}`,
    nonce: 'p2-capture',
    locale: 'en',
    scriptUri: '/dist/webview/whatsNew.js',
    styleUri: '/dist/webview/whatsNew.css',
  })
  await writeFile(path.join(directory, 'notes.html'), page.html)
}

async function capture() {
  const audit = await readAudit()
  const owned = audit.components.filter((row) => row.owner === 'P2')
  const scenes = [...new Set(owned.map((row) => row.scene))]
  const matrix = JSON.parse(
    await readFile(path.join(auditRoot, 'test/harness/visual-matrix.json'), 'utf8'),
  )
  const requested = process.argv[2]
  if (requested !== undefined && !matrix.themes.includes(requested))
    throw new Error(`Unknown theme: ${requested}`)
  const files = [
    'src/webview/styles.css',
    'src/webview/whatsNew/whatsNew.css',
    ...owned.map((row) => row.file),
  ]
  const sources = []
  for (const file of files)
    sources.push({ file, sha256: digest(await readFile(path.join(auditRoot, file))) })
  const prior = existsSync(panelReceipt)
    ? JSON.parse(await readFile(panelReceipt, 'utf8'))
    : undefined
  const captures =
    requested && JSON.stringify(prior?.sources) === JSON.stringify(sources)
      ? prior.captures.filter((row) => row.theme !== requested)
      : []
  const axe = await readFile(path.join(auditRoot, 'node_modules/axe-core/axe.min.js'), 'utf8')
  const chrome = findChrome()
  if (!chrome) throw new Error('Chrome is required for P2 captures')
  const { server, port } = await serveRepo(auditRoot)
  let browser
  try {
    await prepare(port)
    browser = await chromium.launch(
      path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
    )
    const page = await browser.newPage({
      viewport: { width: 690, height: matrix.height },
      reducedMotion: 'reduce',
      locale: 'en',
      timezoneId: 'UTC',
      deviceScaleFactor: 1,
    })
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    )
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, 'acquireVsCodeApi', {
        configurable: true,
        writable: true,
        value: () => ({
          postMessage: (message) => message,
          getState: () => null,
          setState: (state) => state,
        }),
      })
    })
    await page.clock.install({ time: new Date('2026-10-06T12:00:00Z') })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    const selectedThemes = requested ? [requested] : matrix.themes
    for (const theme of selectedThemes) {
      const host = JSON.parse(
        await readFile(path.join(auditRoot, `test/harness/themes/${theme}.json`), 'utf8'),
      )
      for (const width of matrix.widths) {
        await page.setViewportSize({ width, height: matrix.height })
        for (const scene of scenes) {
          let resource = `test/harness/index.html?scenario=${width === 320 ? scene : scene.replace(/-narrow$/, '')}&theme=${theme}`
          if (special.has(scene)) resource = `${fixtures}/index.html?scene=${scene}`
          if (scene === 'whats-new') resource = `${fixtures}/notes.html`
          await page.goto(`http://127.0.0.1:${port}/${resource}`)
          await page.evaluate(
            ({ host, width }) => {
              const root = globalThis.document.documentElement
              root.style.width = `${width}px`
              globalThis.document.body.style.width = `${width}px`
              for (const [key, value] of Object.entries(host.variables))
                root.style.setProperty(key, value)
              for (const key of host.unset)
                if (!key.includes('font')) root.style.setProperty(key, 'initial')
              root.style.setProperty('--vscode-font-family', "'Segoe UI', sans-serif")
              root.style.setProperty('--vscode-font-size', '13px')
              root.style.setProperty('--vscode-editor-font-family', 'Consolas, monospace')
              root.style.setProperty('--vscode-editor-font-size', '13px')
              globalThis.document.body.classList.add(...host.bodyClass.split(' '))
            },
            { host, width },
          )
          if (scene !== 'whats-new' && !special.has(scene)) {
            await page.waitForSelector('textarea, .gate, .todo-surface, [role="alert"]', {
              state: 'attached',
            })
          }
          await page.clock.runFor(6500)
          await page.evaluate(() => globalThis.document.fonts.ready)
          if (scene !== 'deferred-modal')
            await page.waitForFunction(
              () => !globalThis.document.querySelector('[data-deferred-loading]'),
            )
          const rows = owned.filter((row) => row.scene === scene)
          const rendered = await page.evaluate(
            (rows) =>
              rows.map(({ file, captureSelector: selector }) => {
                const el = globalThis.document.querySelector(selector)
                if (!el || !el.getBoundingClientRect().width)
                  throw new Error(`Missing P2 render: ${file}`)
                const s = globalThis.getComputedStyle(el)
                return {
                  file,
                  selector,
                  computed: Object.fromEntries(
                    [
                      'color',
                      'backgroundColor',
                      'borderRadius',
                      'boxShadow',
                      'fontFamily',
                      'animation',
                      'transition',
                      'filter',
                      'backdropFilter',
                    ].map((key) => [key, s[key]]),
                  ),
                }
              }),
            rows,
          )
          const file = `${scene}/${theme}/${width}.png`
          const destination = path.join(auditRoot, images, file)
          await mkdir(path.dirname(destination), { recursive: true })
          const bytes = await page.screenshot({ path: destination, animations: 'disabled' })
          await page.evaluate((axe) => {
            const script = globalThis.document.createElement('script')
            script.nonce = 'p2-capture'
            script.textContent = axe
            globalThis.document.head.append(script)
          }, axe)
          // Only this lane's actual visible surfaces; obscured background controls
          // belong to their separate scenes rather than to the open modal.
          const a11y = await page.evaluate(async (rows) => {
            const include = rows
              .flatMap((row) => row.captureSelector.split(',').map((s) => s.trim()))
              .filter((s) => globalThis.document.querySelector(s))
            const result = await globalThis.axe.run(
              { include },
              {
                runOnly: {
                  type: 'tag',
                  values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
                },
                resultTypes: ['violations', 'incomplete'],
              },
            )
            return Object.fromEntries(
              ['violations', 'incomplete'].map((kind) => [
                kind,
                result[kind].map((entry) => ({
                  id: entry.id,
                  nodes: entry.nodes.map((node) => ({
                    target: node.target,
                    summary: node.failureSummary,
                    reasons: [...node.any, ...node.all, ...node.none]
                      .filter((check) => typeof check.data?.messageKey === 'string')
                      .map((check) => check.data.messageKey),
                  })),
                })),
              ]),
            )
          }, rows)
          captures.push({
            file,
            scene,
            theme,
            width,
            height: matrix.height,
            bytes: bytes.length,
            sha256: digest(bytes),
            rendered,
            ...a11y,
          })
          console.log(`${scene}/${theme}/${width}: ${a11y.violations.length} violations`)
        }
      }
    }
    const manifest = {
      kind: 'after-observation-not-golden',
      base: '28ffc2def',
      browser: browser.version(),
      imageDirectory: images,
      locale: 'en',
      timezone: 'UTC',
      deviceScaleFactor: 1,
      reducedMotion: true,
      network: 'loopback-only',
      sources,
      captures,
    }
    await mkdir(path.dirname(panelReceipt), { recursive: true })
    await writeFile(panelReceipt, JSON.stringify(manifest, null, 2) + '\n')
    await writeFile(
      path.join(path.dirname(panelReceipt), 'index.md'),
      [
        '# M114 P2 after observations',
        '',
        `PNGs: ${path.join(auditRoot, images)}. Before: /home/randy/archive/m114-a-before-17d7.`,
        '',
        'S owns reviewed goldens; the manifest retains hashes, actual renders and all scoped axe findings.',
        '',
        '| Scene | Theme | Width | After | Before |',
        '| --- | --- | ---: | --- | --- |',
        ...captures.map(
          (c) =>
            `| ${c.scene} | ${c.theme} | ${c.width} | [After](${path.join(auditRoot, images, c.file)}) | [Before](/home/randy/archive/m114-a-before-17d7/${c.file}) |`,
        ),
        '',
      ].join('\n'),
    )
  } finally {
    await browser?.close()
    server.close()
  }
}
if (process.argv[1]?.replaceAll('\\', '/') === fileURLToPath(import.meta.url).replaceAll('\\', '/'))
  await capture()
