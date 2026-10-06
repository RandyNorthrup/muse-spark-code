// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import type * as devicesViewModule from '../../src/webview/models/sections/agents/DevicesView'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EN } from '../../src/shared/l10n/en'
import { DevicesApp } from '../../src/webview/models/sections/agents/DevicesApp'
import { expireDeviceUiWait, UI_PAIR_ID, uiMessage } from './helpers/deviceUiFakes'

const seen = vi.hoisted(() => {
  const messages: unknown[] = []
  return { messages, crash: false }
})
vi.mock('../../src/webview/models/sections/agents/DevicesView', async (original) => {
  const actual = await original<typeof devicesViewModule>()
  return {
    ...actual,
    DevicesView: (props: ComponentProps<typeof actual.DevicesView>) => {
      seen.messages.push(props.message)
      if (seen.crash) throw new Error('private-render-sentinel')
      return <actual.DevicesView {...props} />
    },
  }
})

function deliver(input: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: input }))
  })
}
afterEach(() => {
  seen.crash = false
  vi.useRealTimers()
})
describe('M100 U explicit webview bridge', () => {
  it('ignores an older action snapshot even when its request id matches the current wait', async () => {
    const postMessage = vi.fn<(message: { readonly requestId: string }) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    deliver({
      ...uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }),
      revision: 3,
    })
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    deliver({
      ...uiMessage(),
      revision: 2,
      setup: { requestId: postMessage.mock.calls[0]?.[0].requestId },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
    expect(screen.getByText(EN.devices.uncertain, { exact: true })).toBeVisible()
  })
  it('keeps newer Uncertain/$3 when an older correlated Pair reply arrives', async () => {
    const postMessage = vi.fn<(message: { readonly requestId: string }) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const requestId = postMessage.mock.calls[0]?.[0].requestId
    deliver({
      ...uiMessage({
        status: 'uncertain',
        unresolvedAttempts: 1,
        retainedLiabilityUsd: 3,
        lastObservedAt: 2000,
      }),
      revision: 3,
    })
    deliver({ ...uiMessage({ lastObservedAt: 1000 }), revision: 2, setup: { requestId } })
    await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
    expect(screen.getByText(EN.devices.uncertain, { exact: true })).toBeVisible()
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
    expect(screen.getByText('1 unresolved attempt')).toBeVisible()
    // Equal revisions and reordered unsolicited snapshots cannot overwrite it either.
    const acceptedRenders = seen.messages.length
    deliver({ ...uiMessage(), revision: 3 })
    deliver(uiMessage())
    expect(seen.messages).toHaveLength(acceptedRenders)
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
  })
  it('only a newer observation containing the requested pair releases its UI wait', async () => {
    const postMessage = vi.fn()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    deliver(uiMessage())
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
    deliver({ ...uiMessage({ pairId: '7'.repeat(32) }), revision: 2 })
    expect(screen.getByRole('button', { name: EN.devices.pair })).toBeDisabled()
    deliver({
      ...uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }),
      revision: 3,
    })
    await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
  })
  it('rejects a malformed matching reply, shows Retry and recovers on a newer observation', async () => {
    const postMessage = vi.fn<(message: { readonly requestId: string }) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    deliver(uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }))
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
    const requestId = postMessage.mock.calls[0]?.[0].requestId
    deliver({ ...uiMessage(), revision: 2, setup: { requestId }, unknown: true })
    await screen.findByText(EN.devices.invalidMessage)
    const retry = screen.getByRole('button', { name: EN.devices.retry })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    deliver({
      ...uiMessage({ status: 'offline', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }),
      revision: 3,
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: EN.devices.pause })).toBeEnabled(),
    )
    expect(screen.queryByText(EN.devices.working)).toBeNull()
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
  })
  it('bounds a lost reply and removes the bridge wait before accepting Retry', async () => {
    vi.useFakeTimers()
    const postMessage = vi.fn<(message: { readonly requestId: string }) => void>()
    const { unmount } = render(<DevicesApp messages={window} postMessage={postMessage} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const oldId = postMessage.mock.calls[0]?.[0].requestId
    await act(expireDeviceUiWait)
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.retry }))
    deliver({ ...uiMessage(), revision: 2, setup: { requestId: oldId } })
    expect(screen.getByRole('button', { name: EN.devices.pair })).toBeDisabled()
    const newId = postMessage.mock.calls[1]?.[0].requestId
    await act(async () => {
      deliver({ ...uiMessage(), revision: 3, setup: { requestId: newId } })
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('contains render failures with a localized recovery message and Reload', () => {
    seen.crash = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<DevicesApp messages={window} postMessage={vi.fn()} />)
      expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.renderUnavailable)
      expect(screen.getByRole('button', { name: EN.crashReload })).toBeEnabled()
      expect(screen.queryByText(/private-render-sentinel/)).toBeNull()
    } finally {
      errors.mockRestore()
    }
  })
  it('subscribes without a ready/probe request and validates unsolicited observations', () => {
    seen.messages.length = 0
    const removed = vi.spyOn(window, 'removeEventListener')
    const postMessage = vi.fn()
    const { unmount } = render(<DevicesApp messages={window} postMessage={postMessage} />)
    expect(postMessage).not.toHaveBeenCalled()
    deliver({ ...uiMessage(), privatePath: 'fixture-sentinel' })
    expect(screen.queryByText('Mac receiver')).toBeNull()
    expect(seen.messages).toHaveLength(1)
    deliver(uiMessage())
    expect(screen.getByText('Mac receiver')).toBeVisible()
    unmount()
    expect(removed).toHaveBeenCalledWith('message', expect.any(Function))
    removed.mockRestore()
    deliver(uiMessage())
    expect(postMessage).not.toHaveBeenCalled()
  })
  it('ignores foreign correlated replies until the matching request returns', async () => {
    const postMessage = vi.fn<(message: { readonly requestId: string }) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const id = postMessage.mock.calls[0]?.[0].requestId
    deliver({ ...uiMessage(), setup: { requestId: UI_PAIR_ID } })
    expect(screen.queryByText('Mac receiver')).toBeNull()
    deliver({ ...uiMessage(), setup: { requestId: id } })
    await screen.findByText('Mac receiver')
    expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled()
  })
  it('reports a posting failure using fixed text and preserves the existing observation', async () => {
    render(
      <DevicesApp
        messages={window}
        postMessage={() => {
          throw new Error('private-host-sentinel')
        }}
      />,
    )
    deliver(uiMessage({ unresolvedAttempts: 1, retainedLiabilityUsd: 1 }))
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage),
    )
    expect(screen.getByText('Retained spending liability: $1.00')).toBeVisible()
    expect(screen.queryByText(/private-host-sentinel/)).toBeNull()
  })
  it('keeps the Devices import lazy and confines its mount to the explicit surface', () => {
    const entry = readFileSync(path.resolve('src/webview/main.tsx'), 'utf8')
    expect(entry).toMatch(/const DevicesApp = lazy\(async \(\) =>/)
    expect(entry).not.toMatch(/^import .*DevicesApp.*from/gm)
    expect(entry).toContain("await import('./models/sections/agents/DevicesApp')")
    expect(entry).toMatch(/catch \{\s+return \{ default: DevicesUnavailable \}/)
    expect(entry).toContain('{UI_TEXT.devices.bundleUnavailable}')
    expect(entry).toMatch(
      /if \(document\.body\.dataset\['surface'\] === 'devices'\) \{\s+mountDevices\(rootElement\)/,
    )
    const chat = entry.slice(entry.indexOf('function mountChat('))
    expect(chat).not.toMatch(/DevicesApp|deviceRequest|mountDevices/)
  })
})
