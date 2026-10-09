// Start real Chrome once, before test workers compete for hosted CPUs. Each
// suite connects separately and owns isolated contexts; no profile is shared.
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'

export const REVIEW_BROWSER_KEY = 'reviewBrowser'
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
  project.provide(REVIEW_BROWSER_KEY, browser.wsEndpoint())
  return browser
}
