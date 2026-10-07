import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screenshotUrl } from '../../scripts/lib/harnessCapture.mjs'

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
