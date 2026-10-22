// Fake-only native keyboard and missing-asset check for the shared Devices UI.
// Run from the repository root after producing dist/webview/main.js:
//   node scripts/devices-keyboard.mjs
// Uses the installed Chrome and public synthetic fixtures only. Profiles live
// under this worktree's ignored temp/ directory and are removed in finally.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright-core'
import { format } from 'prettier'
import { findChrome } from './lib/chrome.mjs'
import { serveRepo } from './lib/harnessServer.mjs'
import { loadL10n } from './lib/l10nSource.mjs'

const root = process.cwd()
const { EN } = await loadL10n(root)
const SELECT_ALL_KEY = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
await mkdir(path.join(root, 'temp'), { recursive: true })
const profile = await mkdtemp(path.join(root, 'temp', 'm100-u-browser-'))
const { server, port } = await serveRepo(root)
const browser = await chromium.launchPersistentContext(profile, {
  executablePath: findChrome(),
  viewport: { width: 320, height: 760 },
})
const receipts = []

async function deviceActions(page) {
  const messages = await page.evaluate('globalThis.harnessOutbox')
  assert.deepEqual(messages[0], { type: 'devicesReady' })
  return messages.flatMap((message) => {
    if (message.type === 'devicesReady') {
      assert.deepEqual(message, { type: 'devicesReady' })
      return []
    }
    return [message.action?.kind]
  })
}
try {
  for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
    console.log('Keyboard theme:', theme)
    const page = await browser.newPage()
    const cdp = await browser.newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    try {
      await page.goto(
        `http://127.0.0.1:${port}/test/harness/index.html?scenario=devices-off&theme=${theme}`,
      )
      await page.locator('[data-devices-ready]').waitFor()
      const pair = page.getByRole('button', { name: 'Pair device', exact: true })
      await pair.focus()
      await page.keyboard.press('Enter')
      const text = page.getByLabel('Copy public invitation', { exact: true })
      await text.waitFor()
      const invitation = JSON.parse(await text.inputValue())
      await page.getByRole('button', { name: 'Copy public invitation', exact: true }).focus()
      await page.keyboard.press('Enter')
      const selection = await text.evaluate((field) => ({
        start: field.selectionStart,
        end: field.selectionEnd,
        length: field.value.length,
        isFocused: field === globalThis.document.activeElement,
      }))
      assert.equal(selection.isFocused, true)
      assert.equal(selection.start, 0)
      assert.equal(selection.end, selection.length)
      const peer = {
        ...invitation,
        invitationId: '6'.repeat(32),
        fingerprint: '0123456789abcdef'.repeat(4),
      }
      const input = page.getByLabel('Scan QR or paste text', { exact: true })
      await input.focus()
      await page.keyboard.insertText(JSON.stringify(peer))
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.locator('.device-comparison').waitFor()
      await page.waitForFunction(
        () =>
          globalThis.document.activeElement ===
          globalThis.document.querySelector('.device-comparison h3'),
      )
      const grouped = '0123 4567 89ab cdef '.repeat(4).trim()
      assert.equal(
        await page.locator('.device-comparison code').getAttribute('aria-label'),
        grouped,
      )
      const headingObject = await cdp.send('Runtime.evaluate', {
        expression: "document.querySelector('.device-comparison h3')",
      })
      const accessibility = await cdp.send('Accessibility.getPartialAXTree', {
        objectId: headingObject.result.objectId,
        fetchRelatives: false,
      })
      assert.equal(accessibility.nodes[0].description.value, grouped)
      assert.deepEqual(await decisionRows(page), [])
      const groupRects = await page
        .locator('.device-comparison code > span > span')
        .evaluateAll((groups) =>
          groups.map((group) => {
            const range = globalThis.document.createRange()
            range.selectNodeContents(group)
            return {
              text: group.textContent,
              lines: range.getClientRects().length,
              whiteSpace: globalThis.getComputedStyle(group).whiteSpace,
            }
          }),
        )
      assert.deepEqual(
        groupRects.map((group) => group.text),
        grouped.split(' '),
      )
      assert.equal(
        groupRects.every((group) => group.lines === 1 && group.whiteSpace === 'nowrap'),
        true,
      )
      assert.equal(
        await page.getByRole('button', { name: 'Confirm fingerprint', exact: true }).isDisabled(),
        true,
      )
      await page.keyboard.press('Tab')
      await page.keyboard.press('Space')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      const confirmation = page.getByLabel('Copy confirmation', { exact: true })
      await confirmation.waitFor()
      await input.focus()
      await page.keyboard.press(SELECT_ALL_KEY)
      await page.keyboard.insertText(await confirmation.inputValue())
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() =>
        globalThis.harnessOutbox.some((request) => request.action?.kind === 'importConfirmation'),
      )
      const pairingCalls = await deviceActions(page)
      // Pairing does not implicitly enable the off fixture. Cap/unlink controls
      // run against the separate connected fixture and its correlated replies.
      await page.goto(
        `http://127.0.0.1:${port}/test/harness/index.html?scenario=devices-connected&theme=${theme}`,
      )
      await page.locator('[data-devices-ready]').waitFor()
      await page.getByLabel('Offer checks', { exact: true }).focus()
      await page.keyboard.press('Space')
      const workers = page.getByLabel('Worker limit', { exact: true })
      await workers.focus()
      await page.keyboard.press(SELECT_ALL_KEY)
      await page.keyboard.insertText('1')
      await page.getByRole('button', { name: 'Review and save local offer' }).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() =>
        globalThis.harnessOutbox.some((request) => request.action?.kind === 'offer'),
      )
      const offer = await page.evaluate(
        'globalThis.harnessOutbox.findLast((request) => request.action?.kind === "offer").action',
      )
      assert.equal(offer.checks, true)
      assert.equal(offer.lanes, false)
      assert.equal(offer.caps.workers, 1)
      const unlink = page.getByRole('button', { name: 'Unlink', exact: true })
      await page.waitForFunction(
        () =>
          ![...globalThis.document.querySelectorAll('.device-card button')].find(
            (button) => button.textContent === 'Unlink',
          )?.disabled,
      )
      await unlink.focus()
      await page.keyboard.press('Enter')
      await page.locator('.device-unlink').waitFor()
      assert.deepEqual(await decisionRows(page), [])
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.device-unlink').count(), 0)
      assert.equal(
        await unlink.evaluate((button) => button === globalThis.document.activeElement),
        true,
      )
      await page.keyboard.press('Enter')
      await page.locator('.device-unlink').waitFor()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() =>
        globalThis.harnessOutbox.some((request) => request.action?.kind === 'unlink'),
      )
      const calls = [...pairingCalls, ...(await deviceActions(page))]
      assert.equal(calls.filter((kind) => kind === 'unlink').length, 1)
      assert.equal(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        true,
      )
      assert.deepEqual(await page.evaluate('harnessErrors'), [])
      const hasOnlyLocalActions = calls.every((kind) =>
        [
          'pair',
          'importInvitation',
          'confirmFingerprint',
          'importConfirmation',
          'offer',
          'unlink',
        ].includes(kind),
      )
      assert.equal(hasOnlyLocalActions, true)
      receipts.push({
        theme,
        width: 320,
        browser: browser.browser()?.version(),
        keys: ['Enter', 'Tab', 'Space', SELECT_ALL_KEY, 'Escape'],
        actions: calls,
        textFallbackSelection: true,
        comparisonFocus: true,
        groupedFingerprintAnnouncement: grouped,
        fingerprintGroupsUnbroken: true,
        decisionRowsEqual: true,
        noApprovalGrantRequests: hasOnlyLocalActions,
        unlinkCancelFocus: true,
        overflow: false,
      })
    } finally {
      await page.close()
    }
  }
  await writeFile(
    path.join(root, 'docs/certification/m100-u-keyboard.json'),
    await format(JSON.stringify(receipts), { parser: 'json' }),
  )
  const outputs = JSON.parse(
    await readFile(path.join(root, 'dist/meta/webview.json'), 'utf8'),
  ).outputs
  const asset = Object.entries(outputs).find(
    ([, output]) =>
      output.entryPoint?.replaceAll('\\', '/') ===
      'src/webview/models/sections/agents/DevicesApp.tsx',
  )?.[0]
  assert.ok(asset, 'Devices lazy asset must exist in the actual build metadata')
  const missing = await browser.newPage()
  try {
    await missing.route(`**/${asset.replaceAll('\\', '/')}`, async (route) => {
      await route.abort()
    })
    await missing.goto(
      `http://127.0.0.1:${port}/test/harness/index.html?scenario=devices-missing-asset&theme=dark`,
    )
    await missing.getByRole('heading', { name: EN.surfaceLoadFailed, exact: true }).waitFor()
    assert.equal(
      await missing.getByRole('button', { name: EN.surfaceLoadRetry, exact: true }).count(),
      1,
    )
    assert.equal(await missing.getByRole('button', { name: 'Pair device', exact: true }).count(), 0)
    assert.deepEqual(await missing.evaluate('outbox'), [])
    receipts.push({
      scenario: 'missing lazy Devices asset',
      localizedFailure: true,
      reload: true,
      deviceRequests: 0,
    })
  } finally {
    await missing.close()
  }
  await writeFile(
    path.join(root, 'docs/certification/m100-u-keyboard.json'),
    await format(JSON.stringify(receipts), { parser: 'json' }),
  )
  console.log(
    'Keyboard pairing/text fallback/caps/unlink passed in four themes at 320px; missing asset refused with recovery and no requests.',
  )
} finally {
  await browser.close()
  server.close()
  await rm(profile, { recursive: true, force: true })
}

async function decisionRows(page) {
  return await page.locator('.device-decisions').evaluateAll((rows) =>
    rows
      .map((row) => {
        const buttons = [...row.querySelectorAll(':scope > button')]
        if (buttons.length !== 2) return 'missing decision button'
        const [first, second] = buttons.map((button) => button.getBoundingClientRect())
        return Math.abs(first.width - second.width) <= 1 && first.top === second.top
          ? undefined
          : 'unequal or stacked decision buttons'
      })
      .filter((problem) => problem !== undefined),
  )
}
