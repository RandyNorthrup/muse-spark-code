import { createHash } from 'node:crypto'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { buildNodeWorkspace } from '../harness/build-node.mjs'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { loadL10n } from '../../scripts/lib/l10nSource.mjs'

const state = { pages: [] }
beforeAll(async () => {
  const dependencies = path.resolve('temp/u1-deps/node_modules')
  await buildNodeWorkspace(undefined, existsSync(dependencies) ? dependencies : undefined)
  const locale = await loadL10n(process.cwd())
  state.text = locale.EN
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome is required for the real node browser fixture')
  const served = await serveRepo(process.cwd())
  state.server = served.server
  state.port = served.port
  state.browser = await chromium.launch({ executablePath: chrome })
})
afterEach(async () => {
  for (const page of state.pages.splice(0)) await page.close()
})
afterAll(async () => {
  await state.browser?.close()
  if (state.server !== undefined) await new Promise((resolve) => state.server.close(resolve))
})
async function pageFor(scenario = 'node-editor', language, width = 690) {
  const page = await state.browser.newPage({ viewport: { width, height: 760 } })
  state.pages.push(page)
  await page.goto(
    `http://127.0.0.1:${String(state.port)}/test/harness/node.html?scenario=${scenario}&theme=dark${language === undefined ? '' : `&lang=${language}`}`,
  )
  await page.locator('body[data-node-ready="true"]').waitFor()
  return page
}
// CodeMirror's history keymap binds redo per platform: Mod-Shift-z on macOS,
// Ctrl-Shift-z on Linux and Ctrl-y on Windows, where Ctrl-Shift-z is unbound.
// Chrome runs on the test's own machine, so its platform is this one.
const REDO = process.platform === 'win32' ? 'Control+Y' : 'ControlOrMeta+Shift+Z'
async function type(page, text) {
  await page.locator('.cm-content[contenteditable="true"]').click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
}
describe('M110-U1 actual CodeMirror browser surface', () => {
  it('edits with the keyboard, keeps typing through rerenders, undoes, and saves exact UTF-8 with the original digest', async () => {
    const page = await pageFor()
    await type(page, 'first')
    await page.keyboard.type(' second π')
    await page.keyboard.press('ControlOrMeta+Z')
    await page.keyboard.press(REDO)
    await page.getByRole('button', { name: state.text.nodeWorkspace.save, exact: true }).click()
    await page.getByRole('status').filter({ hasText: state.text.nodeWorkspace.saved }).waitFor()
    const call = await page.evaluate(() =>
      globalThis.nodeHarness.calls.findLast((item) => item.method === 'node/files/write'),
    )
    expect(call.input.text).toBe('first second π')
    expect(call.input.expectedDigest).toBe(
      createHash('sha256').update('export const greeting = "hello"\n').digest('hex'),
    )
    expect(await page.evaluate(() => globalThis.nodeHarness.readFile())).toBe(call.input.text)
  })
  it('H10 retains the real editor draft and competing filesystem bytes after a stale save refuses', async () => {
    const page = await pageFor()
    await type(page, 'my draft')
    await page.evaluate(() => globalThis.nodeHarness.changeFile('competing bytes'))
    await page.getByRole('button', { name: state.text.nodeWorkspace.save, exact: true }).click()
    await page.getByRole('alert').waitFor()
    expect(await page.locator('.cm-content').textContent()).toBe('my draft')
    expect(await page.evaluate(() => globalThis.nodeHarness.readFile())).toBe('competing bytes')
  })
  it('renders actual saved/modified merge views as read-only', async () => {
    const page = await pageFor()
    await type(page, 'changed')
    await page.getByRole('button', { name: state.text.nodeWorkspace.diff, exact: true }).click()
    const views = page.locator('.cm-mergeView .cm-content')
    await views.first().waitFor()
    expect(await views.count()).toBe(2)
    expect(await views.first().getAttribute('contenteditable')).toBe('false')
    expect(await views.last().getAttribute('contenteditable')).toBe('false')
    expect(await views.last().textContent()).toBe('changed')
  })
  it('installs translated CodeMirror screen-reader announcements and control-character labels', async () => {
    const table = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
    const page = await pageFor('node-editor', 'de')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await expect
      .poll(() => page.locator('.cm-announced').textContent())
      .toContain(table.nodeWorkspace.selectionDeleted)
    await page.getByRole('button', { name: table.nodeWorkspace.discard, exact: true }).click()
    await page.evaluate(() => globalThis.nodeHarness.changeFile('a\0b'))
    await page.getByRole('button', { name: table.nodeLabels.editor, exact: true }).click()
    await expect
      .poll(() => page.locator('.cm-specialChar').getAttribute('aria-label'))
      .toContain(table.nodeWorkspace.controlCharacter)
  })
  it('opens from the keyboard tree and fits the real 320 px viewport', async () => {
    const page = await pageFor('node-files', undefined, 320)
    const tree = page.getByRole('tree')
    await tree.focus()
    await page.keyboard.press('ArrowRight')
    await page.locator('[id="node-file-src%2Fexample.ts"]').waitFor()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.locator('.cm-content').waitFor()
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
    ).toBe(true)
    // The narrow picture is a local look into the gitignored temp/ folder; the
    // committed record picture (docs/certification/m110-u1-shots/) is never
    // rewritten by a test run.
    const shots = path.resolve('temp', 'm110-u1-shots')
    mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: path.join(shots, 'editor-dark-320.png'), fullPage: true })
  })
})
