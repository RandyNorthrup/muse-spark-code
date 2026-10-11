// The shared review browser's Playwright server, in a process of its own
// (started by reviewBrowser.mjs from global setup). Inside vitest's main
// process every suite's protocol traffic waited behind that event loop's
// module transforms for all workers, and review cases stalled past their
// deadlines (CIFIX017R3). Prints one JSON line, then serves until stdin ends.
import process from 'node:process'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { CAPTURE_CONTEXT, rasterizationFingerprint } from '../../harness/goldens/capture.mjs'

const executablePath = findChrome()
if (executablePath === undefined) throw new Error('Chrome is required for visual review tests')
const server = await chromium.launchServer({ executablePath })
process.stdin.on('end', () => {
  void server.close()
})
process.stdin.resume()
try {
  // The capture fingerprint's page is a cold browser's first font fallback
  // (Segoe UI, Consolas, CJK). It took 5.5 s of the stability suite's first
  // 10-second hook on a CPU-starved Mac: measure it once here, before
  // workers, on the same browser with the same context options.
  const connection = await chromium.connect(server.wsEndpoint())
  try {
    const context = await connection.newContext(CAPTURE_CONTEXT)
    const rasterization = await rasterizationFingerprint(context)
    process.stdout.write(`${JSON.stringify({ endpoint: server.wsEndpoint(), rasterization })}\n`)
  } finally {
    await connection.close()
  }
} catch (error) {
  await server.close()
  throw error
}
