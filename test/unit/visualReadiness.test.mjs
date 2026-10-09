import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { CAPTURE_CONTEXT, waitForDeferredPaint } from '../harness/goldens/capture.mjs'

const runtime = { profile: undefined, browser: undefined, page: undefined }
beforeAll(async () => {
  runtime.profile = await mkdtemp(path.join(tmpdir(), 'visual-readiness-'))
  runtime.browser = await chromium.launchPersistentContext(runtime.profile, {
    ...CAPTURE_CONTEXT,
    executablePath: findChrome(),
  })
})
afterAll(async () => {
  await runtime.browser?.close()
  if (runtime.profile !== undefined) await rm(runtime.profile, { recursive: true, force: true })
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

it('refuses an unsettled question rather than capturing its temporary layout', async () => {
  await runtime.page.setContent(
    '<div data-question-slot="dock" aria-busy="true">Loading output…</div>',
  )
  await expect(waitForDeferredPaint(runtime.page, 'quote-menu')).rejects.toThrow(
    'Deferred renderer did not settle: quote-menu',
  )
})
