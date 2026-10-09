// Browser checks for the chat-startup diet's lazy money and `/schedule`
// mapping (STARTUP017 review): real production ESM, CSP and fake host, the
// actual chunks aborted, restored or held. Run after `npm run build`;
// `node test/e2e/startupMoney.mjs [case…]` runs the named cases only.
// Every browser wait uses the unit-test deadline.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

const TIMEOUT_MS = 5000
const SETTLE_MS = 300
const outputs = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8')).outputs
function chunkOf(entry) {
  const found = Object.entries(outputs).find(
    ([, output]) => output.entryPoint?.replaceAll('\\', '/') === entry,
  )?.[0]
  assert.ok(found, `Missing chunk for ${entry}`)
  return found.replaceAll('\\', '/')
}
const moneyChunk = chunkOf('src/shared/paid.ts')
const promptChunk = chunkOf('src/webview/schedules/prompt.ts')
const PRICES_FAILED = 'Prices could not load.'
const RETRY = 'Try again'

const { server, port } = await serveRepo(process.cwd())
const origin = `http://127.0.0.1:${port}`
const chrome = findChrome()
assert.ok(chrome, 'Chrome is required')
const browser = await chromium.launch({
  ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
})

/** A chunk route: `abort` fails it, `hold` waits for `release`, otherwise it passes. */
function chunkRoute() {
  const route = { mode: 'pass', released: Promise.withResolvers(), requested: 0 }
  route.handler = async (request) => {
    route.requested += 1
    if (route.mode === 'abort') {
      await request.abort('failed')
      return
    }
    if (route.mode === 'hold') await route.released.promise
    await request.continue()
  }
  return route
}

async function pageFor(scenario, chunk, route, bundle = 'main') {
  const page = await browser.newPage()
  page.setDefaultTimeout(TIMEOUT_MS)
  page.setDefaultNavigationTimeout(TIMEOUT_MS)
  // The shared builder's exact script policy, as webviewDiet.mjs serves it.
  await page.route('**/test/harness/index.html*', async (request) => {
    let html = readFileSync('test/harness/index.html', 'utf8')
    html = html
      .replaceAll(/<script(?=[ >])/g, '<script nonce="DIET1"')
      .replaceAll('<style>', '<style nonce="DIET1">')
    html = html.replace(
      '<meta charset="utf-8" />',
      () =>
        `<meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${origin} data:; style-src ${origin} 'nonce-DIET1'; font-src ${origin}; script-src 'nonce-DIET1' ${origin}">`,
    )
    await request.fulfill({ contentType: 'text/html', body: html })
  })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  await page.route(`**/${chunk}*`, route.handler)
  const query = bundle === 'main' ? '' : `&bundle=${bundle}`
  await page.goto(`${origin}/test/harness/index.html?scenario=${scenario}${query}`)
  return { page, errors }
}

async function outbox(page) {
  return await page.evaluate(() => globalThis.harnessOutbox.map((message) => message))
}

async function settle(page) {
  await page.waitForTimeout(SETTLE_MS)
}

/** Retry in a fresh document (the shared surface retry), with the transport back. */
async function retryAfterRestore(page, route, scope = page) {
  route.mode = 'pass'
  await Promise.all([
    page.waitForEvent('load'),
    scope.getByRole('button', { name: RETRY, exact: true }).first().click(),
  ])
}

const cases = {
  // P2-1: a failed money chunk is said with Retry; Retry recovers every
  // mounted consumer (composer badge, paid row, palette rows, mic tooltip).
  async 'money-chat'() {
    const route = chunkRoute()
    route.mode = 'abort'
    const { page, errors } = await pageFor('paid', moneyChunk, route)
    try {
      const alert = page.getByRole('alert').filter({ hasText: PRICES_FAILED })
      await alert.waitFor()
      const rowBadge = page.locator('.badge-paid').first()
      await rowBadge.waitFor()
      assert.equal(await rowBadge.getAttribute('title'), null, 'a failed price is never guessed')
      await retryAfterRestore(page, route, alert)
      await page.locator('.badge-paid[title*="$"]').first().waitFor()
      await page.locator('[title*="per 1,000 searches"]').first().waitFor()
      assert.equal(await page.getByRole('alert').filter({ hasText: PRICES_FAILED }).count(), 0)
      assert.ok(route.requested >= 2, 'Retry fetched the money chunk again')
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  },
  async 'money-palette'() {
    const route = chunkRoute()
    route.mode = 'abort'
    const { page, errors } = await pageFor('paid-palette', moneyChunk, route)
    try {
      // Said inside the palette: a notice outside it would close it first.
      const palette = page.getByRole('dialog', { name: 'Actions' })
      await palette.waitFor()
      const alert = palette.getByRole('alert').filter({ hasText: PRICES_FAILED })
      await alert.waitFor()
      assert.equal(await palette.getByText('per hour of audio').count(), 0)
      await retryAfterRestore(page, route, alert)
      await page
        .getByRole('dialog', { name: 'Actions' })
        .getByText('per hour of audio')
        .first()
        .waitFor()
      await page.locator('[title*="per hour of audio"]').first().waitFor()
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  },
  // P2-2: consent is given to a stated price: no Accept while the cost is
  // missing, held or failed, and the honest failure offers Retry.
  async 'consent-failed'() {
    const route = chunkRoute()
    route.mode = 'abort'
    const { page, errors } = await pageFor('models-test-cost', moneyChunk, route, 'models')
    try {
      await page.getByRole('alert').filter({ hasText: PRICES_FAILED }).waitFor()
      const accept = page.getByRole('button', { name: 'Accept', exact: true })
      assert.ok(await accept.isDisabled(), 'Accept unavailable without the stated cost')
      await accept.click({ force: true })
      await settle(page)
      const sent = await outbox(page)
      assert.ok(
        sent.every((message) => message.type !== 'providers/test' || message.acceptCost !== true),
        'no consent posted without the stated cost',
      )
      await retryAfterRestore(page, route)
      await page.getByText(/0\.000002/).waitFor()
      assert.ok(await page.getByRole('button', { name: 'Accept', exact: true }).isEnabled())
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  },
  async 'consent-held'() {
    const route = chunkRoute()
    route.mode = 'hold'
    const { page, errors } = await pageFor('models-test-cost', moneyChunk, route, 'models')
    try {
      const accept = page.getByRole('button', { name: 'Accept', exact: true })
      await accept.waitFor()
      await page.waitForFunction(() => globalThis.document.querySelector('[role=status]') !== null)
      assert.ok(await accept.isDisabled(), 'Accept waits for the held cost')
      route.released.resolve()
      await page.getByText(/0\.000002/).waitFor()
      await accept.click()
      await settle(page)
      const sent = await outbox(page)
      assert.ok(
        sent.some((message) => message.type === 'providers/test' && message.acceptCost === true),
      )
      assert.deepEqual(errors, [])
    } finally {
      route.released.resolve()
      await page.close()
    }
  },
  // P2-3: a budget change pending on a held chunk is dropped when the
  // wizard is cancelled before the chunk arrives.
  async 'wizard-cancel'() {
    const route = chunkRoute()
    route.mode = 'hold'
    const { page, errors } = await pageFor('models-suggestions', moneyChunk, route, 'models')
    try {
      const budget = page.locator('#models-budget-override')
      await budget.fill('7.5')
      await page.getByRole('button', { name: 'Change', exact: true }).nth(1).click()
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
      route.released.resolve()
      await settle(page)
      const sent = await outbox(page)
      const cancelAt = sent.findIndex(
        (message) => message.type === 'providers/wizard' && message.event === 'cancel',
      )
      assert.ok(cancelAt !== -1, 'the wizard was cancelled')
      assert.deepEqual(
        sent.filter((message) => message.type === 'suggestions/change'),
        [],
        'a cancelled wizard receives no budget change',
      )
      assert.deepEqual(errors, [])
    } finally {
      route.released.resolve()
      await page.close()
    }
  },
  // P2-4: a failed `/schedule` mapping hands the command back with the warning.
  async 'schedule-failed'() {
    const route = chunkRoute()
    route.mode = 'abort'
    const { page, errors } = await pageFor('empty', promptChunk, route)
    try {
      const prompt = page.getByLabel('Message Muse', { exact: true })
      await prompt.waitFor()
      await openScheduleSurface(page)
      await prompt.fill('/schedule add Keep this exact prompt')
      await prompt.press('Enter')
      await page.getByText('The schedule command failed').first().waitFor()
      assert.equal(await prompt.inputValue(), '/schedule add Keep this exact prompt')
      const sent = await outbox(page)
      assert.ok(sent.every((message) => message.type !== 'openSchedules'))
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  },
  // P2-5: a mapping held past its surface's Cancel and a cleared
  // conversation opens nothing when it arrives.
  async 'schedule-stale'() {
    const route = chunkRoute()
    route.mode = 'hold'
    const { page, errors } = await pageFor('empty', promptChunk, route)
    try {
      const prompt = page.getByLabel('Message Muse', { exact: true })
      await prompt.waitFor()
      await openScheduleSurface(page)
      await prompt.fill('/schedule add Keep this exact prompt')
      await prompt.press('Enter')
      // The surface's own Cancel, while the mapping is still held.
      await page.getByRole('button', { name: 'Cancel', exact: true }).first().click()
      await page.getByLabel('New conversation', { exact: true }).click()
      route.released.resolve()
      await settle(page)
      const sent = await outbox(page)
      assert.ok(
        sent.every((message) => message.type !== 'openSchedules'),
        'an abandoned command opens no editor',
      )
      assert.deepEqual(errors, [])
    } finally {
      route.released.resolve()
      await page.close()
    }
  },
}

/** The host's schedule props, as a schedule command's opening posts them. */
async function openScheduleSurface(page) {
  await page.evaluate(() => {
    globalThis.dispatchEvent(
      new globalThis.MessageEvent('message', {
        data: {
          type: 'schedulesSurface',
          workspaceKey: 'workspace-1',
          targets: [],
          defaultDraft: {
            name: 'Check the build',
            action: { kind: 'prompt', prompt: 'Read the build result and report any failures.' },
            trigger: {
              kind: 'weekly',
              days: [{ weekday: 1, times: [{ hour: 9, minute: 0 }] }],
            },
            target: { kind: 'conversation', backend: 'modelApi', sessionId: 'build-session' },
            delivery: 'interrupt',
            whenClosed: 'open',
            catchUp: 'runOnce',
            mode: 'manual',
            grant: { rules: [], destinationIds: [], paidCapUsd: 1 },
            paidCapUsd: 1,
            parallel: false,
            zone: 'America/Los_Angeles',
            end: { afterRuns: 20 },
            pinned: false,
          },
          nowMs: Date.parse('2026-10-06T12:00:00Z'),
          initialView: 'list',
        },
      }),
    )
  })
}

const selected = process.argv.slice(2)
const failures = []
try {
  for (const [name, run] of Object.entries(cases)) {
    if (selected.length > 0 && !selected.includes(name)) continue
    try {
      await run()
      console.log(`PASS ${name}`)
    } catch (error) {
      failures.push(name)
      console.log(
        `FAIL ${name}: ${error instanceof Error ? error.message.split('\n', 1)[0] : String(error)}`,
      )
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
if (failures.length > 0) {
  console.log(`${failures.length} failed: ${failures.join(', ')}`)
  process.exitCode = 1
}
