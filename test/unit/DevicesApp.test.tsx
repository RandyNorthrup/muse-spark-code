// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import type * as devicesViewModule from '../../src/webview/models/sections/agents/DevicesView'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EN } from '../../src/shared/l10n/en'
import type { DeviceWebviewMessage, DeviceWebviewRequest } from '../../src/shared/devicesPanel'
import {
  DevicesApp,
  DevicesSurface,
  type DevicesWebviewApi,
} from '../../src/webview/models/sections/agents/DevicesApp'
import {
  expectRejectedDeviceInvitation,
  uiUncertainMessage,
  expireDeviceUiWait,
  UI_PAIR_ID,
  uiMessage,
  uiInvitation,
} from './helpers/deviceUiFakes'

const seen = vi.hoisted(() => {
  const messages: unknown[] = []
  const props: ComponentProps<typeof devicesViewModule.DevicesView>[] = []
  return { messages, props, crash: false }
})
vi.mock('../../src/webview/models/sections/agents/DevicesView', async (original) => {
  const actual = await original<typeof devicesViewModule>()
  return {
    ...actual,
    DevicesView: (props: ComponentProps<typeof actual.DevicesView>) => {
      seen.messages.push(props.message)
      seen.props.push(props)
      if (seen.crash) throw new Error('private-render-sentinel')
      return <actual.DevicesView {...props} />
    },
  }
})

function requestAt(
  postMessage: ReturnType<typeof vi.fn<(message: DeviceWebviewMessage) => void>>,
  index = 0,
): DeviceWebviewRequest {
  const message = postMessage.mock.calls.filter(([message]) => message.type === 'deviceRequest')[
    index
  ]?.[0]
  if (message?.type !== 'deviceRequest') throw new Error('Missing action request')
  return message
}

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
  it('uses the text-only pairing UI without a QR renderer when no encoder is configured', () => {
    render(<DevicesApp messages={window} postMessage={vi.fn()} />)
    expect(seen.props.at(-1)?.renderQr).toBeUndefined()
  })

  it('rejects pairing data when a newer parent observation precedes the child commit', async () => {
    const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    fireEvent.change(screen.getByLabelText(EN.devices.scan), {
      target: { value: JSON.stringify(uiInvitation) },
    })
    fireEvent.click(screen.getByRole('button', { name: EN.devices.importInvitation }))
    const request = requestAt(postMessage)
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            ...uiMessage(),
            revision: 2,
            setup: {
              viewId: request.viewId,
              requestId: request.requestId,
              invitation: uiInvitation,
            },
          },
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            ...uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }),
            revision: 3,
          },
        }),
      )
      await Promise.resolve()
    })
    expect(screen.queryByRole('button', { name: EN.devices.confirmFingerprint })).toBeNull()
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
  })

  it.each(['unregistered', 'aborted', 'wrong address', 'wrong signal'])(
    'rejects parent publication from a %s view source',
    async (kind) => {
      const postMessage = vi.fn()
      render(<DevicesApp messages={window} postMessage={postMessage} />)
      deliver(uiUncertainMessage())
      const props = seen.props.at(-1)!
      const controller = new AbortController()
      const request: DeviceWebviewRequest = {
        type: 'deviceRequest',
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        revision: 3,
        action: { kind: 'pair' },
      }
      const observeRequest = async () => {
        try {
          await props.port.request(request, controller.signal)
        } catch {
          return
        }
      }
      const pending = kind === 'unregistered' ? undefined : observeRequest()
      if (kind === 'aborted') controller.abort()
      act(() => {
        props.onState(
          {
            ...uiMessage(),
            revision: 4,
            setup: {
              viewId: kind === 'wrong address' ? 'a'.repeat(32) : UI_PAIR_ID,
              requestId: UI_PAIR_ID,
              invitation: uiInvitation,
            },
          },
          {
            viewId: UI_PAIR_ID,
            signal: kind === 'wrong signal' ? new AbortController().signal : controller.signal,
          },
        )
      })
      expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
      expect(screen.getByText(EN.devices.uncertain, { exact: true })).toBeVisible()
      controller.abort()
      await pending
    },
  )
  it.each([false, true])(
    'ignores a foreign view reply (malformed=%s) without releasing the live request',
    async (malformed) => {
      const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
      render(<DevicesApp messages={window} postMessage={postMessage} />)
      fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
      const request = requestAt(postMessage)
      deliver({
        ...uiMessage(),
        revision: 2,
        setup: { viewId: UI_PAIR_ID, requestId: request.requestId, invitation: uiInvitation },
        ...(malformed && { unknown: true }),
      })
      expect(screen.getByRole('button', { name: EN.devices.pair })).toBeDisabled()
      expect(screen.queryByLabelText(EN.devices.copyInvitation)).toBeNull()
      deliver({
        ...uiMessage(),
        revision: 3,
        setup: { viewId: request.viewId, requestId: request.requestId, invitation: uiInvitation },
      })
      await screen.findByLabelText(EN.devices.copyInvitation)
      expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled()
    },
  )

  it.each(['pair', 'importInvitation'] as const)(
    'rejects a correlated stale %s invitation at the dedicated surface',
    async (kind) => {
      const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
      render(<DevicesApp messages={window} postMessage={postMessage} />)
      deliver(uiUncertainMessage())
      if (kind === 'pair') fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
      else {
        fireEvent.change(screen.getByLabelText(EN.devices.scan), {
          target: { value: JSON.stringify(uiInvitation) },
        })
        fireEvent.click(screen.getByRole('button', { name: EN.devices.importInvitation }))
      }
      deliver({
        ...uiMessage(),
        revision: 2,
        setup: {
          viewId: requestAt(postMessage).viewId,
          requestId: requestAt(postMessage).requestId,
          invitation: uiInvitation,
        },
      })
      await expectRejectedDeviceInvitation()
      expect(postMessage).toHaveBeenCalledTimes(2)
    },
  )

  it('ignores an older action snapshot even when its request id matches the current wait', async () => {
    const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    deliver(uiUncertainMessage())
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    deliver({
      ...uiMessage(),
      revision: 2,
      setup: {
        viewId: requestAt(postMessage).viewId,
        requestId: requestAt(postMessage).requestId,
      },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
    expect(screen.getByText(EN.devices.uncertain, { exact: true })).toBeVisible()
  })
  it('keeps newer Uncertain/$3 when an older correlated Pair reply arrives', async () => {
    const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const { requestId, viewId } = requestAt(postMessage)
    deliver({
      ...uiMessage({
        status: 'uncertain',
        unresolvedAttempts: 1,
        retainedLiabilityUsd: 3,
        lastObservedAt: 2000,
      }),
      revision: 3,
    })
    deliver({ ...uiMessage({ lastObservedAt: 1000 }), revision: 2, setup: { viewId, requestId } })
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
    deliver(uiUncertainMessage())
    await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
  })
  it('rejects a malformed matching reply, shows Retry and recovers on a newer observation', async () => {
    const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    deliver(uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }))
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
    const { requestId, viewId } = requestAt(postMessage)
    deliver({ ...uiMessage(), revision: 2, setup: { viewId, requestId }, unknown: true })
    await screen.findByText(EN.devices.invalidMessage)
    const retry = screen.getByRole('button', { name: EN.devices.retry })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
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
    const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
    const { unmount } = render(<DevicesApp messages={window} postMessage={postMessage} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const { requestId: oldId, viewId } = requestAt(postMessage)
    await act(expireDeviceUiWait)
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.retry }))
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    deliver({ ...uiMessage(), revision: 2, setup: { viewId, requestId: oldId } })
    expect(screen.getByRole('button', { name: EN.devices.pair })).toBeDisabled()
    const newId = requestAt(postMessage, 1).requestId
    await act(async () => {
      deliver({ ...uiMessage(), revision: 3, setup: { viewId, requestId: newId } })
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled()
    unmount()
    // jsdom queues focus/selection work at zero delay; UI deadlines must be gone.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
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
  it('subscribes with readiness only and validates unsolicited observations', () => {
    seen.messages.length = 0
    const removed = vi.spyOn(window, 'removeEventListener')
    const postMessage = vi.fn()
    const { unmount } = render(<DevicesApp messages={window} postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'devicesReady' })
    deliver({ ...uiMessage(), privatePath: 'fixture-sentinel' })
    expect(screen.queryByText('Mac receiver')).toBeNull()
    expect(seen.messages).toHaveLength(1)
    deliver(uiMessage())
    expect(screen.getByText('Mac receiver')).toBeVisible()
    unmount()
    expect(removed).toHaveBeenCalledWith('message', expect.any(Function))
    removed.mockRestore()
    deliver(uiMessage())
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'devicesReady' })
  })
  it('ignores foreign correlated replies until the matching request returns', async () => {
    const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const { requestId: id, viewId } = requestAt(postMessage)
    deliver({ ...uiMessage(), setup: { viewId, requestId: UI_PAIR_ID } })
    expect(screen.queryByText('Mac receiver')).toBeNull()
    deliver({ ...uiMessage(), setup: { viewId, requestId: id } })
    await screen.findByText('Mac receiver')
    expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled()
  })
  it('reports a posting failure using fixed text and preserves the existing observation', async () => {
    render(
      <DevicesApp
        messages={window}
        postMessage={(message) => {
          if (message.type === 'deviceRequest') throw new Error('private-host-sentinel')
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
    expect(entry).toMatch(/const DevicesSurface = lazy\(async \(\) =>/)
    expect(entry).not.toMatch(/^import .*DevicesApp.*from/gm)
    expect(entry).toContain("await import('./models/sections/agents/DevicesApp')")
    expect(entry).toMatch(/catch \{\s+return \{ default: DevicesUnavailable \}/)
    expect(entry).toContain('{UI_TEXT.surfaceLoadFailed}')
    expect(entry).toContain('{UI_TEXT.surfaceLoadRetry}')
    expect(entry).not.toMatch(/UI_TEXT\.devices\./)
    // The document's state, draft and QR chunks are in the lazy chunk, never startup.
    expect(entry).not.toMatch(/zod|savedDevicesState|devicesDraft|qrGeneratorEncoder|QrFigure/)
    expect(entry).toMatch(
      /if \(document\.body\.dataset\['surface'\] === 'devices'\) \{\s+mountDevices\(rootElement\)/,
    )
    const chat = entry.slice(entry.indexOf('function mountChat('))
    expect(chat).not.toMatch(/DevicesApp|deviceRequest|mountDevices/)
  })
})

// The Devices document moved out of the webview entry into the lazy chunk
// (M100 join, startup bytes): the same draft, QR and single-callback contract.
function surfaceApi(state: unknown) {
  const postMessage = vi.fn<(message: DeviceWebviewMessage) => void>()
  const setState = vi.fn<(state: { readonly devicesDraft: string }) => unknown>()
  const api: DevicesWebviewApi = { postMessage, getState: () => state, setState }
  return { api, postMessage, setState }
}
function encoder() {
  return { size: 1, modules: [[true]] }
}
function Figure({ text }: { readonly text: string }) {
  return <p>figure:{text}</p>
}
describe('M100 Devices surface in the lazy chunk', () => {
  it('restores the saved draft, saves edits, and hands over the loaded QR chunks once', async () => {
    const { api, postMessage, setState } = surfaceApi({ devicesDraft: 'saved peer text' })
    const loadQr = vi.fn(() => Promise.resolve({ encoder, figure: Figure }))
    render(<DevicesSurface api={api} messages={window} loadQr={loadQr} />)
    expect(screen.getByLabelText(EN.devices.scan)).toHaveValue('saved peer text')
    await waitFor(() => {
      expect(seen.props.at(-1)?.renderQr).toBeDefined()
    })
    render(<>{seen.props.at(-1)?.renderQr?.('public')}</>)
    expect(screen.getByText('figure:public')).toBeVisible()
    fireEvent.change(screen.getByLabelText(EN.devices.scan), { target: { value: 'edited' } })
    expect(setState).toHaveBeenLastCalledWith({ devicesDraft: 'edited' })
    expect(loadQr).toHaveBeenCalledOnce()
    // One callback for the document's lifetime: adding the QR never re-announces readiness.
    expect(
      postMessage.mock.calls.filter(([message]) => message.type === 'devicesReady'),
    ).toHaveLength(1)
  })

  it('drops an invalid saved state and reports a failed QR chunk at the QR spot', async () => {
    const { api } = surfaceApi({ devicesDraft: 'x'.repeat(1_000_000) })
    render(<DevicesSurface api={api} loadQr={() => Promise.reject(new Error('chunk refused'))} />)
    expect(screen.getByLabelText(EN.devices.scan)).toHaveValue('')
    await waitFor(() => {
      expect(seen.props.at(-1)?.renderQr).toBeDefined()
    })
    render(<>{seen.props.at(-1)?.renderQr?.('public')}</>)
    expect(screen.getByText(EN.devices.qrReload)).toBeVisible()
  })
})
