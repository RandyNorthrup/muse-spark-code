// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DevicesApp } from '../../src/webview/models/sections/agents/DevicesApp'
import { uiMessage } from './helpers/deviceUiFakes'

describe('Devices document readiness', () => {
  it('posts the ready handshake once on mount, without an action or probe', () => {
    const postMessage = vi.fn()
    const { rerender, unmount } = render(<DevicesApp messages={window} postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'devicesReady' })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: uiMessage() }))
    })
    rerender(<DevicesApp messages={window} postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledOnce()
    unmount()
    expect(postMessage).toHaveBeenCalledOnce()
  })

  it('subscribes before ready so an immediate host snapshot reaches the view', () => {
    const postMessage = vi.fn(() => {
      window.dispatchEvent(new MessageEvent('message', { data: uiMessage() }))
    })
    render(<DevicesApp messages={window} postMessage={postMessage} />)
    expect(screen.getByText('Mac receiver')).toBeVisible()
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'devicesReady' })
  })
})
