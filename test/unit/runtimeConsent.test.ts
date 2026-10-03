// The question before the browser check's runtime is downloaded and the
// Download command (M81 A1, design spec v4 §4.1): a native modal that names
// Google, the size, storage.googleapis.com and where it is kept; only
// Download downloads, and a late answer has no authority. The command uses
// the same runtime entry with native, cancellable progress.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import type { BrowserChecks } from '../../src/host/browser/browserChecks'
import { downloadBrowserRuntime } from '../../src/host/browser/runtimeCommand'
import { runtimeConsent } from '../../src/host/browser/runtimeConsent'
import { UI_TEXT } from '../../src/shared/constants'

const showInformation = vi.mocked(vscode.window.showInformationMessage)
const showWarning = vi.mocked(vscode.window.showWarningMessage)
const withProgress = vi.mocked(vscode.window.withProgress)

beforeEach(() => {
  showInformation.mockReset()
  showWarning.mockReset()
  withProgress.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the runtime download question (M81 A1)', () => {
  it('is a modal naming the version, the size, Google’s storage and where it is kept', async () => {
    showInformation.mockImplementation((_message, _options, ...items) =>
      Promise.resolve(items[0] as never),
    )
    const ask = runtimeConsent('/home/u/.vscode/globalStorage/x')
    await expect(ask('154.0.8037.92', 120_477_194, new AbortController().signal)).resolves.toBe(
      'download',
    )
    const [title, options, download, notNow] = showInformation.mock.calls[0] ?? []
    expect(title).toContain('120')
    expect(options).toMatchObject({ modal: true })
    const detail = (options as { detail: string }).detail
    expect(detail).toContain('Google')
    expect(detail).toContain('storage.googleapis.com')
    expect(detail).toContain('154.0.8037.92')
    expect(detail).toContain('/home/u/.vscode/globalStorage/x')
    expect(download).toEqual({ title: UI_TEXT.browserRuntimeDownload })
    expect(notNow).toEqual({ title: UI_TEXT.browserRuntimeNotNow, isCloseAffordance: true })
  })

  it('declines on Not now, on closing, and when the preparation stopped waiting, whatever comes later', async () => {
    const ask = runtimeConsent('/s')
    showInformation.mockImplementation((_message, _options, ..._items) =>
      Promise.resolve(_items[1] as never),
    )
    await expect(ask('v', 1, new AbortController().signal)).resolves.toBe('decline')
    showInformation.mockResolvedValue(undefined)
    await expect(ask('v', 1, new AbortController().signal)).resolves.toBe('decline')

    let answer: (item: unknown) => void = () => undefined
    showInformation.mockImplementation(
      (_message, _options, ...items) =>
        new Promise((resolve) => {
          answer = () => {
            resolve(items[0])
          }
        }),
    )
    const stop = new AbortController()
    const pending = ask('v', 1, stop.signal)
    stop.abort()
    await expect(pending).resolves.toBe('decline')
    answer(undefined)
    const stopped = new AbortController()
    stopped.abort()
    await expect(ask('v', 1, stopped.signal)).resolves.toBe('decline')
  })
})

/** The command's view of the browser checks: each preparation's signal, and `result`. */
function checks(result: unknown): BrowserChecks & { readonly calls: AbortSignal[] } {
  const calls: AbortSignal[] = []
  return {
    calls,
    prepareOnly: (signal: AbortSignal) => {
      calls.push(signal)
      return Promise.resolve(result)
    },
  } as unknown as BrowserChecks & { readonly calls: AbortSignal[] }
}

function notCancelled(): void {
  // Until the progress is cancelled, nothing is.
}

/** Native progress the user never cancels. */
function uncancelledProgress(): void {
  withProgress.mockImplementation(async (_options, task) => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    }
    return await task({ report: () => undefined }, token)
  })
}

describe('the Download command (M81 A1)', () => {
  it('prepares under native, cancellable progress and says when the browser is ready', async () => {
    uncancelledProgress()
    const prepared = checks({ ok: true, runtime: { version: '154.0.8037.92' } })
    await downloadBrowserRuntime(prepared, () => true)
    expect(withProgress.mock.calls[0]?.[0]).toMatchObject({
      cancellable: true,
      title: UI_TEXT.browserRuntimePreparing,
    })
    expect(showInformation).toHaveBeenCalledWith(expect.stringContaining('154.0.8037.92'))
  })

  it('cancels a preparation under way when the user cancels the progress, and says it stopped (P3-3)', async () => {
    const progress = { cancel: notCancelled }
    withProgress.mockImplementation(async (_options, task) => {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: () => void) => {
          progress.cancel = listener
          return { dispose: () => undefined }
        },
      }
      return await task({ report: () => undefined }, token as never)
    })
    // A download that runs until its signal aborts, and only then ends, cancelled.
    const signals: AbortSignal[] = []
    const downloading = {
      prepareOnly: async (signal: AbortSignal) => {
        signals.push(signal)
        return await new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve({ ok: false, reason: 'cancelled' })
          })
        })
      },
    } as unknown as BrowserChecks
    let isSettled = false
    const command = (async (): Promise<void> => {
      await downloadBrowserRuntime(downloading, () => true)
      isSettled = true
    })()
    await vi.waitFor(() => {
      expect(signals).toHaveLength(1)
    })
    // Still under way until the user cancels.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(isSettled).toBe(false)
    expect(signals[0]?.aborted).toBe(false)
    progress.cancel()
    expect(signals[0]?.aborted).toBe(true)
    await command
    expect(showWarning).toHaveBeenCalledWith(UI_TEXT.toolStopped)
  })

  it('words a refused preparation in the user’s language', async () => {
    uncancelledProgress()
    await downloadBrowserRuntime(checks({ ok: false, reason: 'runtimeIntegrity' }), () => true)
    expect(showWarning).toHaveBeenCalledWith(UI_TEXT.browserCheckRuntimeIntegrity)
  })

  it('refuses before any download where the check is not offered', async () => {
    const notOffered = checks({ ok: true })
    await downloadBrowserRuntime(notOffered, () => false)
    expect(notOffered.calls).toEqual([])
    expect(withProgress).not.toHaveBeenCalled()
    expect(showWarning).toHaveBeenCalledWith(UI_TEXT.browserCheckNotOffered)
  })
})
