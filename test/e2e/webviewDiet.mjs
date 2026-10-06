// Browser smoke for optional surfaces: real production ESM, CSP and fake host.
// Run after npm run build. Every browser wait uses the unit-test deadline.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

const TIMEOUT_MS = 5000
const surfaces = [
  ['SignIn', 'signin', '.gate-title'],
  ['GoalPanel', 'goal', '.goal'],
  ['SchedulePanel', 'schedules', '.local-schedules'],
  ['Palette', 'palette', '.palette-filter'],
  ['PopoverMenu', 'modes', '[role="menu"]'],
  ['GooeyMenuContent', 'chat-menu', '[role="menu"]'],
  ['UsageDialogContent', 'usage', '.usage-facts'],
  ['AgentMapContent', 'agents', '.agent-tree'],
]
const outputs = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8')).outputs
const chunks = new Map(
  surfaces.map(([name]) => [
    name,
    Object.entries(outputs)
      .find(
        ([, output]) =>
          output.entryPoint?.replaceAll('\\', '/') === `src/webview/components/${name}.tsx`,
      )?.[0]
      .replaceAll('\\', '/'),
  ]),
)
for (const [name, chunk] of chunks) assert.ok(chunk, `Missing ${name} chunk`)
const { server, port } = await serveRepo(process.cwd())
const origin = `http://127.0.0.1:${port}`
const chrome = findChrome()
assert.ok(chrome, 'Chrome is required')
const browser = await chromium.launch({
  ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
})
try {
  async function pageFor(scenario, rejectedChunk, shouldReject) {
    const page = await browser.newPage()
    page.setDefaultTimeout(TIMEOUT_MS)
    page.setDefaultNavigationTimeout(TIMEOUT_MS)
    // Exercise the shared builder's exact script policy. Nonces also cover
    // the fake host and theme's inline setup, which production HTML omits.
    await page.route('**/test/harness/index.html*', async (route) => {
      let html = readFileSync('test/harness/index.html', 'utf8')
      html = html
        .replaceAll(/<script(?=[ >])/g, '<script nonce="DIET1"')
        .replaceAll('<style>', '<style nonce="DIET1">')
      html = html.replace(
        '<meta charset="utf-8" />',
        () =>
          `<meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${origin} data:; style-src ${origin} 'nonce-DIET1'; font-src ${origin}; script-src 'nonce-DIET1' ${origin}">`,
      )
      await route.fulfill({ contentType: 'text/html', body: html })
    })
    const requests = []
    page.on('request', (request) => {
      requests.push(new URL(request.url()).pathname.slice(1))
    })
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })
    if (rejectedChunk !== undefined) {
      await page.route(`**/${rejectedChunk}*`, (route) =>
        shouldReject() ? route.abort('failed') : route.continue(),
      )
    }
    await page.goto(`${origin}/test/harness/index.html?scenario=${scenario}`)
    return { page, requests, errors }
  }
  const startup = await pageFor('empty')
  await startup.page.getByLabel('Message Muse', { exact: true }).waitFor()
  for (const [name, chunk] of chunks)
    assert.ok(!startup.requests.includes(chunk), `${name} requested at startup`)
  assert.deepEqual(startup.errors, [])
  await startup.page.close()
  for (const [name, scenario, selector] of surfaces) {
    const { page, requests, errors } = await pageFor(scenario)
    try {
      await page.locator(selector).first().waitFor()
      assert.ok(requests.includes(chunks.get(name)), `${name} not requested on first use`)
      assert.equal(await page.locator('[data-deferred-loading]').count(), 0)
      assert.deepEqual(errors, [])
      console.log(`PASS ${name}: startup absent; first use loads under CSP`)
    } finally {
      await page.close()
    }
  }
  // Fail each real import, then retry it in the same document.
  for (const [name, scenario, selector] of surfaces) {
    let shouldReject = true
    const failure = await pageFor(scenario, chunks.get(name), () => shouldReject)
    try {
      await failure.page
        .getByRole('alert')
        .filter({ hasText: 'This panel could not load.' })
        .waitFor()
      shouldReject = false
      await failure.page.getByRole('button', { name: 'Try again', exact: true }).click()
      await failure.page.locator(selector).first().waitFor()
      assert.equal(await failure.page.getByRole('alert').count(), 0)
      console.log(`PASS ${name}: honest load failure and successful retry`)
    } finally {
      await failure.page.close()
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
