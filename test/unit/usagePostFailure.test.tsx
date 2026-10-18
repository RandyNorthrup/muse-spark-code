// @vitest-environment jsdom
// The usage page's post boundary (D119): an unposted message reads failed
// in words, and the failure reaches the host's record with its cause.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText, USAGE_TEXT } from '../../src/shared/l10n/usageTable'
import type { HostBridge } from '../../src/webview/hostBridge'
import { UsageApp } from '../../src/webview/usage/UsageApp'

afterEach(() => {
  cleanup()
  setUsageText(USAGE_EN)
})

function stubHost(): { bridge: HostBridge; posted: unknown[]; failNextPost(): void } {
  const posted: unknown[] = []
  let shouldFailPost = false
  const bridge: HostBridge = {
    post: (message) => {
      posted.push(message)
      if (!shouldFailPost) return
      shouldFailPost = false
      throw new Error('bridge down')
    },
    savedState: () => undefined,
    saveState: () => undefined,
    messages: window,
  }
  return {
    bridge,
    posted,
    failNextPost: () => {
      shouldFailPost = true
    },
  }
}

describe('usage post failures', () => {
  it('reads an unposted message as failed and reports it with its cause', async () => {
    setUsageText(USAGE_EN)
    const { bridge, posted, failNextPost } = stubHost()
    render(<UsageApp host={bridge} />)
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'usage/error', code: 'writeFailed' } }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(USAGE_TEXT.writeFailed)
    failNextPost()
    fireEvent.click(screen.getByRole('button', { name: USAGE_TEXT.retry }))
    await screen.findByText(USAGE_TEXT.readFailed)
    expect(posted.map((message) => (message as { type: string }).type)).toContain('webviewError')
    const report = posted.find(
      (message): message is { type: string; source: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type: string }).type === 'webviewError',
    )
    expect(report?.source).toBe('hostMessage')
  })
})
