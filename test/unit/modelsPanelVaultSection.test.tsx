// The vault section's mount in the Models & Agents panel (C-M109-1 P1):
// the tab is always present (RLTESTDRIVE 10), bound or not; its section
// asks the host for its snapshot and renders the shared surface once the
// host answers with a state or a reason.

// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { unavailableVaultPanelState } from '../../src/shared/vaultRefusals'
import type { HostBridge } from '../../src/webview/hostBridge'
import type { ErrorReporter } from '../../src/webview/errorReport'
import { ModelsApp, ModelsPanel, type ModelsPanelProps } from '../../src/webview/models/panel'
import { INITIAL_PANEL_UI } from '../../src/webview/models/reducer'
import { makeState } from './modelsPanelFixtures'
import { panel } from './helpers/vault/fixtures'
import { recordCalls } from './helpers/recordCalls'

function panelProps(extra: object = {}): Parameters<typeof ModelsPanel>[0] {
  return {
    panelState: makeState(),
    ui: INITIAL_PANEL_UI,
    post: () => undefined,
    dispatch: () => undefined,
    ...extra,
  }
}

type VaultPost = NonNullable<ModelsPanelProps['vaultPost']>
function recordVaultPost(): { calls: Parameters<VaultPost>[]; post: VaultPost } {
  const { calls, fn } = recordCalls<Parameters<VaultPost>>()
  return { calls, post: fn }
}

describe('Vault section mount', () => {
  it('shows the vault navigation with no binding', () => {
    render(<ModelsPanel {...panelProps()} />)
    expect(screen.getByRole('button', { name: UI_TEXT.providersSectionTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: UI_TEXT.modelsSectionTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: UI_TEXT.vault.title })).toBeInTheDocument()
  })

  it('renders the vault section on a vault deep link with no binding', () => {
    const { fn: dispatch } = recordCalls<Parameters<ModelsPanelProps['dispatch']>>()
    render(
      <ModelsPanel {...panelProps({ ui: { ...INITIAL_PANEL_UI, section: 'vault' }, dispatch })} />,
    )
    // The vault section renders (asking for its snapshot) instead of the
    // panel falling back to providers.
    expect(
      screen.getByRole('button', { name: UI_TEXT.vault.title, current: 'page' }),
    ).toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.connecting)).toBeInTheDocument()
  })

  it('navigates to the vault and asks for its snapshot once', () => {
    const { calls: dispatchCalls, fn: dispatch } =
      recordCalls<Parameters<ModelsPanelProps['dispatch']>>()
    const { calls: vaultPostCalls, post: vaultPost } = recordVaultPost()
    render(
      <ModelsPanel
        {...panelProps({
          dispatch,
          vaultPost,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.vault.title }))
    expect(dispatchCalls).toEqual([[{ type: 'navigate', section: 'vault' }]])
    // The mount is not rendered yet (providers section is active), so no
    // vault message has been posted.
    expect(vaultPostCalls).toEqual([])
  })

  it('the mount posts vaultReady once and waits for the host state', () => {
    const { calls: vaultPostCalls, post: vaultPost } = recordVaultPost()
    render(
      <ModelsPanel
        {...panelProps({
          ui: { ...INITIAL_PANEL_UI, section: 'vault' },
          vaultPost,
        })}
      />,
    )
    expect(vaultPostCalls).toEqual([[{ type: 'vaultReady' }]])
    expect(screen.getByText(UI_TEXT.connecting)).toBeInTheDocument()
  })

  it('renders the shared surface once the host answers', async () => {
    const { post: vaultPost } = recordVaultPost()
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

  it('renders the failure reason once the host answers unavailable', async () => {
    const { post: vaultPost } = recordVaultPost()
    render(
      <ModelsPanel
        {...panelProps({
          ui: { ...INITIAL_PANEL_UI, section: 'vault' },
          vaultRaw: {
            type: 'vaultState',
            state: unavailableVaultPanelState('switchedOff'),
          },
          vaultPost,
        })}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText(UI_TEXT.vault.switchedOff)).toBeInTheDocument()
    })
  })

  it('routes vault envelopes without reporting, and still reports garbage', async () => {
    const { fn: post } = recordCalls<Parameters<HostBridge['post']>>()
    const host: HostBridge = {
      post,
      messages: window,
      savedState: () => undefined,
      saveState: () => undefined,
    }
    const { calls: reportCalls, fn: report } = recordCalls<Parameters<ErrorReporter>>()
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
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'nope' } }))
    })
    // The panel receives host messages in order, one after another, each
    // after its lazy schemas load (M96). Once the garbage is reported, the
    // state and the vault envelope before it were routed: the one report
    // is the garbage's.
    await waitFor(() => {
      expect(reportCalls.length).toBeGreaterThan(0)
    })
    expect(reportCalls).toEqual([['hostMessage', expect.any(Error)]])
  })
})
