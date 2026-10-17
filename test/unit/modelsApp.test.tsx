// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { parsePanelToHostMessage } from '../../src/shared/modelsPanel'
import type { HostBridge } from '../../src/webview/hostBridge'
import { ModelsApp } from '../../src/webview/models/panel'
import { makeProvider, makeRow, makeState } from './modelsPanelFixtures'

describe('ModelsApp shared host contract', () => {
  it('subscribes before ready, renders host state, follows navigation and posts top-level requests', () => {
    const state = makeState({ providers: [makeProvider()], models: [makeRow()], totalModels: 1 })
    const post = vi.fn<HostBridge['post']>((message) => {
      expect(parsePanelToHostMessage(message).ok).toBe(true)
      if (message.type === 'modelsPanel/ready') {
        window.dispatchEvent(
          new MessageEvent('message', { data: { type: 'modelsPanel/state', state } }),
        )
      }
    })
    const host: HostBridge = {
      post,
      messages: window,
      savedState: () => undefined,
      saveState: vi.fn(),
    }
    const report = vi.fn()
    const { unmount } = render(<ModelsApp host={host} report={report} />)
    expect(post).toHaveBeenCalledWith({ type: 'modelsPanel/ready' })
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(screen.queryByText(UI_TEXT.connecting)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerEdit }))
    expect(post).toHaveBeenCalledWith({ type: 'providers/edit', providerId: 'ollama' })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'modelsPanel/navigate',
            section: 'models',
            itemId: 'ollama/qwen3:8b',
          },
        }),
      )
    })
    expect(screen.getByRole('row', { name: 'ollama/qwen3:8b' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Offer ollama/ }))
    expect(post).toHaveBeenCalledWith({
      type: 'models/tick',
      scope: { scope: 'provider', providerId: 'ollama' },
      ref: 'ollama/qwen3:8b',
      ticked: false,
    })
    expect(report).not.toHaveBeenCalled()
    unmount()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'navigate' } }))
    })
    expect(report).not.toHaveBeenCalled()
  })

  it('rejects the incompatible legacy envelope and preserves the displayed state', () => {
    const post = vi.fn()
    const report = vi.fn()
    const host: HostBridge = {
      post,
      messages: window,
      savedState: () => undefined,
      saveState: vi.fn(),
    }
    render(<ModelsApp host={host} report={report} />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'providers/state', payload: makeState() } }),
      )
    })
    expect(report).toHaveBeenCalledWith('hostMessage', expect.any(Error))
    expect(screen.getByText(UI_TEXT.connecting)).toBeInTheDocument()
  })
})
