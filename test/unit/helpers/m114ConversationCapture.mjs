// P1's after observations reuse the real panel behind its existing fake host.
// PNGs stay in ignored temp/; S owns reviewed visual-regression baselines.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../../scripts/lib/harnessServer.mjs'
import { auditRoot, digest, readAudit } from './m114AuditCapture.mjs'

const receiptDirectory = 'docs/certification/m114-p1-after'
export const conversationManifestPath = path.join(auditRoot, receiptDirectory, 'manifest.json')
const imageDirectory = 'temp/m114-p1-after'
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const scopes = [
  '.transcript',
  '.composer',
  '.chips',
  '.composer-banner',
  '.approval-dock-count',
  '.todo',
  '.goal',
  '.local-schedules',
  '.diff-tally',
  '.judge-status',
]

async function openScene(page, port, scene, theme, width, fixture) {
  const scenario = width === 320 ? scene : scene.replace(/-narrow$/, '')
  await page.goto(
    `http://127.0.0.1:${port}/test/harness/index.html?scenario=${scenario}&theme=${theme}`,
  )
  await page.evaluate(
    ({ fixture, width }) => {
      const root = globalThis.document.documentElement
      root.style.width = `${width}px`
      globalThis.document.body.style.width = `${width}px`
      for (const [name, value] of Object.entries(fixture.variables))
        root.style.setProperty(name, value)
      for (const name of fixture.unset)
        if (!name.includes('font')) root.style.setProperty(name, 'initial')
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
  await page.waitForFunction(
    () => globalThis.document.querySelector('[data-deferred-loading]') === null,
  )
  // Actual disclosure controls expose tool/verify/goal/workflow bodies.
  for (const selector of ['.steps-toggle', '.tool-toggle', '.workflow-header']) {
    await page.locator(`${selector}[aria-expanded="false"]`).evaluateAll((buttons) => {
      for (const button of buttons) button.click()
    })
    await page.clock.runFor(100)
  }
  if (scene === 'verify') await page.locator('.then-run').scrollIntoViewIfNeeded()
}

async function evidence(page, rows) {
  return await page.evaluate(
    (rows) =>
      rows.map((row) => {
        const element = globalThis.document.querySelector(row.captureSelector)
        if (element === null) throw new Error(`Missing render: ${row.file}`)
        const box = element.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) throw new Error(`Hidden render: ${row.file}`)
        const style = globalThis.getComputedStyle(element)
        return {
          file: row.file,
          selector: row.captureSelector,
          computed: {
            color: style.color,
            background: style.backgroundColor,
            radius: style.borderRadius,
            shadow: style.boxShadow,
            font: style.fontFamily,
            animation: style.animation,
            transition: style.transition,
            filter: style.filter,
            backdropFilter: style.backdropFilter,
          },
        }
      }),
    rows,
  )
}

async function accessibility(page) {
  return await page.evaluate(
    async ({ scopes, tags }) => {
      const include = scopes.filter(
        (selector) => globalThis.document.querySelector(selector) !== null,
      )
      const result = await globalThis.axe.run(
        { include },
        {
          runOnly: { type: 'tag', values: tags },
          resultTypes: ['violations', 'incomplete'],
        },
      )
      const findings = {}
      for (const kind of ['violations', 'incomplete']) {
        findings[kind] = result[kind].map((finding) => ({
          id: finding.id,
          impact: finding.impact,
          nodes: finding.nodes.map((node) => ({
            target: node.target,
            html: node.html,
            summary: node.failureSummary,
            reasons: [...node.any, ...node.all, ...node.none]
              .filter((check) => typeof check.data?.messageKey === 'string')
              .map((check) => check.data.messageKey),
          })),
        }))
      }
      return findings
    },
    { scopes, tags },
  )
}

async function captureConversation() {
  const audit = await readAudit()
  const rows = audit.components.filter((row) => row.owner === 'P1')
  const scenes = [...new Set(rows.map((row) => row.scene))]
  const matrix = JSON.parse(
    await readFile(path.join(auditRoot, 'test/harness/visual-matrix.json'), 'utf8'),
  )
  const axe = await readFile(path.join(auditRoot, 'node_modules/axe-core/axe.min.js'), 'utf8')
  const requestedTheme = process.argv[2]
  if (requestedTheme !== undefined && !matrix.themes.includes(requestedTheme))
    throw new Error(`Unknown capture theme: ${requestedTheme}`)
  const selectedThemes = requestedTheme === undefined ? matrix.themes : [requestedTheme]
  const sources = await Promise.all(
    ['src/webview/styles.css', ...rows.map((row) => row.file)].map(async (file) => ({
      file,
      sha256: digest(await readFile(path.join(auditRoot, file))),
    })),
  )
  const previous = existsSync(conversationManifestPath)
    ? JSON.parse(await readFile(conversationManifestPath, 'utf8'))
    : undefined
  const captures =
    requestedTheme !== undefined && JSON.stringify(previous?.sources) === JSON.stringify(sources)
      ? previous.captures.filter((capture) => capture.theme !== requestedTheme)
      : []
  const { server, port } = await serveRepo(auditRoot)
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome is required for P1 captures')
  const browser = await chromium.launch({
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 690, height: matrix.height },
      deviceScaleFactor: 1,
      locale: 'en',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    })
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    )
    await page.clock.install({ time: new Date('2026-10-06T12:00:00Z') })
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    for (const theme of selectedThemes) {
      const fixture = JSON.parse(
        await readFile(path.join(auditRoot, `test/harness/themes/${theme}.json`), 'utf8'),
      )
      for (const width of matrix.widths) {
        await page.setViewportSize({ width, height: matrix.height })
        for (const scene of scenes) {
          errors.length = 0
          await openScene(page, port, scene, theme, width, fixture)
          const rendered = await evidence(
            page,
            rows.filter((row) => row.scene === scene),
          )
          if (errors.length > 0) throw new Error(`${scene}: ${errors.join('; ')}`)
          const file = `${scene}/${theme}/${width}.png`
          const destination = path.join(auditRoot, imageDirectory, file)
          await mkdir(path.dirname(destination), { recursive: true })
          const bytes = await page.screenshot({ path: destination, animations: 'disabled' })
          await page.addScriptTag({ content: axe })
          const a11y = await accessibility(page)
          captures.push({
            scene,
            theme,
            width,
            height: matrix.height,
            file,
            sha256: digest(bytes),
            bytes: bytes.length,
            rendered,
            ...a11y,
          })
          console.log(
            `${captures.length}/${scenes.length * matrix.themes.length * matrix.widths.length}: ${scene}/${theme}/${width}: ${a11y.violations.length} violations`,
          )
        }
      }
    }
    const manifest = {
      kind: 'after-observation-not-golden',
      base: '58ed2fc1d',
      browser: browser.version(),
      imageDirectory,
      locale: 'en',
      timezone: 'UTC',
      deviceScaleFactor: 1,
      reducedMotion: true,
      animations: 'disabled',
      network: 'loopback-only',
      scope: scopes,
      tags,
      sources,
      captures,
    }
    await mkdir(path.join(auditRoot, receiptDirectory), { recursive: true })
    await writeFile(conversationManifestPath, JSON.stringify(manifest, null, 2) + '\n')
    const index = [
      '# M114 P1 after captures',
      '',
      `After PNGs: ${path.join(auditRoot, imageDirectory)}.`,
      'Before PNGs: /home/randy/archive/m114-a-before-17d7.',
      '',
      'The manifest records each image hash, byte size, actual component render and scoped axe findings.',
      'These are observations; S owns the reviewed visual goldens.',
      '',
      '| Scene | Theme | Width | After | Before |',
      '| --- | --- | ---: | --- | --- |',
      ...captures.map(
        (c) =>
          `| ${c.scene} | ${c.theme} | ${c.width} | [After](${path.join(auditRoot, imageDirectory, c.file)}) | [Before](/home/randy/archive/m114-a-before-17d7/${c.file}) |`,
      ),
      '',
    ]
    await writeFile(path.join(auditRoot, receiptDirectory, 'index.md'), index.join('\n'))
  } finally {
    await browser.close()
    server.close()
  }
}

if (process.argv[1]?.replaceAll('\\', '/') === fileURLToPath(import.meta.url).replaceAll('\\', '/'))
  await captureConversation()
