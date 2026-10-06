#!/usr/bin/env node
// Headless host-independent legal UI: real Chromium accessibility tree,
// keyboard input and browser metrics equivalent to 100/200 percent zoom.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { findChrome } from './lib/chrome.mjs'
import { prepareLang, langQuery } from './lib/harnessLang.mjs'
import { HARNESS_PATH, LOOPBACK, PAGE_TIMEOUT_MS, serveRepo } from './lib/harnessServer.mjs'

const THEMES = ['light', 'dark', 'hc-dark', 'hc-light']
const LANGUAGES = [undefined, 'pseudo']
const SCENARIOS = ['legal', 'legal-preview', 'legal-narrow']
const WIDTHS = [690, 320]
const ZOOMS = [1, 2]
const HEIGHT = 760
const FOCUS_STEPS = 12
const EXPECTED_PLATFORM =
  process.argv.find((value) => value.startsWith('--platform='))?.slice('--platform='.length) ??
  process.platform
const OUTPUT =
  process.argv.find((value) => value.startsWith('--out='))?.slice('--out='.length) ??
  'temp/legal-a11y'
assert.equal(
  process.platform,
  EXPECTED_PLATFORM,
  'Run this receipt on the named platform; a different OS cannot certify it',
)
const chrome = findChrome()
assert.ok(chrome, 'Chrome is required; set CHROME_PATH')
await mkdir(OUTPUT, { recursive: true })
const profile = await mkdtemp(path.join(tmpdir(), 'muse-legal-a11y-'))
const { server, port } = await serveRepo(process.cwd())
const receipts = []
let browser
try {
  browser = await chromium.launchPersistentContext(profile, {
    executablePath: chrome,
    headless: true,
    viewport: { width: WIDTHS[0], height: HEIGHT },
    timeout: PAGE_TIMEOUT_MS,
  })
  const tab = await browser.newPage()
  const cdp = await browser.newCDPSession(tab)
  for (const language of LANGUAGES) {
    await prepareLang(process.cwd(), language)
    for (const theme of THEMES) {
      for (const scenario of SCENARIOS) {
        for (const width of WIDTHS) {
          for (const zoom of ZOOMS) {
            await cdp.send('Emulation.setDeviceMetricsOverride', {
              width: width / zoom,
              height: HEIGHT / zoom,
              deviceScaleFactor: zoom,
              mobile: false,
            })
            await tab.goto(
              `http://${LOOPBACK}:${port}/${HARNESS_PATH}?scenario=${scenario}&theme=${theme}${langQuery(language)}`,
            )
            const dialog = tab.getByRole('dialog')
            await dialog.waitFor({ timeout: PAGE_TIMEOUT_MS })
            const layout = await dialog.evaluate((element) => ({
              width: element.clientWidth,
              content: element.scrollWidth,
              viewport: element.ownerDocument.defaultView?.innerWidth ?? 0,
              scale: element.ownerDocument.defaultView?.devicePixelRatio ?? 0,
              right: element.getBoundingClientRect().right,
              named: element.hasAttribute('aria-labelledby'),
              focused: element.contains(element.ownerDocument.activeElement),
            }))
            assert.equal(layout.scale, zoom)
            assert.ok(layout.named && layout.focused, JSON.stringify(layout))
            assert.ok(
              layout.content <= layout.width + 1 && layout.right <= layout.viewport + 1,
              `Horizontal overflow: ${JSON.stringify(layout)}`,
            )
            const tree = await cdp.send('Accessibility.getFullAXTree')
            assert.ok(
              tree.nodes.some(
                (node) => node.role?.value === 'dialog' && (node.name?.value?.length ?? 0) > 0,
              ),
              'The native accessibility tree must name the dialog',
            )
            const box = dialog.locator('input[type="checkbox"]:enabled').first()
            if ((await box.count()) > 0) {
              const checked = await box.isChecked()
              await box.focus()
              await tab.keyboard.press('Space')
              assert.equal(await box.isChecked(), !checked, 'Keyboard selection must toggle')
            }
            for (let step = 0; step < FOCUS_STEPS; step += 1) {
              await tab.keyboard.press(step % 2 === 0 ? 'Tab' : 'Shift+Tab')
              assert.ok(
                await dialog.evaluate((element) =>
                  element.contains(element.ownerDocument.activeElement),
                ),
                'Keyboard focus escaped the dialog',
              )
            }
            await tab.keyboard.press('Escape')
            await dialog.waitFor({ state: 'detached', timeout: PAGE_TIMEOUT_MS })
            receipts.push({
              platform: process.platform,
              language: language ?? 'en',
              theme,
              scenario,
              width,
              zoom,
              layout,
              accessibilityTree: true,
              keyboard: true,
            })
          }
        }
      }
    }
  }
} finally {
  await browser?.close()
  server.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
await writeFile(path.join(OUTPUT, 'receipts.json'), JSON.stringify(receipts, null, 2) + '\n')
for (const language of LANGUAGES) {
  const result = spawnSync(
    process.execPath,
    ['scripts/a11y.mjs', ...SCENARIOS, ...(language === undefined ? [] : [`--lang=${language}`])],
    { stdio: 'inherit' },
  )
  assert.equal(result.status, 0, 'The legal WCAG checks must all pass')
}
console.log(
  `legal a11y: ${receipts.length} headless Chromium/keyboard/zoom checks on ${process.platform}; English and pseudo WCAG checks passed`,
)
