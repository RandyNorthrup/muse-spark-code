// @vitest-environment jsdom
// The usage page's post boundary (D119): an unposted message reads failed
// in words, and the failure reaches the host's record with its cause. Both
// legs run over the real window.postMessage path: the page posts to a real
// host window (an iframe's), which records what actually arrives. The
// failure is a real platform refusal too: the first post goes out with an
// origin no platform accepts, so postMessage itself throws the failure the
// page handles, and the follow-up report goes out whole.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText, USAGE_TEXT } from '../../src/shared/l10n/usageTable'
import type { HostBridge } from '../../src/webview/hostBridge'
import { UsageApp } from '../../src/webview/usage/UsageApp'

afterEach(() => {
  cleanup()
  setUsageText(USAGE_EN)
})

/** A real host window beside the page: an iframe's, with a record of what arrives. */
function hostWindow(): { target: Window; received: unknown[]; close(): void } {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  if (frame.contentWindow === null) throw new Error('the host window is missing')
  const target: Window = frame.contentWindow
  const received: unknown[] = []
  const record = (event: MessageEvent): void => {
    received.push(event.data)
  }
  target.addEventListener('message', record)
  return {
    target,
    received,
    close: () => {
      target.removeEventListener('message', record)
      frame.remove()
    },
  }
}

const BROKEN_ORIGIN = 'not a usable origin'

function bridgeTo(host: { target: Window; failPosts: number }): HostBridge {
  return {
    post: (message) => {
      // The first `failPosts` posts go out with an origin the platform
      // rejects, so the failure below is postMessage's own refusal (a bridge
      // that is down), never a hand-thrown error.
      const origin = host.failPosts > 0 ? BROKEN_ORIGIN : '*'
      host.failPosts -= 1
      host.target.postMessage(message, origin)
    },
    savedState: () => undefined,
    saveState: () => undefined,
    messages: window,
  }
}

describe('usage post failures', () => {
  it('reads an unposted message as failed and reports it with its cause', async () => {
    setUsageText(USAGE_EN)
    const host = hostWindow()
    try {
      // The mount posts usage/ready whole; only the retry below goes out broken.
      const transport = { target: host.target, failPosts: 0 }
      const bridge = bridgeTo(transport)
      render(<UsageApp host={bridge} />)
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'usage/error', code: 'writeFailed' } }),
      )
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain(USAGE_TEXT.writeFailed)
      transport.failPosts = 1
      fireEvent.click(screen.getByRole('button', { name: USAGE_TEXT.retry }))
      await screen.findByText(USAGE_TEXT.readFailed)
      // The retry went out over the real path and never arrived, while the
      // follow-up report did: the host's record holds the failure's cause.
      await waitFor(() => {
        expect(host.received.map((message) => (message as { type: string }).type)).toContain(
          'webviewError',
        )
      })
      expect(host.received.map((message) => (message as { type: string }).type)).not.toContain(
        'usage/refresh',
      )
      const report = host.received.find(
        (message): message is { type: string; source: string; message: string } =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type: string }).type === 'webviewError',
      )
      expect(report?.source).toBe('hostMessage')
      expect(report?.message.length).toBeGreaterThan(0)
    } finally {
      host.close()
    }
  })
})
