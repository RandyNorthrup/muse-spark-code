// M104 lane C: the portable page in real Chromium over the real MHP
// routes. The packed agent boots, real Chrome loads the launch URL,
// exchanges the code, installs the session page, and boots chat over
// /panel/*; the suite proves the session's own state reached the DOM.
// The isolated run has no backend, so the page settles on the sign-in
// gate: that settled unsigned state is itself the proof the round-trips
// work. No provider, key or network is touched.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'
import { removeFolder } from './helpers/temporaryFolders'

const runtime = {}

/** Boots the packed agent until it prints its launch URL, or fails loudly. */
async function bootPacked(folder, workspace) {
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), 'dist', 'acp.js'), 'panel', '--companion', '--workspace', workspace],
    {
      cwd: workspace,
      env: {
        ...isolatedRuntimeEnvironment(path.join(folder, 'home'), folder),
        PATH: path.dirname(process.execPath),
        LC_ALL: 'en_US.UTF-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString('utf8')
  })
  const exited = new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(code)
    })
    child.on('error', () => {
      resolve(null)
    })
  })
  const started = Date.now()
  for (;;) {
    const end = output.indexOf('\n')
    if (end !== -1) return { child, url: output.slice(0, end) }
    const code = await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10))])
    if (typeof code === 'number' || code === null)
      throw new Error(`the packed panel exited ${String(code)} before it announced`)
    if (Date.now() - started > 30_000) throw new Error('the packed panel never announced its URL')
  }
}

// The packed agent boots its session before it announces.
beforeAll(async () => {
  const chrome = findChrome()
  if (!chrome) throw new Error('Chrome is required for companion verification')
  runtime.chrome = chrome
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'panel-companion-browser-')))
  runtime.folder = folder
  const workspace = path.join(folder, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const booted = await bootPacked(folder, workspace)
  runtime.child = booted.child
  runtime.url = booted.url
  // Genuinely long: the packed agent boots its session before announcing.
}, 30_000)

afterAll(async () => {
  if (runtime.page !== undefined) await runtime.page.close()
  if (runtime.browser !== undefined) await runtime.browser.close()
  const child = runtime.child
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      let isFinished = false
      const done = () => {
        if (isFinished) return
        isFinished = true
        resolve()
      }
      setTimeout(done, 10_000)
      child.on('exit', done)
      child.on('error', done)
    })
  }
  if (runtime.folder !== undefined) await removeFolder(runtime.folder)
})

describe('portable page in real Chromium', () => {
  // Real Chrome installs the exchanged page: launch, fetch, mount.
  it('installs the session page over the launch URL', async () => {
    runtime.browser = await chromium.launch({ executablePath: path.resolve(runtime.chrome) })
    const page = await runtime.browser.newPage()
    runtime.page = page
    await page.goto(runtime.url)
    await page.waitForFunction(
      () => globalThis.document.documentElement.dataset.launch === 'ready',
      null,
      { timeout: 30_000 },
    )
    expect(await page.locator('#launch-error').isHidden()).toBe(true)
    expect(await page.locator('#muse-panel').count()).toBe(1)
    // Genuinely long: real Chrome installs the exchanged page over loopback.
  }, 60_000)

  // The bridge boots chat over the routes: the session's own title, the
  // backend's unsigned state, and the settled sign-in gate all applied
  // to the DOM. The page has no other data source, so each proves its
  // round-trip.
  it('boots chat over the MHP routes', async () => {
    const page = runtime.page
    await page.getByRole('heading', { name: 'Untitled' }).waitFor({ timeout: 30_000 })
    await page.getByText('Not signed in').first().waitFor({ timeout: 30_000 })
    await page.getByText('Sign In to Muse Spark').waitFor({ timeout: 30_000 })
    expect(await page.getByRole('heading', { name: 'Untitled' }).isVisible()).toBe(true)
    // Genuinely long: real Chrome boots the packed page over loopback.
  }, 60_000)
})
