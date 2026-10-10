// Start real Chrome once, before test workers compete for hosted CPUs. Each
// suite connects separately and owns isolated contexts; no profile is shared.
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { CAPTURE_CONTEXT, rasterizationFingerprint } from '../../harness/goldens/capture.mjs'

export const REVIEW_BROWSER_KEY = 'reviewBrowser'
export const REVIEW_RASTERIZATION_KEY = 'reviewRasterization'
const suites = [
  '/visualReadiness.test.mjs',
  '/visualStability.test.mjs',
  '/m114ConversationReview.test.mjs',
]

export async function startReviewBrowser(project, files) {
  if (files.every((file) => suites.every((suite) => !file.replaceAll('\\', '/').endsWith(suite))))
    return
  const executablePath = findChrome()
  if (executablePath === undefined) throw new Error('Chrome is required for visual review tests')
  const browser = await chromium.launchServer({ executablePath })
  try {
    // The capture fingerprint's page is a cold browser's first font fallback
    // (Segoe UI, Consolas, CJK). It took 5.5 s of the stability suite's first
    // 10-second hook on a CPU-starved Mac (CIFIX017R3): measure it once here,
    // before workers, on the same browser with the same context options.
    const connection = await chromium.connect(browser.wsEndpoint())
    try {
      const context = await connection.newContext(CAPTURE_CONTEXT)
      project.provide(REVIEW_RASTERIZATION_KEY, await rasterizationFingerprint(context))
    } finally {
      await connection.close()
    }
  } catch (error) {
    await browser.close()
    throw error
  }
  project.provide(REVIEW_BROWSER_KEY, browser.wsEndpoint())
  return browser
}
