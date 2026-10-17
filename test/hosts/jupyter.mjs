// The ACP agent in JupyterLab through Jupyter AI (hosts.yml, PLAN.md M63):
// a new chat with the Muse Spark persona, then a reply, a command allowed
// and one rejected against the fake Muse Code CLI.
//
//   node test/hosts/jupyter.mjs <url> <screenshot folder>

import process from 'node:process'
import { openBrowser, runCheck, waitForText } from './lib/browser.mjs'

const [url, shots] = process.argv.slice(2)
if (url === undefined || shots === undefined) {
  throw new Error('usage: jupyter.mjs <url> <screenshot folder>')
}

const LAB_TIMEOUT_MS = 90_000
const { browser, page, shot } = await openBrowser(shots)
await runCheck('jupyterlab: a reply, a command allowed and one rejected', async () => {
  await page.goto(`${url}/lab?reset`)
  await page.waitForSelector('#jp-main-dock-panel', { timeout: LAB_TIMEOUT_MS })
  await page.locator('.jp-LauncherCard', { hasText: 'Chat' }).first().click()
  const chat = page.locator('.jp-MainAreaWidget:visible').last()
  const composer = page.locator('textarea:visible').last()
  await waitForText(page.mainFrame(), /Muse Spark 1\.3/)
  const send = async (text) => {
    await composer.fill(text)
    await composer.press('Enter')
  }
  await send('hello from jupyter')
  await waitForText(page.mainFrame(), /echo:[\s\S]*hello from jupyter/)
  await send('tool: echo allowed-in-jupyter')
  await chat
    .getByRole('button', { name: /^Allow once/ })
    .first()
    .click()
  await waitForText(page.mainFrame(), /ran: echo allowed-in-jupyter/)
  await send('tool: echo rejected-in-jupyter')
  await chat
    .getByRole('button', { name: /^Reject/ })
    .last()
    .click()
  await waitForText(page.mainFrame(), /skipped: echo rejected-in-jupyter/)
})
await shot('jupyterlab')
await browser.close()
