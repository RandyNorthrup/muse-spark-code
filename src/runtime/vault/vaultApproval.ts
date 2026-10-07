import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { VaultApprovalRequest, VaultApprovalAnswer } from '../../shared/vault'

export function vaultDecisionChoices(
  request: VaultApprovalRequest,
): VaultApprovalAnswer['decision'][] {
  const isSession =
    request.item.policy.mode === 'askOncePerSession' &&
    request.requester.sessionId !== null &&
    !request.requester.unattended &&
    !request.taint.tainted &&
    request.use.kind !== 'disclosure'
  return ['allowOnce', ...(isSession ? ['allowSession' as const] : []), 'deny']
}
export function vaultApprovalText(request: VaultApprovalRequest): string {
  const detail = fill(UI_TEXT.vault.approval, {
    requester: JSON.stringify(request.requester),
    use: request.use.kind,
    item: request.item.handle,
    target: JSON.stringify(request.use),
  })
  return [
    detail,
    request.taint.tainted
      ? fill(UI_TEXT.vault.taintWarning, { content: JSON.stringify(request.taint.reasons) })
      : '',
    request.item.requirePresence ? UI_TEXT.vault.presenceWarning : '',
    ['environment', 'stdin', 'sudo', 'askpass', 'git', 'mcp'].includes(request.use.kind)
      ? UI_TEXT.vault.processWarning
      : '',
    UI_TEXT.vault.paidWarning,
  ]
    .filter(Boolean)
    .join('\n')
}
