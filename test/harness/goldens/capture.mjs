// Actual webview components behind the existing test-only fake host.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { bundleFor, serveRepo } from '../../../scripts/lib/harnessServer.mjs'
import { ARCHIVE_BUDGET, digest } from '../../../scripts/lib/visualImages.mjs'
import { captureGroup, surfaceForScene } from '../../../scripts/lib/visualManifest.mjs'
import { fixtureScenes, makeFixtures } from './fixtures.mjs'
import { additionalScenes } from './additionalFixtures.mjs'

export const CAPTURE_CONTEXT = Object.freeze({
  viewport: { width: 690, height: 760 },
  locale: 'en',
  timezoneId: 'UTC',
  reducedMotion: 'reduce',
  deviceScaleFactor: 1,
  colorScheme: 'light',
})
const CONTROL =
  'button:enabled,a[href],input:enabled,textarea:enabled,select:enabled,[role="option"],[role="button"],[tabindex="0"]'
const SELECTED = '[aria-selected="true"],[aria-pressed="true"],input:checked'
const FIXED_TIME = new Date('2026-10-06T12:00:00Z')

export async function rasterizationFingerprint(context) {
  const page = await context.newPage()
  try {
    await page.setViewportSize({ width: 320, height: 128 })
    await page.setContent(
      `<p style="font:13px 'Segoe UI',sans-serif">AaBb MmWw 0123456789 éß漢字</p><p style="font:13px Consolas,monospace">const value = () =&gt; { 0 !== 1; }</p>`,
    )
    await page.evaluate(() => globalThis.document.fonts.ready)
    return digest(await page.screenshot({ animations: 'disabled' }))
  } finally {
    await page.close()
  }
}

async function waitForPaint(page, selector) {
  // Chunk requests use real I/O; React's Suspense retry uses the frozen clock.
  const target = page.locator(selector).first()
  for (let attempt = 0; attempt < 100 && !(await target.isVisible()); attempt += 1) {
    await page.clock.runFor(100)
    await delay(10)
  }
  if (!(await target.isVisible())) throw new Error(`Missing painted selector: ${selector}`)
}

async function openScene(page, root, port, scene, theme, width, height, fixtures) {
  let resource = `test/harness/index.html?scenario=${width === 320 ? scene : scene.replace(/-narrow$/, '')}&theme=${theme}&bundle=${bundleFor(scene)}`
  if (fixtureScenes.has(scene)) resource = `${fixtures}/index.html?scene=${scene}`
  if (Object.hasOwn(additionalScenes, scene)) {
    const [entry, params] = additionalScenes[scene]
    resource = `${fixtures}/${entry}.html?${params}&theme=${theme}`
  }
  if (scene.startsWith('whats-new'))
    resource = `${fixtures}/${scene === 'whats-new-highlights' ? 'whats-new-highlights' : 'whats-new'}.html`
  await page.setViewportSize({ width, height })
  await page.clock.setFixedTime(FIXED_TIME)
  await page.goto(`http://127.0.0.1:${port}/${resource}`)
  // Scenario timers must start after React's initial layout effects commit;
  // advancing a frozen clock before mount races the composer's row fitting.
  if (!fixtureScenes.has(scene) && !scene.startsWith('whats-new'))
    await waitForPaint(
      page,
      'textarea,.gate,.todo-surface,.schedule-v2-surface,.models-panel,.usage-page,.traffic-view,[role=alert]',
    )
  const fixture = JSON.parse(
    await readFile(path.join(root, `test/harness/themes/${theme}.json`), 'utf8'),
  )
  await page.evaluate(
    ({ fixture, width }) => {
      const html = globalThis.document.documentElement
      html.style.width = `${width}px`
      // Match the viewport's available width even on pages with body padding.
      globalThis.document.body.style.boxSizing = 'border-box'
      globalThis.document.body.style.width = `${width}px`
      for (const [name, value] of Object.entries(fixture.variables))
        html.style.setProperty(name, value)
      for (const name of fixture.unset)
        if (!name.includes('font')) html.style.setProperty(name, 'initial')
      html.style.setProperty('--vscode-font-family', "'Segoe UI', sans-serif")
      html.style.setProperty('--vscode-editor-font-family', 'Consolas, monospace')
      html.style.setProperty('--vscode-font-size', '13px')
      html.style.setProperty('--vscode-editor-font-size', '13px')
      globalThis.document.body.className = fixture.bodyClass
    },
    { fixture, width },
  )
  await page.clock.runFor(6500)
  if (scene.startsWith('traffic-')) {
    await waitForPaint(page, '.traffic-tabs')
    await page.locator(`.traffic-tabs button[id$="-${scene.slice('traffic-'.length)}"]`).click()
    await page.clock.runFor(100)
  }
  for (const [name, selector, label] of [
    ['accounts-edit', '.accounts-section button', 'Edit'],
    ['accounts-thresholds', '.accounts-section button', 'Edit'],
    ['vault-grant', '.vault-actions button', 'Create grant'],
    ['resource-controls', '.resource-chip', undefined],
  ]) {
    if (scene !== name) continue
    await waitForPaint(page, selector)
    const buttons = page.locator(selector)
    if (label === undefined) await buttons.first().click()
    else
      await buttons
        .filter({ hasText: new RegExp(`^${label}$`) })
        .first()
        .click()
    await page.clock.runFor(100)
  }
  await page.evaluate(() => globalThis.document.fonts.ready)
  const hasStyles = await page.evaluate(() =>
    globalThis.getComputedStyle(globalThis.document.body).fontFamily.includes('Segoe UI'),
  )
  if (!hasStyles) throw new Error(`Stylesheet failed to load: ${scene}/${theme}/${width}`)
  if (!fixtureScenes.has(scene)) {
    for (
      let attempt = 0;
      attempt < 100 && (await page.locator('[data-deferred-loading]').count()) > 0;
      attempt += 1
    ) {
      await page.clock.runFor(100)
      await delay(10)
    }
    if ((await page.locator('[data-deferred-loading]').count()) > 0)
      throw new Error(`Deferred renderer did not settle: ${scene}`)
  }
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
    for (const selector of ['.steps-toggle', '.tool-toggle', '.workflow-header']) {
      // The folded tools chunk arrives after the steps group's first paint.
      if (scene === 'muse-tools' && selector === '.tool-toggle') await waitForPaint(page, selector)
      await page.locator(`${selector}[aria-expanded="false"]`).evaluateAll((buttons) => {
        for (const button of buttons) button.click()
      })
      await page.clock.runFor(100)
    }
  }
  // Let the component's real ResizeObserver refit at the final viewport
  // after host messages/fonts settle; do not assign textarea rows ourselves.
  for (const settledWidth of [width - 1, width]) {
    await page.evaluate(
      (nextWidth) =>
        new Promise((resolve) => {
          const observer = new globalThis.ResizeObserver(() => {
            observer.disconnect()
            resolve()
          })
          observer.observe(globalThis.document.body)
          globalThis.document.documentElement.style.width = `${nextWidth}px`
          globalThis.document.body.style.width = `${nextWidth}px`
        }),
      settledWidth,
    )
    // Native layout delivers ResizeObserver; the frozen clock runs its RAF.
    await page.clock.runFor(100)
  }
  if (scene === 'verify') await page.locator('.then-run').scrollIntoViewIfNeeded()
  else if (scene === 'whats-new-footer')
    await page.evaluate(() => globalThis.scrollTo(0, globalThis.document.body.scrollHeight))
}

async function targetFor(page, rows, state) {
  return await page.evaluate(
    ({ rows, control, state }) => {
      for (const element of globalThis.document.querySelectorAll('[data-visual-target]'))
        delete element.dataset.visualTarget
      const scopes = rows
        .map((row) => globalThis.document.querySelector(row.captureSelector))
        .filter((element) => element !== null)
      // Extra variants and host-rendered pages have no canonical audit row.
      if (scopes.length === 0) scopes.push(globalThis.document.body)
      // Prefer the narrowest component scope over App/Transcript wrappers.
      scopes.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
      for (const scope of scopes) {
        const elements = [
          ...(scope.matches(control) ? [scope] : []),
          ...scope.querySelectorAll(control),
        ]
        for (const element of elements) {
          if (
            state === 'disabled' &&
            (!('disabled' in element) || element === globalThis.document.activeElement)
          )
            continue
          const box = element.getBoundingClientRect()
          if (
            box.width === 0 ||
            box.height === 0 ||
            box.bottom <= 0 ||
            box.top >= globalThis.innerHeight
          )
            continue
          element.dataset.visualTarget = ''
          return `${element.tagName.toLowerCase()}.${typeof element.className === 'string' ? element.className : ''}`
        }
      }
      return null
    },
    { rows, control: state === 'selected' ? SELECTED : CONTROL, state },
  )
}

async function stateShot(page, cdp, state, target) {
  const control = page.locator('[data-visual-target]')
  let isApplied = state === 'default' || target !== null
  let nodeId
  if (target !== null) {
    const document = await cdp.send('DOM.getDocument')
    const queried = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '[data-visual-target]',
    })
    nodeId = queried.nodeId
    const pseudoClasses =
      {
        hover: ['hover'],
        pressed: ['hover', 'active'],
        'focus-visible': ['focus', 'focus-visible'],
      }[state] ?? []
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudoClasses })
  }
  if (state === 'selected') isApplied = target !== null
  if (state === 'disabled' && target !== null)
    isApplied = await control.evaluate((element) => {
      if (!('disabled' in element)) return false
      element.disabled = true
      return element.matches(':disabled')
    })
  const bytes = await page.screenshot({ animations: 'disabled' })
  if (nodeId !== undefined)
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
  if (state === 'disabled' && isApplied)
    await control.evaluate((element) => {
      element.disabled = false
    })
  return { bytes, applied: isApplied }
}

/** Streaming comparison avoids retaining thousands of images in memory. */
export async function captureMatrix(root, audit, matrix, onCapture, groups) {
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome is required for check:visual')
  const { server, port } = await serveRepo(root)
  let browser
  let profile
  let fixtures
  let totalBytes = 0
  const captures = []
  try {
    fixtures = await makeFixtures(root, port)
    profile = await mkdtemp(path.join(root, 'temp/m114-visual-profile-'))
    browser = await chromium.launchPersistentContext(profile, {
      ...CAPTURE_CONTEXT,
      ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    })
    const rasterization = await rasterizationFingerprint(browser)
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
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
    await page.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    )
    await page.clock.install({ time: FIXED_TIME })
    await page.clock.pauseAt(new Date(FIXED_TIME.getTime() + 60_000))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    for (const theme of matrix.themes)
      for (const width of matrix.widths)
        for (const scene of audit.scenes) {
          if (groups !== undefined && !groups.has(captureGroup({ scene, theme, width }))) continue
          errors.length = 0
          try {
            await openScene(page, root, port, scene, theme, width, matrix.height, fixtures)
          } catch (error) {
            throw new Error(
              `Visual scene failed: ${scene}/${theme}/${width}/en: ${error.message}; page errors: ${errors.join('; ') || 'none'}`,
              { cause: error },
            )
          }
          const rows = audit.components.filter((row) => row.scene === scene)
          for (const row of rows) {
            try {
              await waitForPaint(page, row.captureSelector)
            } catch (error) {
              const fixtureText = await page.locator('body').textContent()
              throw new Error(
                `Missing component render: ${row.file} in ${scene}; page errors: ${errors.join('; ') || 'none'}; fixture text: ${fixtureText.slice(0, 300)}`,
                { cause: error },
              )
            }
          }
          const components = await page.evaluate(
            (rows) =>
              rows.map((row) => {
                const element = globalThis.document.querySelector(row.captureSelector)
                if (
                  element === null ||
                  element.getBoundingClientRect().width === 0 ||
                  element.getBoundingClientRect().height === 0
                )
                  throw new Error(`Missing component render: ${row.file}`)
                return row.file
              }),
            rows,
          )
          // Canonical descendants must appear in the viewport, not merely in
          // a long page's DOM. Keep parents visible around the smallest scope.
          const reviewSelector = await page.evaluate(
            (rows) =>
              rows
                .map((row) => ({
                  selector: row.captureSelector,
                  box: globalThis.document
                    .querySelector(row.captureSelector)
                    .getBoundingClientRect(),
                }))
                .toSorted((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0]
                ?.selector,
            rows,
          )
          if (reviewSelector !== undefined)
            await page.locator(reviewSelector).first().scrollIntoViewIfNeeded()
          if (errors.length > 0) throw new Error(`${scene}: ${errors.join('; ')}`)
          for (const state of matrix.states) {
            const target = await targetFor(page, rows, state)
            const { bytes, applied } = await stateShot(page, cdp, state, target)
            totalBytes += bytes.length
            if (totalBytes > ARCHIVE_BUDGET)
              throw new Error('Visual archive exceeds its 512 MiB budget')
            const capture = {
              surface: surfaceForScene(scene),
              scene,
              state,
              theme,
              width,
              height: matrix.height,
              file: `${surfaceForScene(scene)}/${scene}/${state}/${theme}/${width}.png`,
              sha256: digest(bytes),
              bytes: bytes.length,
              components,
              target,
              applied,
            }
            await onCapture(capture, bytes, page)
            captures.push(capture)
          }
          if (captures.length % 72 === 0) console.log(`visual: ${captures.length} captures`)
        }
    return {
      captures,
      browser: browser.browser().version(),
      rasterization,
      platform: process.platform,
      totalBytes,
    }
  } finally {
    await browser?.close()
    server.close()
    if (fixtures !== undefined)
      await rm(path.join(root, fixtures), { recursive: true, force: true })
    if (profile !== undefined)
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

export async function saveCapture(directory, capture, bytes) {
  const destination = path.join(directory, capture.file)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
}
