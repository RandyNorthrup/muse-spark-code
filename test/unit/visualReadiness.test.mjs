import { chromium } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject, it } from 'vitest'
import { REVIEW_BROWSER_KEY } from './helpers/reviewBrowser.mjs'
import {
  CAPTURE_CONTEXT,
  trackRequests,
  waitForDeferredPaint,
} from '../harness/goldens/capture.mjs'

const runtime = { connection: undefined, browser: undefined, page: undefined }
beforeAll(async () => {
  runtime.connection = await chromium.connect(inject(REVIEW_BROWSER_KEY))
  runtime.browser = await runtime.connection.newContext(CAPTURE_CONTEXT)
})
afterAll(async () => {
  await runtime.browser?.close()
  await runtime.connection?.close()
})
beforeEach(async () => {
  runtime.page = await runtime.browser.newPage()
  await runtime.page.clock.install()
  await runtime.page.clock.pauseAt(new Date(Date.now() + 60_000))
})
afterEach(async () => {
  await runtime.page?.close()
})

it('waits for a late question placeholder before measuring the passage origin', async () => {
  // The captured restored row is 25 px while loading and 39 px when its
  // lazy controls arrive. It does not use the ordinary deferred marker.
  await runtime.page.setContent(
    '<div data-question-slot="row" aria-busy="true" style="height:25px">Loading output…</div><p>Quoted passage</p>',
  )
  const before = await runtime.page.locator('p').boundingBox()
  await runtime.page.evaluate(() => {
    globalThis.setTimeout(() => {
      const question = globalThis.document.querySelector('[data-question-slot]')
      question.style.height = '39px'
      question.textContent = 'Open question Colour Answer'
      question.removeAttribute('aria-busy')
    }, 700)
  })
  await waitForDeferredPaint(runtime.page, 'quote-menu')
  const settled = await runtime.page.locator('p').boundingBox()
  expect(settled.y - before.y).toBe(14)
  expect(await runtime.page.locator('[aria-busy="true"]').count()).toBe(0)
})

it('continues waiting for ordinary deferred renderers', async () => {
  await runtime.page.setContent('<p data-deferred-loading>Loading output…</p>')
  await runtime.page.evaluate(() => {
    globalThis.setTimeout(
      () => globalThis.document.querySelector('[data-deferred-loading]').remove(),
      700,
    )
  })
  await waitForDeferredPaint(runtime.page, 'tools')
  expect(await runtime.page.locator('[data-deferred-loading]').count()).toBe(0)
})

it('finishes counted scene actions after a lazy renderer commits', async () => {
  await runtime.page.setContent('<input aria-label="Provider" />')
  await runtime.page.evaluate(() => {
    let isPending = true
    Object.defineProperty(globalThis, 'harnessSceneWorkPending', {
      value: () => isPending,
    })
    globalThis.setTimeout(() => {
      globalThis.document.querySelector('input').value = 'Oll'
      isPending = false
    }, 700)
  })
  await waitForDeferredPaint(runtime.page, 'models-pick')
  expect(await runtime.page.getByLabel('Provider').inputValue()).toBe('Oll')
})

it('refuses an unsettled question rather than capturing its temporary layout', async () => {
  await runtime.page.setContent(
    '<div data-question-slot="dock" aria-busy="true">Loading output…</div>',
  )
  await expect(waitForDeferredPaint(runtime.page, 'quote-menu')).rejects.toThrow(
    'Deferred renderer did not settle: quote-menu',
  )
})

it('waits for an outstanding lazy chunk even without a loading marker', async () => {
  const gate = Promise.withResolvers()
  const requested = Promise.withResolvers()
  const page = runtime.page
  trackRequests(page)
  await page.route('https://fixture.invalid/money.js', async (route) => {
    requested.resolve()
    await gate.promise
    await route.fulfill({
      contentType: 'text/javascript',
      body: "document.querySelector('dd').textContent = '$1.20'",
    })
  })
  await page.setContent('<dl><dd></dd></dl>')
  await page.evaluate(() => {
    const script = globalThis.document.createElement('script')
    script.src = 'https://fixture.invalid/money.js'
    globalThis.document.body.append(script)
  })
  await requested.promise
  let isSettled = false
  const waiting = (async () => {
    await waitForDeferredPaint(page, 'models-models')
    isSettled = true
  })()
  try {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 30))
    expect(isSettled).toBe(false)
  } finally {
    gate.resolve()
    await waiting
  }
  expect(await page.locator('dd').textContent()).toBe('$1.20')
})
