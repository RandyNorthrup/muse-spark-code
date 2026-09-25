import { describe, expect, it } from 'vitest'
import { webviewErrorLog, type WebviewErrorMessage } from '../../src/host/views/webviewErrors'
import {
  WEBVIEW_ERROR_LOG_LIMIT,
  WEBVIEW_ERROR_MESSAGE_MAX_CHARS,
  WEBVIEW_ERROR_STACK_MAX_CHARS,
  WEBVIEW_ERROR_WINDOW_MS,
} from '../../src/shared/constants'
import { parseWebviewToHostMessage } from '../../src/shared/protocol'
import { webviewErrorReport } from '../../src/webview/errorReport'
import { FakeLogOutputChannel } from './helpers/fakes'

const report: WebviewErrorMessage = {
  type: 'webviewError',
  source: 'render',
  message: 'boom',
  stack: 'Error: boom\n    at Row',
}

/** An error with a stack longer than the protocol takes. */
class LongStackError extends Error {
  public override readonly stack = 'y'.repeat(WEBVIEW_ERROR_STACK_MAX_CHARS + 50)
}

// M39: what throws in the webview reaches the host's log.
describe('webviewErrorReport', () => {
  it('sends the error text and stack, cut to the protocol limits, which the host accepts', () => {
    const error = new LongStackError('x'.repeat(WEBVIEW_ERROR_MESSAGE_MAX_CHARS + 50))
    const message = webviewErrorReport('window', error)
    expect(message).toEqual({
      type: 'webviewError',
      source: 'window',
      message: 'x'.repeat(WEBVIEW_ERROR_MESSAGE_MAX_CHARS),
      stack: 'y'.repeat(WEBVIEW_ERROR_STACK_MAX_CHARS),
    })
    expect(parseWebviewToHostMessage(message).ok).toBe(true)
    // One past the limit is refused at the boundary.
    const tooLong = {
      type: 'webviewError',
      source: 'window',
      message: 'x'.repeat(WEBVIEW_ERROR_MESSAGE_MAX_CHARS + 1),
    }
    expect(parseWebviewToHostMessage(tooLong).ok).toBe(false)
  })

  it('describes a thrown value that is not an Error by its string form, with no stack', () => {
    expect(webviewErrorReport('promise', 42)).toEqual({
      type: 'webviewError',
      source: 'promise',
      message: '42',
    })
  })
})

describe('webviewErrorLog', () => {
  it('logs each report with its source and stack', () => {
    const channel = new FakeLogOutputChannel()
    webviewErrorLog(channel, () => 0)(report)
    expect(channel.error).toHaveBeenCalledWith(
      'Webview error (render): boom\nError: boom\n    at Row',
    )
    const noStack = new FakeLogOutputChannel()
    webviewErrorLog(noStack, () => 0)({ type: 'webviewError', source: 'hostMessage', message: 'm' })
    expect(noStack.error).toHaveBeenCalledWith('Webview error (hostMessage): m')
  })

  it('logs at most the limit a minute, says once that it stopped, and starts again after', () => {
    const channel = new FakeLogOutputChannel()
    let now = 0
    const log = webviewErrorLog(channel, () => now)
    for (let index = 0; index < WEBVIEW_ERROR_LOG_LIMIT + 5; index += 1) {
      log(report)
    }
    expect(channel.error).toHaveBeenCalledTimes(WEBVIEW_ERROR_LOG_LIMIT)
    expect(channel.warn).toHaveBeenCalledOnce()
    expect(channel.warn).toHaveBeenCalledWith(
      `More webview errors in this minute are not logged (${String(WEBVIEW_ERROR_LOG_LIMIT)} were)`,
    )
    now = WEBVIEW_ERROR_WINDOW_MS
    log(report)
    expect(channel.error).toHaveBeenCalledTimes(WEBVIEW_ERROR_LOG_LIMIT + 1)
    // A second flood says so again.
    for (let index = 0; index < WEBVIEW_ERROR_LOG_LIMIT; index += 1) {
      log(report)
    }
    expect(channel.warn).toHaveBeenCalledTimes(2)
  })
})
