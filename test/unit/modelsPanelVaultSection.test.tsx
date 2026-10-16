// The vault section's mount in the Models & Agents panel (C-M109-1 P1):
// hidden navigation while the gate is off, and with the gate forced on a
// vault nav item whose section asks the host for its snapshot and renders
// the shared surface once the host answers.

// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostBridge } from '../../src/webview/hostBridge'
import { ModelsApp, ModelsPanel } from '../../src/webview/models/panel'
import { INITIAL_PANEL_UI } from '../../src/webview/models/reducer'
import { makeState } from './modelsPanelFixtures'
import { panel } from './helpers/vault/fixtures'

function panelProps(extra: object = {}): Parameters<typeof ModelsPanel>[0] {
  return {
    panelState: makeState(),
    ui: INITIAL_PANEL_UI,
    post: vi.fn(),
    dispatch: vi.fn(),
    ...extra,
  }
}

describe('Vault section mount', () => {
  it('hides the vault navigation while the gate is off', () => {
    render(<ModelsPanel {...panelProps()} />)
    expect(screen.getByRole('button', { name: UI_TEXT.providersSectionTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: UI_TEXT.modelsSectionTitle })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: UI_TEXT.vault.title })).toBeNull()
  })

  it('falls back to the first visible section on a vault deep link while hidden', () => {
    const dispatch = vi.fn()
    render(
      <ModelsPanel {...panelProps({ ui: { ...INITIAL_PANEL_UI, section: 'vault' }, dispatch })} />,
    )
    expect(screen.queryByRole('button', { name: UI_TEXT.vault.title })).toBeNull()
    // The providers section renders instead of a blank panel.
    expect(
      screen.getByRole('button', { name: UI_TEXT.providersSectionTitle, current: 'page' }),
    ).toBeInTheDocument()
  })

  it('with the gate forced on, navigates to the vault and asks for its snapshot once', () => {
    const dispatch = vi.fn()
    const vaultPost = vi.fn()
    render(
      <ModelsPanel
        {...panelProps({
          panelState: makeState({ vaultOffered: true }),
          dispatch,
          vaultPost,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.vault.title }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'navigate', section: 'vault' })
    // The mount is not rendered yet (providers section is active), so no
    // vault message has been posted.
    expect(vaultPost).not.toHaveBeenCalled()
  })

  it('the mount posts vaultReady once and waits for the host state', () => {
    const vaultPost = vi.fn()
    render(
      <ModelsPanel
        {...panelProps({
          panelState: makeState({ vaultOffered: true }),
          ui: { ...INITIAL_PANEL_UI, section: 'vault' },
          vaultPost,
        })}
      />,
    )
    expect(vaultPost).toHaveBeenCalledExactlyOnceWith({ type: 'vaultReady' })
    expect(screen.getByText(UI_TEXT.connecting)).toBeInTheDocument()
  })

  it('renders the shared surface once the host answers', async () => {
    const vaultPost = vi.fn()
    render(
      <ModelsPanel
        {...panelProps({
          panelState: makeState({ vaultOffered: true }),
          ui: { ...INITIAL_PANEL_UI, section: 'vault' },
          vaultRaw: { type: 'vaultState', state: panel() },
          vaultPost,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(UI_TEXT.vault.grant)).toBeInTheDocument()
    })
    // Names only, never values: the item label renders in the item, grant
    // and detail rows (values stay in the host's native prompts and never
    // cross this surface).
    expect(screen.getAllByText(/Generated test item/).length).toBeGreaterThanOrEqual(2)
  })

  it('routes vault envelopes without reporting, and still reports garbage', () => {
    const post = vi.fn<HostBridge['post']>()
    const host: HostBridge = {
      post,
      messages: window,
      savedState: () => undefined,
      saveState: vi.fn(),
    }
    const report = vi.fn()
    render(<ModelsApp host={host} report={report} />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'modelsPanel/state', state: makeState({ vaultOffered: true }) },
        }),
      )
    })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'vaultState', state: panel() },
        }),
      )
    })
    expect(report).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'nope' } }))
    })
    expect(report).toHaveBeenCalledWith('hostMessage', expect.any(Error))
  })
})
