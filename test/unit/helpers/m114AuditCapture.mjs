// Test-only before-capture driver. It reuses the existing fake host and actual
// components; it does not add a shipping theme adapter or a visual golden.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../../scripts/lib/harnessServer.mjs'

export const auditRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

export async function readAudit(revision) {
  if (revision !== undefined)
    return JSON.parse(
      execFileSync('git', ['show', `${revision}:docs/certification/m114-audit.json`], {
        cwd: auditRoot,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }),
    )
  return JSON.parse(
    await readFile(path.join(auditRoot, 'docs/certification/m114-audit.json'), 'utf8'),
  )
}

/** One Git process reads immutable blobs; no checkout or network is needed. */
export function sourcesAtRevision(revision, files) {
  if (!/^[\da-f]{40}$/.test(revision)) throw new Error('Capture needs an immutable source revision')
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: auditRoot,
    input: files.map((file) => `${revision}:${file.replaceAll('\\', '/')}`).join('\n') + '\n',
    maxBuffer: 8 * 1024 * 1024,
  })
  let offset = 0
  return new Map(
    files.map((file) => {
      const end = output.indexOf('\n', offset)
      const header = output.subarray(offset, end).toString()
      const match = /^[\da-f]{40} blob (\d+)$/.exec(header)
      if (match === null) throw new Error(`Missing historical source: ${revision}:${file}`)
      const size = Number(match[1])
      const bytes = output.subarray(end + 1, end + 1 + size)
      offset = end + 1 + size + 1
      return [file, bytes]
    }),
  )
}

const fixtureSource = [
  "import React, {lazy} from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {ErrorBoundary} from './src/webview/components/ErrorBoundary';",
  "import {DeferredSurface} from './src/webview/components/DeferredSurface';",
  "import {SecretPromptDialog} from './src/webview/components/SecretPromptDialog';",
  "import * as icons from './src/webview/components/icons';",
  'const noop = () => {};',
  'const Suspended = lazy(() => new Promise(() => {}));',
  "function Crash() { throw new Error('Deliberate test-only render failure'); }",
  "const scene = new URLSearchParams(location.search).get('scene');",
  "const content = scene === 'crash'",
  ' ? <ErrorBoundary onError={noop} onReload={noop} onReportProblem={noop}><Crash/></ErrorBoundary>',
  ' : scene === \'secret\' ? <SecretPromptDialog redactedText="[redacted]" onEdit={noop} onSendAnyway={noop}/>',
  " : scene === 'icons' ? <div style={{display:'flex',flexWrap:'wrap',gap:16,padding:16}}>{Object.entries(icons).map(([name,Icon]) => <span key={name} title={name} style={{display:'grid',gap:8}}><Icon/><span>{name}</span></span>)}</div>",
  " : <DeferredSurface onClose={noop} isModal={scene !== 'deferred-popover'}><Suspended/></DeferredSurface>;",
  "createRoot(globalThis.document.getElementById('root')).render(content);",
].join('\n')
const fixtureScenes = new Set(['crash', 'secret', 'icons', 'deferred-modal', 'deferred-popover'])
const wideScene = (scene, width) => (width === 320 ? scene : scene.replace(/-narrow$/, ''))
const outBase = 'docs/certification/m114-a-before'

async function makeFixtures(port) {
  const directory = path.join(auditRoot, 'temp/m114-a-fixtures')
  await mkdir(directory, { recursive: true })
  await build({
    stdin: { contents: fixtureSource, resolveDir: auditRoot, loader: 'jsx' },
    outfile: path.join(directory, 'fixtures.js'),
    bundle: true,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  await writeFile(
    path.join(directory, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/dist/webview/main.css"></head><body><main id="root"></main><script src="fixtures.js"></script></body></html>`,
  )
  await build({
    entryPoints: ['src/host/whatsNew/whatsNewHtml.ts'],
    absWorkingDir: auditRoot,
    outfile: path.join(directory, 'whatsNew.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { renderWhatsNewPage } = await import(path.join(directory, 'whatsNew.mjs'))
  const content = JSON.parse(await readFile(path.join(auditRoot, 'dist/whatsNew.json'), 'utf8'))
  const releases = Array.isArray(content) ? content : content.releases
  const rendered = renderWhatsNewPage({
    releases: releases.filter((entry) => entry.version !== 'Unreleased').slice(0, 1),
    from: undefined,
    current: releases[0].version,
    isShownOnUpdate: true,
    cspSource: `http://127.0.0.1:${port}`,
    nonce: 'audit-fixture',
    locale: 'en',
    scriptUri: '/dist/webview/whatsNew.js',
    styleUri: '/dist/webview/whatsNew.css',
  })
  await writeFile(path.join(directory, 'whats-new.html'), rendered.html)
  const highlighted = releases.find((entry) => entry.highlights.length > 0)
  if (highlighted === undefined) throw new Error('Packaged notes need a highlight capture')
  const highlightPage = renderWhatsNewPage({
    releases: [{ ...highlighted, highlights: highlighted.highlights.slice(0, 1), sections: [] }],
    from: undefined,
    current: highlighted.version,
    isShownOnUpdate: true,
    cspSource: `http://127.0.0.1:${port}`,
    nonce: 'audit-fixture',
    locale: 'en',
    scriptUri: '/dist/webview/whatsNew.js',
    styleUri: '/dist/webview/whatsNew.css',
  })
  await writeFile(path.join(directory, 'whats-new-highlights.html'), highlightPage.html)
}

async function captureBefore() {
  const audit = await readAudit()
  const matrix = JSON.parse(
    await readFile(path.join(auditRoot, 'test/harness/visual-matrix.json'), 'utf8'),
  )
  const { server, port } = await serveRepo(auditRoot)
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome is required for before captures')
  const context = await chromium.launch({
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
  })
  const receipts = []
  try {
    await makeFixtures(port)
    const page = await context.newPage({
      viewport: { width: 690, height: matrix.height },
      deviceScaleFactor: 1,
      locale: 'en',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    })
    const pageErrors = []
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })
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
    // Block all non-loopback requests, even links/images contained in a fake transcript.
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    )
    await page.clock.install({ time: new Date('2026-10-06T12:00:00Z') })
    for (const theme of matrix.themes) {
      const fixture = JSON.parse(
        await readFile(path.join(auditRoot, `test/harness/themes/${theme}.json`), 'utf8'),
      )
      for (const width of matrix.widths) {
        await page.setViewportSize({ width, height: matrix.height })
        for (const scene of audit.scenes) {
          pageErrors.length = 0
          const isFixture = fixtureScenes.has(scene)
          let resource = `test/harness/index.html?scenario=${wideScene(scene, width)}&theme=${theme}`
          if (isFixture) resource = `temp/m114-a-fixtures/index.html?scene=${scene}`
          if (scene.startsWith('whats-new'))
            resource = `temp/m114-a-fixtures/${scene === 'whats-new-highlights' ? 'whats-new-highlights' : 'whats-new'}.html`
          await page.goto(`http://127.0.0.1:${port}/${resource}`)
          await page.evaluate(
            ({ fixture, width }) => {
              const root = globalThis.document.documentElement
              root.style.width = `${width}px`
              globalThis.document.body.style.width = `${width}px`
              for (const [name, value] of Object.entries(fixture.variables))
                root.style.setProperty(name, value)
              for (const name of fixture.unset) {
                if (name.includes('font')) continue
                root.style.setProperty(name, 'initial')
              }
              // Match the existing harness host's fonts, not a third-party theme's.
              root.style.setProperty('--vscode-font-family', "'Segoe UI', sans-serif")
              root.style.setProperty('--vscode-font-size', '13px')
              root.style.setProperty('--vscode-editor-font-family', 'Consolas, monospace')
              root.style.setProperty('--vscode-editor-font-size', '13px')
              globalThis.document.body.classList.add(...fixture.bodyClass.split(' '))
            },
            { fixture, width },
          )
          await page.clock.runFor(6500)
          await page.evaluate(() => globalThis.document.fonts.ready)
          if (!fixtureScenes.has(scene))
            await page.waitForFunction(
              () => globalThis.document.querySelector('[data-deferred-loading]') === null,
            )
          if (
            [
              'muse-tools',
              'verify',
              'muse-workflow',
              'goal',
              'tools-open',
              'long-patch',
              'paid-image',
            ].includes(scene)
          ) {
            await page.evaluate(() => {
              for (const button of globalThis.document.querySelectorAll(
                '.steps-toggle[aria-expanded="false"]',
              ))
                button.click()
            })
            await page.clock.runFor(100)
            await page.evaluate(() => {
              for (const button of globalThis.document.querySelectorAll(
                '.tool-toggle[aria-expanded="false"],.workflow-header[aria-expanded="false"]',
              ))
                button.click()
            })
            await page.clock.runFor(100)
          }
          if (scene === 'verify') await page.locator('.then-run').scrollIntoViewIfNeeded()
          else if (scene === 'whats-new-footer')
            await page.evaluate(() => globalThis.scrollTo(0, globalThis.document.body.scrollHeight))
          const renderedComponents = await page.evaluate(
            (rows) =>
              rows
                .filter((row) => {
                  const el = globalThis.document.querySelector(row.captureSelector)
                  return (
                    el !== null &&
                    el.getBoundingClientRect().width > 0 &&
                    el.getBoundingClientRect().height > 0
                  )
                })
                .map((row) => row.file),
            audit.components.filter((row) => row.scene === scene),
          )
          const expectedComponents = audit.components
            .filter((row) => row.scene === scene)
            .map((row) => row.file)
          if (JSON.stringify(renderedComponents) !== JSON.stringify(expectedComponents))
            throw new Error(
              `Missing component in ${scene}/${theme}/${width}: ${expectedComponents.filter((file) => !renderedComponents.includes(file)).join(', ')}`,
            )
          const elements = await page.evaluate(() => [
            ...new Set(
              [...globalThis.document.querySelectorAll('body *')]
                .filter(
                  (el) =>
                    el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
                )
                .map(
                  (el) =>
                    `${el.tagName}.${typeof el.className === 'string' ? el.className : el.className.baseVal}`,
                ),
            ),
          ])
          if (elements.length === 0 || pageErrors.length > 0)
            throw new Error(
              `${scene}/${theme}/${width}: ${pageErrors.join('; ') || 'empty render'}`,
            )
          const directory = path.join(auditRoot, outBase, scene, theme)
          await mkdir(directory, { recursive: true })
          const file = `${outBase}/${scene}/${theme}/${width}.png`
          const bytes = await page.screenshot({
            path: path.join(auditRoot, file),
            animations: 'disabled',
          })
          const computed = await page.evaluate(() => {
            const selectors = [
              '.modal',
              '.palette',
              '.popover',
              '.approval',
              '.approval-choices > button',
              '.composer',
              '.composer-input',
              '.pill',
              '.send-button',
              '.gooey-menu-pill',
              '.row-actions-button',
              '.context-meter',
              '.status-mark-circle',
              'button',
              'a',
              'input',
              'pre',
            ]
            return selectors.flatMap((selector) => {
              const el = globalThis.document.querySelector(selector)
              if (el === null) return []
              const style = globalThis.getComputedStyle(el)
              const box = el.getBoundingClientRect()
              return [
                {
                  selector,
                  color: style.color,
                  background: style.backgroundColor,
                  radius: style.borderRadius,
                  shadow: style.boxShadow,
                  blur: style.backdropFilter,
                  outline: style.outline,
                  outlineOffset: style.outlineOffset,
                  font: style.fontFamily,
                  animation: style.animation,
                  transition: style.transition,
                  box: { x: box.x, y: box.y, width: box.width, height: box.height },
                },
              ]
            })
          })
          receipts.push({
            scene,
            theme,
            width,
            height: matrix.height,
            file,
            sha256: digest(bytes),
            bytes: bytes.length,
            elements,
            renderedComponents,
            computed,
          })
          if (receipts.length % 12 === 0)
            console.log(
              `captured ${receipts.length}/${audit.scenes.length * matrix.themes.length * matrix.widths.length}`,
            )
        }
      }
    }
    await writeFile(
      path.join(auditRoot, `${outBase}/manifest.json`),
      JSON.stringify(
        {
          base: audit.base,
          browser: context.version(),
          locale: 'en',
          timezone: 'UTC',
          reducedMotion: true,
          deviceScaleFactor: 1,
          animations: 'disabled',
          network: 'loopback-only',
          kind: 'before-observation-not-golden',
          captures: receipts,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await context.close()
    server.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await captureBefore()
