// The extension in Eclipse Theia (hosts.yml, PLAN.md M62): the sidebar
// opened with Ctrl+Esc (Theia 1.75 fires no `onView:` for a webview view,
// so the view alone does not start the extension; see
// docs/certification/m62.md) and the panel in an editor tab, each with a
// reply, a command allowed and one rejected against the fake CLI. Theia
// serves webviews from `<uuid>.webview.<host>`, so the URL must use
// `localhost`, which Chrome resolves with any subdomain.
//
//   node test/hosts/theia.mjs <url> <workspace folder> <screenshot folder>

import process from 'node:process'
import { openBrowser, panelConversation, panelFrame, runCheck } from './lib/browser.mjs'

const [url, workspace, shots] = process.argv.slice(2)
if (url === undefined || workspace === undefined || shots === undefined) {
  throw new Error('usage: theia.mjs <url> <workspace folder> <screenshot folder>')
}

const SHELL_TIMEOUT_MS = 90_000
const SETTLE_MS = 5000
// The middle of the editor area at the check's 1400 × 900 viewport.
const EDITOR_AREA = { x: 700, y: 450 }

async function openTheia(name) {
  const opened = await openBrowser(shots)
  await opened.page.goto(`${url}/#${workspace}`)
  await opened.page.waitForSelector('#theia-app-shell', { timeout: SHELL_TIMEOUT_MS })
  await opened.page.waitForTimeout(SETTLE_MS)
  return { ...opened, shot: () => opened.shot(`theia-${name}`) }
}

const sidebar = await openTheia('sidebar')
await runCheck('theia: the sidebar, started with Ctrl+Esc', async () => {
  await sidebar.page.mouse.click(EDITOR_AREA.x, EDITOR_AREA.y)
  await sidebar.page.keyboard.press('Control+Escape')
  await panelConversation(await panelFrame(sidebar.page), 'theia-sidebar')
})
await sidebar.shot()
await sidebar.browser.close()

const tab = await openTheia('tab')
await runCheck('theia: the panel in an editor tab', async () => {
  await tab.page.mouse.click(EDITOR_AREA.x, EDITOR_AREA.y)
  await tab.page.keyboard.press('F1')
  const palette = tab.page.locator('.quick-input-widget input').first()
  await palette.waitFor()
  await palette.fill('>Muse Spark: Open in New Tab')
  await tab.page
    .locator('.quick-input-list .monaco-list-row', { hasText: 'Open in New Tab' })
    .first()
    .click()
  await panelConversation(await panelFrame(tab.page), 'theia-tab')
})
await tab.shot()
await tab.browser.close()
