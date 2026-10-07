// The harness settles in real time: Chrome's CLI virtual clock can deadlock
// while the native-DEFLATE English fallback awaits its stream's first bytes.
import path from 'node:path'
import { chromium } from 'playwright-core'
import { PAGE_TIMEOUT_MS } from './harnessServer.mjs'

/**
 * Screenshots `url` at `width`×`height` into `file` with headless Chrome.
 * The profile directory is the caller's, for the run's lifetime.
 */
export async function screenshotUrl(chrome, url, file, { width, height, profileDir }) {
  const browser = await chromium.launchPersistentContext(profileDir, {
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    viewport: { width, height },
    args: ['--hide-scrollbars'],
    timeout: PAGE_TIMEOUT_MS,
  })
  try {
    const page = await browser.newPage()
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS)
    await page.goto(url)
    // Streaming and heartbeat scenes need their timed events to play first;
    // then the same readiness check as axe waits for controls, fonts and paints.
    await page.evaluate(`themed
      .then(() => new Promise(resolve => setTimeout(resolve, AXE_AFTER_MS)))
      .then(() => whenReady(params.get('scenario') ?? 'none'))
      .then(() => {
        if (harnessErrors.length > 0) throw new Error(harnessErrors.join('; '))
      })`)
    await page.screenshot({ path: file, animations: 'disabled' })
  } finally {
    await browser.close()
  }
  return file
}
