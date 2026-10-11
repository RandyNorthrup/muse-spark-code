import type { Browser } from 'playwright-core'

/**
 * A fresh Chrome's first page pays browser-wide work once: a renderer start
 * and the first font fallbacks (5.5 s on a CPU-starved Mac, see
 * reviewBrowserServer.mjs). On hosted runners only each browser file's first
 * case ever missed its deadline for it (CIFIX017). Suites call this from a
 * beforeAll of its own, so it runs under a hook's limit and every case keeps
 * its deadline.
 */
export async function warmBrowser(browser: Browser): Promise<void> {
  const page = await browser.newPage()
  try {
    await page.setContent(
      '<!doctype html><html lang="en"><body><p style="font-family:sans-serif">Warm</p><pre style="font-family:monospace">warm()</pre><p lang="ja">温</p></body></html>',
    )
    await page.evaluate(async () => {
      await globalThis.document.fonts.ready
      return globalThis.document.body.getBoundingClientRect().height
    })
  } finally {
    await page.close()
  }
}
