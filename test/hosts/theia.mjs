// The extension in Eclipse Theia (hosts.yml, PLAN.md M62): the sidebar
// opened with Ctrl+Esc (Theia 1.75 fires no `onView:` for a webview view,
// so the view alone does not start the extension; see
// docs/certification/m62.md) and the panel in an editor tab, each with a
// reply, a command allowed and one rejected against the fake CLI. Theia
// serves webviews from `<uuid>.webview.<host>`, so the URL must use
// `localhost`, which Chrome resolves with any subdomain.
//
// Theia writes no file for an extension's log channel: its lines reach the
// page over the WebSocket, so the check collects them there and writes them
// beside the screenshots (`theia-<name>-extension.log`), which hosts.yml
// keeps when the check fails. The extension redacts its log before writing
// it, and the fake CLI's credential file holds placeholders only.
//
//   node test/hosts/theia.mjs <url> <workspace folder> <screenshot folder>

import { writeFileSync } from 'node:fs'
import path from 'node:path'
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
// A line of a log output channel as Theia 1.75's LogOutputChannelImpl sends it.
const LOG_LINE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[(?:Trace|Debug|Info|Warning|Error)\] [^\n]*/gu

async function openTheia(name) {
  const opened = await openBrowser(shots)
  const lines = []
  opened.page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString('utf8')
      lines.push(...(text.match(LOG_LINE) ?? []))
    })
  })
  await opened.page.goto(`${url}/#${workspace}`)
  await opened.page.waitForSelector('#theia-app-shell', { timeout: SHELL_TIMEOUT_MS })
  await opened.page.waitForTimeout(SETTLE_MS)
  return {
    ...opened,
    shot: () => opened.shot(`theia-${name}`),
    keepLog: () => {
      writeFileSync(path.join(shots, `theia-${name}-extension.log`), `${lines.join('\n')}\n`)
    },
  }
}

const sidebar = await openTheia('sidebar')
await runCheck('theia: the sidebar, started with Ctrl+Esc', async () => {
  await sidebar.page.mouse.click(EDITOR_AREA.x, EDITOR_AREA.y)
  await sidebar.page.keyboard.press('Control+Escape')
  await panelConversation(await panelFrame(sidebar.page), 'theia-sidebar')
})
sidebar.keepLog()
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
tab.keepLog()
await tab.shot()
await tab.browser.close()
