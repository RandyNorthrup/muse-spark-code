// @vitest-environment jsdom
// RLTESTDRIVE 10: the vault tab is always present, with its state or its
// reason. When the panel cannot build the vault binding, the host answers
// with a synthesized unavailable frame whose reason names the failure: the
// switched-off sentence, the broker-blocked sentence, or unreachable for
// anything else. Exact sentence match only: no foreign text can quote a
// full sentence.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import { vaultPanelStateSchema } from '../../../src/shared/vaultPanel'
import {
  unavailableVaultPanelState,
  vaultBindingFailureReason,
} from '../../../src/shared/vaultRefusals'
import { VaultSection, tierWarning } from '../../../src/webview/models/sections/vault/VaultSection'

describe('vault binding failure reason', () => {
  it('names a switched-off vault switchedOff', () => {
    expect(vaultBindingFailureReason(new Error(UI_TEXT.vault.switchedOff))).toBe('switchedOff')
  })

  it('names a broker that cannot start brokerBlocked', () => {
    expect(vaultBindingFailureReason(new Error(UI_TEXT.vault.brokerBlocked))).toBe('brokerBlocked')
  })

  it('names anything else unreachable, never native text', () => {
    expect(vaultBindingFailureReason(new Error('EACCES: permission denied'))).toBe('unreachable')
    expect(vaultBindingFailureReason('brokerBlocked')).toBe('unreachable')
    expect(vaultBindingFailureReason(undefined)).toBe('unreachable')
  })
})

describe('unavailable vault frame', () => {
  it('validates as a panel state carrying the reason', () => {
    for (const reason of ['switchedOff', 'brokerBlocked', 'unreachable'] as const) {
      const parsed = vaultPanelStateSchema.safeParse(unavailableVaultPanelState(reason))
      expect(parsed.success, reason).toBe(true)
      if (!parsed.success) continue
      expect(parsed.data.status.state).toBe('unavailable')
      expect(parsed.data.status.reason).toBe(reason)
      expect(parsed.data.items).toEqual([])
    }
  })

  it('tells a switched-off vault with the settings sentence, not the repair message', () => {
    const state = unavailableVaultPanelState('switchedOff')
    expect(tierWarning(state.status)).toBe(UI_TEXT.vault.switchedOff)
    render(<VaultSection state={state} post={() => undefined} />)
    expect(screen.getByText(UI_TEXT.vault.switchedOff)).toBeInTheDocument()
    expect(screen.queryByText(UI_TEXT.vault.brokerBlocked)).toBeNull()
  })
})
