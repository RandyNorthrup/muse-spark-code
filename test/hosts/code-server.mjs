// The extension in code-server (hosts.yml, PLAN.md M62): the Muse Spark
// view opened from the activity bar, then a reply, a command allowed and
// one rejected against the fake Muse Code CLI. code-server must already
// run the installed VSIX with `museSpark.museBinaryPath` set to the fake.
//
//   node test/hosts/code-server.mjs <url> <workspace folder> <screenshot folder>

import process from 'node:process'
import { openBrowser, panelConversation, panelFrame, runCheck } from './lib/browser.mjs'

const [url, workspace, shots] = process.argv.slice(2)
if (url === undefined || workspace === undefined || shots === undefined) {
  throw new Error('usage: code-server.mjs <url> <workspace folder> <screenshot folder>')
}

const WORKBENCH_TIMEOUT_MS = 90_000
const { browser, page, shot } = await openBrowser(shots)
await runCheck('code-server: a reply, a command allowed and one rejected', async () => {
  await page.goto(`${url}/?folder=${encodeURIComponent(workspace)}`)
  await page.waitForSelector('.monaco-workbench', { timeout: WORKBENCH_TIMEOUT_MS })
  await page.locator('.activitybar [aria-label^="Muse Spark"]').first().click()
  const frame = await panelFrame(page)
  await panelConversation(frame, 'code-server')
})
await shot('code-server')
await browser.close()
