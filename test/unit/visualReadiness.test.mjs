import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject, it } from 'vitest'
import { REVIEW_BROWSER_KEY } from './helpers/reviewBrowser.mjs'
import {
  CAPTURE_CONTEXT,
  openScene,
  playScenarioClock,
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

it.each(['Auth method', 'Auth Method'])(
  'settles the exact account label %s when reconstructing a recorded source',
  async (label) => {
    await runtime.page.route('http://127.0.0.1:1234/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<body style="font-family:Segoe UI,sans-serif"><textarea></textarea><h3 class="usage-heading">Account</h3><dl class="usage-facts"><dt>${label}</dt><dd>API key</dd></dl></body>`,
      }),
    )
    await openScene(runtime.page, process.cwd(), 1234, 'paid-always', 'light', 320, 760)
    expect(await runtime.page.locator('dt').textContent()).toBe(label)
  },
)

it.each(['Create grant', 'Create Grant'])(
  'opens the exact vault action %s when reconstructing a recorded source',
  async (label) => {
    await runtime.page.route('http://127.0.0.1:1234/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<body style="font-family:Segoe UI,sans-serif"><textarea></textarea><div class="vault-actions"><button onclick="this.dataset.clicked='true'">${label}</button></div></body>`,
      }),
    )
    await openScene(runtime.page, process.cwd(), 1234, 'vault-grant', 'light', 320, 760, 'fixtures')
    expect(await runtime.page.locator('button').getAttribute('data-clicked')).toBe('true')
  },
)

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

it('refuses an unsettled question rather than capturing its temporary layout', async () => {
  // A permanently busy marker tests the bounded refusal without 100 CDP round trips.
  let steps = 0
  const busyPage = {
    locator: () => ({ count: async () => 1 }),
    clock: {
      runFor: async () => {
        steps += 1
      },
    },
  }
  await expect(waitForDeferredPaint(busyPage, 'quote-menu')).rejects.toThrow(
    'Deferred renderer did not settle: quote-menu',
  )
  expect(steps).toBe(100)
})

it('settles a lazy agent chunk before spending the scenario readiness clock', async () => {
  trackRequests(runtime.page)
  await runtime.page.route('https://capture.invalid/chunk', async (route) => {
    await delay(50)
    await route.fulfill({
      contentType: 'text/plain',
      headers: { 'access-control-allow-origin': '*' },
      body: 'ready',
    })
  })
  await runtime.page.setContent('<main></main>')
  await runtime.page.evaluate(() => {
    globalThis.setTimeout(() => {
      void fetch('https://capture.invalid/chunk').then(() => {
        globalThis.document.querySelector('main').innerHTML =
          '<button class="agent-node-clickable">Agent</button>'
      })
      globalThis.setTimeout(() => {
        if (globalThis.document.querySelector('.agent-node-clickable') === null)
          throw new Error('agent chunk missed its existing readiness deadline')
      }, 3000)
    }, 300)
  })
  const errors = []
  runtime.page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  await playScenarioClock(runtime.page)
  expect(errors).toEqual([])
  expect(await runtime.page.locator('.agent-node-clickable').count()).toBe(1)
})
