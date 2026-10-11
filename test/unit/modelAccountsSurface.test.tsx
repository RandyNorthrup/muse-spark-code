// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelAccounts } from '../../src/webview/models/ModelAccounts'
import { AccountsSurface } from '../../src/webview/models/sections/accounts/AccountsSurface'
import type { HostBridge } from '../../src/webview/hostBridge'
import {
  modelAccountsRequestSchema,
  modelAccountsMessageSchema,
} from '../../src/shared/modelAccountsProtocol'
import { ACCOUNT_PANEL_REQUEST_TIMEOUT_MS, UI_TEXT } from '../../src/shared/constants'
import { panelSlice } from './helpers/accounts/panel'

function bridge() {
  const host: HostBridge = {
    post: vi.fn(),
    messages: window,
    savedState: () => undefined,
    saveState: () => undefined,
  }
  return host
}
function receive(value: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data: value }))
}
afterEach(() => vi.useRealTimers())
describe('installed Models account surface', () => {
  it('stays hidden until host advertises availability, then loads real account rows through correlated replies', async () => {
    const host = bridge()
    vi.mocked(host.post).mockImplementation((message) => {
      const parsed = modelAccountsRequestSchema.safeParse(message)
      if (parsed.success && parsed.data.type === 'modelAccounts/request')
        receive({
          type: 'modelAccounts/reply',
          requestId: parsed.data.requestId,
          value: panelSlice(),
        })
    })
    render(<ModelAccounts host={host} />)
    expect(screen.queryByRole('region', { name: UI_TEXT.accounts.title })).not.toBeInTheDocument()
    await act(async () => {
      receive({ type: 'modelAccounts/available' })
      await Promise.resolve()
    })
    expect(await screen.findByRole('region', { name: UI_TEXT.accounts.title })).toBeVisible()
    expect(host.post).toHaveBeenCalledWith({ type: 'modelAccounts/ready' })
  })
  it('rejects mismatched or secret-bearing replies and gives an honest request failure at its unchanged bound', async () => {
    vi.useFakeTimers()
    const host = bridge()
    render(<AccountsSurface host={host} revision={1} />)
    await act(async () => {
      receive({ type: 'modelAccounts/reply', requestId: 999, value: panelSlice() })
      receive({
        type: 'modelAccounts/reply',
        requestId: 1,
        value: { ...panelSlice(), secret: 'fixture-private' },
      })
      await vi.advanceTimersByTimeAsync(ACCOUNT_PANEL_REQUEST_TIMEOUT_MS)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.accounts.unavailable)
    expect(screen.queryByText('fixture-private')).not.toBeInTheDocument()
    expect(
      modelAccountsMessageSchema.safeParse({
        type: 'modelAccounts/available',
        secret: 'fixture-private',
      }).success,
    ).toBe(false)
    expect(
      modelAccountsRequestSchema.safeParse({
        type: 'modelAccounts/request',
        requestId: 1,
        request: {
          type: 'accounts/use',
          provider: 'meta',
          account: 'work',
          secret: 'fixture-private',
        },
      }).success,
    ).toBe(false)
  })
})
