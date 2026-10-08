// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { DevicesApp } from '../../src/webview/models/sections/agents/DevicesApp'
import QrFigure from '../../src/webview/models/sections/devices/qr/QrFigure'
import type { DeviceWebviewRequest } from '../../src/shared/devicesPanel'
import { uiInvitation, uiMessage } from './helpers/deviceUiFakes'

const encode = () => ({
  size: 21,
  modules: Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => true)),
})

function reply(request: DeviceWebviewRequest) {
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

  it('announces loading, preserves text on failure and imports again on Retry', async () => {
    const pending = Promise.withResolvers<{ default: typeof QrFigure }>()
    const loadQr = vi
      .fn(() => Promise.resolve({ default: QrFigure }))
      .mockImplementationOnce(() => pending.promise)
    render(<DevicesApp messages={window} postMessage={reply} qrEncoder={encode} loadQr={loadQr} />)
    await pair()
    expect(screen.getByText(EN.loadingOutput)).toHaveAttribute('role', 'status')
    await act(async () => {
      pending.reject(new Error('chunk unavailable'))
      await Promise.resolve()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.surfaceLoadFailed)
    expect(
      JSON.parse(screen.getByLabelText<HTMLTextAreaElement>(EN.devices.copyInvitation).value),
    ).toEqual(uiInvitation)
    fireEvent.click(screen.getByRole('button', { name: EN.surfaceLoadRetry }))
    expect(await screen.findByRole('img', { name: EN.devices.qrCodeName })).toBeVisible()
    expect(loadQr).toHaveBeenCalledTimes(2)
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
