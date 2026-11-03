// @vitest-environment jsdom
// RLF-M109H item 1: where the person allows an environment delivery,
// the card says in their words what that mode still exposes and that
// standard input avoids it. Other modes do not carry the sentence.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VaultApprovalCard } from '../../../src/webview/components/VaultApprovalCard'
import { UI_TEXT } from '../../../src/shared/constants'
import type { VaultApprovalRequest, VaultUse } from '../../../src/shared/vault'
import { metadata, requester, use } from '../helpers/vault/fixtures'

function approvalRequest(withUse: VaultUse): VaultApprovalRequest {
  return {
    id: 'a'.repeat(32),
    requester: requester(),
    item: metadata(),
    use: withUse,
    digest: 'b'.repeat(64),
    nonce: 'c'.repeat(32),
    createdAt: 0,
    lockEpoch: 0,
    taint: { tainted: false, reasons: [] },
  }
}

function renderCard(withUse: VaultUse): void {
  render(
    <VaultApprovalCard
      request={approvalRequest(withUse)}
      onAnswer={() => undefined}
      onManage={() => undefined}
    />,
  )
}

describe('vault approval environment warning (RLF-M109H)', () => {
  it('says what environment delivery exposes where the person allows it', () => {
    renderCard(use())
    const warning = UI_TEXT.vault.environmentWarning
    expect(screen.getByText(warning)).toBeInTheDocument()
    expect(warning).toMatch(/Linux/)
    expect(warning).toMatch(/macOS/)
    expect(warning).toMatch(/Windows/)
    expect(warning).toMatch(/administrator/)
    expect(warning).toMatch(/standard input/)
    expect(warning).not.toMatch(/shield/i)
  })

  it('does not carry the environment sentence for a standard-input use', () => {
    renderCard({ kind: 'stdin', command: use().command })
    expect(screen.queryByText(UI_TEXT.vault.environmentWarning)).not.toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.vault.processWarning)).toBeInTheDocument()
  })
})
