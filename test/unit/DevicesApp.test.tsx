// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import type * as devicesViewModule from '../../src/webview/models/sections/agents/DevicesView'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EN } from '../../src/shared/l10n/en'
import { DevicesApp } from '../../src/webview/models/sections/agents/DevicesApp'
import { UI_PAIR_ID, uiMessage } from './helpers/deviceUiFakes'

const seen = vi.hoisted(() => {
  const messages: unknown[] = []
  return { messages }
})
vi.mock('../../src/webview/models/sections/agents/DevicesView', async (original) => {
  const actual = await original<typeof devicesViewModule>()
  return {
    ...actual,
    DevicesView: (props: ComponentProps<typeof actual.DevicesView>) => {
      seen.messages.push(props.message)
      return <actual.DevicesView {...props} />
    },
  }
})

function deliver(input: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: input }))
  })
}
describe('M100 U explicit webview bridge', () => {
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
