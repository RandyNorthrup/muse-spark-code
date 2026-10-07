import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers'
import { URLSearchParams } from 'node:url'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screenshotUrl } from '../../scripts/lib/harnessCapture.mjs'
import { PAGE_TIMEOUT_MS } from '../../scripts/lib/harnessServer.mjs'

const { page, browser, launch } = vi.hoisted(() => {
  const page = {
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(),
    evaluate: vi.fn(),
    screenshot: vi.fn(),
  }
  const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() }
  return { page, browser, launch: vi.fn().mockResolvedValue(browser) }
})
vi.mock('playwright-core', () => ({ chromium: { launchPersistentContext: launch } }))

const options = { width: 690, height: 760, profileDir: 'profile' }

beforeEach(() => vi.clearAllMocks())

describe('harness screenshot readiness', () => {
  it('uses bounded scene readiness without the removed idle-delay global', async () => {
    const whenReady = vi.fn().mockResolvedValue()
    page.evaluate.mockImplementationOnce((source) =>
      runInNewContext(source, {
        themed: Promise.resolve(),
        params: new URLSearchParams('scenario=question'),
        whenReady,
        harnessErrors: [],
        setTimeout,
      }),
    )
    await expect(
      screenshotUrl('chrome', 'http://127.0.0.1/harness', 'shot.png', options),
    ).resolves.toBe('shot.png')
    expect(whenReady).toHaveBeenCalledExactlyOnceWith('question')
    expect(page.screenshot).toHaveBeenCalledOnce()
  })

  it('waits for scenario readiness before capturing and closes its browser', async () => {
    const { promise, resolve } = Promise.withResolvers()
    page.evaluate.mockReturnValueOnce(promise)
    const capture = screenshotUrl('chrome', 'http://127.0.0.1/harness', 'shot.png', options)
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalledOnce())
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('whenReady'))
    expect(page.screenshot).not.toHaveBeenCalled()
    resolve()
    await expect(capture).resolves.toBe('shot.png')
    expect(page.screenshot).toHaveBeenCalledWith({ path: 'shot.png', animations: 'disabled' })
    expect(browser.close).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledWith('profile', expect.objectContaining({ channel: 'chrome' }))
  })

  it('refuses an unready scene and closes its browser without a screenshot', async () => {
    page.evaluate.mockRejectedValueOnce(new Error('never rendered: button'))
    const executable = path.resolve('chrome')
    await expect(
      screenshotUrl(executable, 'http://127.0.0.1/harness', 'shot.png', options),
    ).rejects.toThrow('never rendered: button')
    expect(page.screenshot).not.toHaveBeenCalled()
    expect(browser.close).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledWith(
      'profile',
      expect.objectContaining({ executablePath: executable }),
    )
  })
})

describe('harness map controls', () => {
  it('opens the Agent map when Side chat appears before its pill', () => {
    const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
    const selectors = html
      .matchAll(/whenFound\('([^']*\.agents-pill[^']*)'/g)
      .map((match) => match[1])
      .toArray()
    expect(selectors.length).toBeGreaterThan(0)
    const dom = new JSDOM(
      '<button class="agents-pill">Side chat</button><button class="agents-pill" title="Agent map">2 tasks</button>',
    )
    const clicked = []
    try {
      for (const button of dom.window.document.querySelectorAll('button')) {
        button.addEventListener('click', () => {
          clicked.push(button.textContent)
        })
      }
      for (const selector of selectors) {
        const control = dom.window.document.querySelector(selector)
        expect(control).not.toBeNull()
        control?.click()
      }
      expect(clicked).toEqual(selectors.map(() => '2 tasks'))
    } finally {
      dom.window.close()
    }
  })
})

const runCase = (ready, waitFor) => {
  const source = readFileSync(new URL('../../scripts/legal-a11y.mjs', import.meta.url), 'utf8')
  const code = source.slice(source.indexOf('await tab.goto('), source.indexOf('const layout ='))
  const tab = {
    goto: vi.fn().mockResolvedValue(),
    evaluate: vi.fn().mockReturnValue(ready),
    getByRole: vi.fn().mockReturnValue({ waitFor }),
  }
  const promise = runInNewContext(`(async () => { ${code} })()`, {
    tab,
    LOOPBACK: '127.0.0.1',
    port: 1,
    HARNESS_PATH: 'test/harness/index.html',
    scenario: 'legal-preview',
    theme: 'light',
    language: undefined,
    langQuery: () => '',
    PAGE_TIMEOUT_MS,
  })
  return { tab, promise }
}

describe('legal keyboard scenario readiness', () => {
  it('holds native dialog input until scripted preview actions settle', async () => {
    const { promise: ready, resolve } = Promise.withResolvers()
    const waitFor = vi.fn().mockResolvedValue()
    const run = runCase(ready, waitFor)
    await vi.waitFor(() => expect(run.tab.evaluate).toHaveBeenCalledOnce())
    expect(run.tab.getByRole).not.toHaveBeenCalled()
    expect(waitFor).not.toHaveBeenCalled()
    resolve()
    await run.promise
    expect(waitFor).toHaveBeenCalledOnce()
  })

  it('refuses native input when scenario readiness fails', async () => {
    const { promise: ready, reject } = Promise.withResolvers()
    const waitFor = vi.fn().mockResolvedValue()
    const run = runCase(ready, waitFor)
    const failed = expect(run.promise).rejects.toThrow('preview never settled')
    reject(new Error('preview never settled'))
    await failed
    expect(run.tab.getByRole).not.toHaveBeenCalled()
    expect(waitFor).not.toHaveBeenCalled()
  })
})

describe('harness composer readiness', () => {
  it('waits past the transient sign-in gate until the composer can receive scene actions', () => {
    const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
    const start = html.indexOf('let hasPlayedScenario =')
    const source = html.slice(start, html.indexOf('// `?theme=', start))
    const dom = new JSDOM('<section class="gate">Signing in</section>')
    const played = vi.fn()
    let probe
    try {
      runInNewContext(source, {
        window: dom.window,
        harnessBundle: 'main',
        scenario: 'question',
        steps: { question: played },
        whenFound: (selector, run) => {
          probe = () => {
            if (dom.window.document.querySelector(selector) !== null) run()
          }
          probe()
        },
      })
      dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'))
      expect(played).not.toHaveBeenCalled()
      dom.window.document.body.insertAdjacentHTML(
        'beforeend',
        '<form class="composer"><textarea></textarea></form>',
      )
      expect(probe).toBeDefined()
      probe?.()
      expect(played).toHaveBeenCalledOnce()
    } finally {
      dom.window.close()
    }
  })
})
