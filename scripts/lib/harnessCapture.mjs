// The harness settles in real time: Chrome's CLI virtual clock can deadlock
// while the native-DEFLATE English fallback awaits its stream's first bytes.
import path from 'node:path'
import { chromium } from 'playwright-core'

export const CAPTURE_VIRTUAL_TIME_BUDGET_MS = 6000

/** Capture the settled harness in the caller's own disposable Chrome profile. */
export async function screenshotUrl(
  chrome,
  url,
  file,
  { width, height, profileDir, virtualTimeBudgetMs = CAPTURE_VIRTUAL_TIME_BUDGET_MS },
) {
  const browser = await chromium.launchPersistentContext(profileDir, {
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    viewport: { width, height },
    args: ['--hide-scrollbars', '--no-first-run'],
  })
  try {
    const page = browser.pages()[0] ?? (await browser.newPage())
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(virtualTimeBudgetMs)
    await page.screenshot({ path: file })
  } finally {
    await browser.close()
  }
  return file
}
