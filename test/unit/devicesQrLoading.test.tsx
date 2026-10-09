// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { DevicesApp } from '../../src/webview/models/sections/agents/DevicesApp'
import QrFigure from '../../src/webview/models/sections/devices/qr/QrFigure'
import type { DeviceWebviewMessage } from '../../src/shared/devicesPanel'
import { uiInvitation, uiMessage } from './helpers/deviceUiFakes'

const encode = () => ({
  size: 21,
  modules: Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => true)),
})

function reply(request: DeviceWebviewMessage) {
  if (request.type === 'devicesReady') return
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        ...uiMessage(),
        revision: request.revision + 1,
        setup: { viewId: request.viewId, requestId: request.requestId, invitation: uiInvitation },
      },
    }),
  )
}

async function pair() {
  fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
  await screen.findByLabelText(EN.devices.copyInvitation)
  await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
}

describe('RVM100P2U QR lazy lifecycle', () => {
  it('does not request the QR chunk without a configured encoder', async () => {
    const loadQr = vi.fn(() => Promise.resolve({ default: QrFigure }))
    render(<DevicesApp messages={window} postMessage={reply} loadQr={loadQr} />)
    await pair()
    expect(loadQr).not.toHaveBeenCalled()
    expect(
      JSON.parse(screen.getByLabelText<HTMLTextAreaElement>(EN.devices.copyInvitation).value),
    ).toEqual(uiInvitation)
  })

  it('announces loading, preserves text on failure and recovers by reloading the document', async () => {
    const pending = Promise.withResolvers<{ default: typeof QrFigure }>()
    const loadQr = vi
      .fn(() => Promise.resolve({ default: QrFigure }))
      .mockImplementationOnce(() => pending.promise)
    const reload = vi.fn()
    render(
      <DevicesApp
        messages={window}
        postMessage={reply}
        qrEncoder={encode}
        loadQr={loadQr}
        reload={reload}
      />,
    )
    await pair()
    expect(screen.getByText(EN.loadingOutput)).toHaveAttribute('role', 'status')
    await act(async () => {
      pending.reject(new Error('chunk unavailable'))
      await Promise.resolve()
    })
    // RVM100W2 4: the browser keeps a failed module fetch, so a fresh import
    // cannot recover it; Retry says it reloads the panel, and does.
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.devices.qrReload)
    expect(
      JSON.parse(screen.getByLabelText<HTMLTextAreaElement>(EN.devices.copyInvitation).value),
    ).toEqual(uiInvitation)
    fireEvent.click(screen.getByRole('button', { name: EN.surfaceLoadRetry }))
    expect(reload).toHaveBeenCalledOnce()
    expect(loadQr).toHaveBeenCalledOnce()
  })

  it('offers the reload only while no request waits for its reply', async () => {
    const reload = vi.fn()
    const held: DeviceWebviewMessage[] = []
    const holdPairs = (request: DeviceWebviewMessage) => {
      if (request.type === 'deviceRequest' && held.length === 0 && pairs.count > 0) {
        held.push(request)
        return
      }
      if (request.type === 'deviceRequest') pairs.count += 1
      reply(request)
    }
    const pairs = { count: 0 }
    render(<DevicesApp messages={window} postMessage={holdPairs} isQrUnavailable reload={reload} />)
    await pair()
    const retry = screen.getByRole('button', { name: EN.surfaceLoadRetry })
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.qrReload)
    expect(retry).toBeEnabled()
    // A second Pair waits for its reply: reloading now would lose it.
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await waitFor(() => {
      expect(held).toHaveLength(1)
    })
    expect(screen.getByRole('button', { name: EN.surfaceLoadRetry })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: EN.surfaceLoadRetry }))
    expect(reload).not.toHaveBeenCalled()
    const [waiting] = held
    if (waiting === undefined) throw new Error('missing held request')
    act(() => {
      reply(waiting)
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: EN.surfaceLoadRetry })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: EN.surfaceLoadRetry }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('restores the unsent invitation draft and keeps every edit for the reload', () => {
    const save = vi.fn()
    render(
      <DevicesApp
        messages={window}
        postMessage={reply}
        draft={{ initial: 'draft before reload', save }}
      />,
    )
    const field = screen.getByLabelText<HTMLTextAreaElement>(EN.devices.scan)
    expect(field.value).toBe('draft before reload')
    fireEvent.change(field, { target: { value: 'draft after edit' } })
    expect(save).toHaveBeenLastCalledWith('draft after edit')
  })

  it('retries a failed QR import on the next Pair even for identical public text', async () => {
    const loadQr = vi
      .fn(() => Promise.resolve({ default: QrFigure }))
      .mockRejectedValueOnce(new Error('chunk unavailable'))
    render(<DevicesApp messages={window} postMessage={reply} qrEncoder={encode} loadQr={loadQr} />)
    await pair()
    await screen.findByRole('alert')
    await pair()
    expect(await screen.findByRole('img', { name: EN.devices.qrCodeName })).toBeVisible()
    expect(loadQr).toHaveBeenCalledTimes(2)
  })
})
