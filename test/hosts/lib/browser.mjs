// Shared by the host checks that drive a browser (hosts.yml): Chrome through
// playwright-core, and the Muse Spark panel's own conversation, the same in
// every host that runs the extension's webview (code-server, Theia). The
// fake Muse Code CLI answers `tool: <command>` with a gated command and
// anything else with "echo: <text>" (test/e2e/fake-muse/serve.mjs).

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'

const POLL_MS = 300
const TEXT_TIMEOUT_MS = 30_000
const FRAME_TIMEOUT_MS = 60_000
const VIEWPORT = { width: 1400, height: 900 }

/** Chrome as an absolute path (Playwright takes no bare name). */
function chromePath() {
  const found = findChrome()
  if (found === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  if (path.isAbsolute(found)) {
    return found
  }
  try {
    return execFileSync('which', [found], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error(`${found} is not on PATH; set CHROME_PATH to the browser executable`)
  }
}

/** A page in a fresh browser; `shots` names the folder for screenshots. */
export async function openBrowser(shots) {
  mkdirSync(shots, { recursive: true })
  // Root cannot use Chrome's sandbox (the development container); CI runs unprivileged.
  const isRoot = process.getuid?.() === 0
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: isRoot ? ['--no-sandbox'] : [],
  })
  const page = await browser.newPage({ viewport: VIEWPORT })
  return {
    browser,
    page,
    shot: (name) => page.screenshot({ path: path.join(shots, `${name}.png`) }),
  }
}

async function bodyText(frame) {
  return (await frame.locator('body').textContent()) ?? ''
}

/** Waits until the frame's text matches, and returns it. */
export async function waitForText(frame, pattern, timeoutMs = TEXT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    text = await bodyText(frame)
    if (pattern.test(text)) {
      return text
    }
    await sleep(POLL_MS)
  }
  throw new Error(`timed out waiting for ${String(pattern)}; the text ended:\n${text.slice(-800)}`)
}

/** The webview frame whose Muse Spark composer is visible. */
export async function panelFrame(page, timeoutMs = FRAME_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.locator('textarea.composer-input').first().isVisible()) {
          return frame
        }
      } catch {
        // A frame that navigates away while it is asked is skipped.
      }
    }
    await page.waitForTimeout(POLL_MS)
  }
  throw new Error('no visible Muse Spark composer in any frame')
}

/**
 * A reply, a command allowed and one rejected, in the panel: what each
 * host must show, as in docs/certification/m62.md. `tag` keeps runs apart.
 */
export async function panelConversation(frame, tag) {
  const composer = frame.locator('textarea.composer-input').first()
  const send = async (text) => {
    await composer.fill(text)
    await composer.press('Enter')
  }
  await send(`hello from ${tag}`)
  await waitForText(frame, new RegExp(`echo: hello from ${tag}`))
  await send(`tool: echo allowed-in-${tag}`)
  await waitForText(frame, /Allow once/)
  await frame
    .getByRole('button', { name: /^Allow once/ })
    .first()
    .click()
  await waitForText(frame, new RegExp(`ran: echo allowed-in-${tag}`))
  await send(`tool: echo rejected-in-${tag}`)
  await waitForText(frame, new RegExp(String.raw`rejected-in-${tag}[\s\S]*Reject`))
  await frame
    .getByRole('button', { name: /^Reject/ })
    .last()
    .click()
  await waitForText(frame, new RegExp(`skipped: echo rejected-in-${tag}`))
}

/** Runs a check, prints its outcome and sets the exit code. */
export async function runCheck(name, check) {
  try {
    await check()
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
