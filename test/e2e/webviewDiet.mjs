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
  ['LegalReport', 'legal', '.legal-finding'],
  ['ReviewCommentForm', 'review-comment', '.review-comment textarea'],
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
const surfaceEnglish = Object.entries(outputs)
  .find(
    ([, output]) => output.entryPoint === 'browser-surface-english:browser-surface-english',
  )?.[0]
  .replaceAll('\\', '/')
assert.ok(surfaceEnglish, 'Missing surface English chunk')
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
  assert.ok(!startup.requests.includes(surfaceEnglish), 'Surface English requested at startup')
  assert.deepEqual(startup.errors, [])
  await startup.page.close()
  const dependency = Object.entries(outputs)
    .find(([, output]) =>
      Object.keys(output.inputs).some((file) =>
        file.replaceAll('\\', '/').endsWith('/paletteDialog.tsx'),
      ),
    )?.[0]
    .replaceAll('\\', '/')
  assert.ok(dependency, 'Missing palette static dependency')
  let shouldRejectDependency = true
  const failedDependency = await pageFor('empty', dependency, () => shouldRejectDependency)
  try {
    const prompt = failedDependency.page.getByLabel('Message Muse', { exact: true })
    await prompt.fill('Draft survives a failed dependency')
    await failedDependency.page.evaluate(() => {
      globalThis.dispatchEvent(
        new globalThis.MessageEvent('message', {
          data: {
            type: 'sessionInfo',
            modelId: 'muse-spark-1.3',
            contextLimit: 1_007_997,
            sessionId: 'diet-retry-session',
          },
        }),
      )
      globalThis.dispatchEvent(
        new globalThis.MessageEvent('message', {
          data: {
            type: 'agentEvent',
            event: {
              type: 'itemCompleted',
              item: {
                itemId: 'preserved-reply',
                kind: 'agentMessage',
                status: 'completed',
                text: 'Conversation survives a failed dependency',
              },
            },
          },
        }),
      )
    })
    await failedDependency.page
      .getByText('Conversation survives a failed dependency', { exact: true })
      .waitFor()
    await failedDependency.page.getByLabel('Commands', { exact: true }).click()
    await failedDependency.page
      .getByRole('alert')
      .filter({ hasText: 'This panel could not load.' })
      .waitFor()
    shouldRejectDependency = false
    const loaded = failedDependency.page.waitForEvent('load')
    await failedDependency.page.getByRole('button', { name: 'Try again', exact: true }).click()
    await loaded
    assert.equal(await prompt.inputValue(), 'Draft survives a failed dependency')
    await failedDependency.page
      .getByText('Conversation survives a failed dependency', { exact: true })
      .waitFor()
    await failedDependency.page.getByLabel('Commands', { exact: true }).click()
    await failedDependency.page.locator('.palette-filter').waitFor()
    assert.equal(failedDependency.requests.filter((file) => file === dependency).length, 2)
    assert.equal(
      failedDependency.requests.filter((file) => file === chunks.get('Palette')).length,
      2,
    )
    assert.deepEqual(failedDependency.errors, [])
    console.log('PASS P2-1: failed static dependency refetched after Retry; draft preserved')
  } finally {
    await failedDependency.page.close()
  }
  for (const [name, scenario, selector] of surfaces) {
    const { page, requests, errors } = await pageFor(scenario)
    try {
      await page.locator(selector).first().waitFor()
      assert.ok(requests.includes(chunks.get(name)), `${name} not requested on first use`)
      assert.ok(requests.includes(surfaceEnglish), `${name} did not load its English`)
      assert.equal(await page.locator('[data-deferred-loading]').count(), 0)
      assert.deepEqual(errors, [])
      console.log(`PASS ${name}: startup absent; first use loads under CSP`)
    } finally {
      await page.close()
    }
  }
  // Fail each real import, then retry in a fresh document with persisted state.
  const failures = [...surfaces, ['surface English', 'legal', '.legal-finding', surfaceEnglish]]
  for (const [name, scenario, selector, chunk = chunks.get(name)] of failures) {
    let shouldReject = true
    const failure = await pageFor(scenario, chunk, () => shouldReject)
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
  const failedMenu = await pageFor('empty', chunks.get('GooeyMenuContent'), () => true)
  try {
    await failedMenu.page.getByLabel('Message Muse', { exact: true }).waitFor()
    await failedMenu.page.evaluate(() => {
      globalThis.dispatchEvent(
        new globalThis.MessageEvent('message', {
          data: {
            type: 'agentEvent',
            event: {
              type: 'itemCompleted',
              item: {
                itemId: 'failed-menu',
                kind: 'agentMessage',
                status: 'completed',
                text: 'Failed menu response',
              },
            },
          },
        }),
      )
    })
    const trigger = failedMenu.page.getByLabel('More actions', { exact: true }).last()
    await trigger.click()
    const retry = failedMenu.page.getByRole('button', { name: 'Try again', exact: true })
    await retry.focus()
    await failedMenu.page.keyboard.press('Escape')
    assert.equal(await failedMenu.page.getByRole('alert').count(), 0)
    assert.ok(await trigger.evaluate((node) => node === globalThis.document.activeElement))
    console.log('PASS P3: failed row menu closes on Escape and restores trigger focus')
  } finally {
    await failedMenu.page.close()
  }
  async function dismissColdMenu(page, dismissal) {
    switch (dismissal) {
      case 'Escape': {
        await page.keyboard.press('Escape')
        return
      }
      case 'navigation': {
        await page.getByLabel('New conversation', { exact: true }).click()
        return
      }
      case 'focus': {
        await page.getByLabel('Message Muse', { exact: true }).focus()
        return
      }
      default: {
        await page.getByLabel('Message Muse', { exact: true }).click()
      }
    }
  }
  for (const dismissal of ['pointer', 'focus', 'Escape', 'navigation']) {
    const cold = await pageFor('empty')
    const started = Promise.withResolvers()
    const released = Promise.withResolvers()
    const finished = Promise.withResolvers()
    await cold.page.route(`**/${chunks.get('GooeyMenuContent')}*`, async (route) => {
      started.resolve()
      await released.promise
      await route.continue()
      finished.resolve()
    })
    try {
      await cold.page.getByLabel('Message Muse', { exact: true }).waitFor()
      // Use the existing capture-backed itemCompleted fixture shape.
      await cold.page.evaluate(() => {
        globalThis.dispatchEvent(
          new globalThis.MessageEvent('message', {
            data: {
              type: 'agentEvent',
              event: {
                type: 'itemCompleted',
                item: {
                  itemId: 'cold-menu',
                  kind: 'agentMessage',
                  status: 'completed',
                  text: 'Cold menu response',
                },
              },
            },
          }),
        )
      })
      const trigger = cold.page.getByLabel('More actions', { exact: true }).last()
      await trigger.click()
      await started.promise
      await cold.page.locator('[data-deferred-loading]').waitFor()
      const prompt = cold.page.getByLabel('Message Muse', { exact: true })
      await dismissColdMenu(cold.page, dismissal)
      assert.equal(await cold.page.locator('[data-deferred-loading]').count(), 0)
      if (dismissal === 'Escape')
        assert.ok(await trigger.evaluate((node) => node === globalThis.document.activeElement))
      released.resolve()
      await finished.promise
      await cold.page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
          ),
      )
      assert.equal(await cold.page.getByRole('menu').count(), 0)
      if (dismissal === 'pointer' || dismissal === 'focus')
        assert.ok(await prompt.evaluate((node) => node === globalThis.document.activeElement))
      assert.deepEqual(cold.errors, [])
      console.log(
        `PASS P2-2: cold row menu dismissed by ${dismissal}; late import cannot take focus`,
      )
    } finally {
      released.resolve()
      await cold.page.close()
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
