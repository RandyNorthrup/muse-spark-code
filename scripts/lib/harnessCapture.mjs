// One headless-Chrome screenshot of a harness page, shared by the scripts
// that render test/harness/index.html (harness-shots.mjs, readme-shots.mjs)
// so the capture flags live in one place.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
// The scenario plays out under a fast-forwarded clock, as in
// harness-shots: the shot waits for it to settle.
export const CAPTURE_VIRTUAL_TIME_BUDGET_MS = 6000

/**
 * Screenshots `url` at `width`×`height` into `file` with headless Chrome.
 * The profile directory is the caller's, for the run's lifetime.
 */
export async function screenshotUrl(
  chrome,
  url,
  file,
  { width, height, profileDir, virtualTimeBudgetMs = CAPTURE_VIRTUAL_TIME_BUDGET_MS },
) {
  await execFileAsync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      `--user-data-dir=${profileDir}`,
      `--window-size=${String(width)},${String(height)}`,
      `--virtual-time-budget=${String(virtualTimeBudgetMs)}`,
      `--screenshot=${file}`,
      url,
    ],
    { windowsHide: true },
  )
  return file
}
