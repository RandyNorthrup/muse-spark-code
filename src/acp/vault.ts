import { vaultDecisionChoices } from '../runtime/vault/vaultApproval'
import type { PermissionOption, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../shared/constants'
import {
  vaultApprovalRequestSchema,
  vaultApprovalAnswerSchema,
  type VaultApprovalAnswer,
  type VaultApprovalRequest,
} from '../shared/vault'
import {
  vaultRead,
  type VaultCommandPort,
  type VaultReadCommand,
} from '../runtime/vault/vaultCommand'

export type VaultAsker = (
  sessionId: string,
  request: VaultApprovalRequest,
) => Promise<VaultApprovalAnswer>

export function vaultPermissionOptions(request: VaultApprovalRequest): PermissionOption[] {
  return vaultDecisionChoices(request).map((optionId): PermissionOption => {
    switch (optionId) {
      case 'allowOnce': {
        return { optionId, name: UI_TEXT.allowOnce, kind: 'allow_once' }
      }
      case 'allowSession': {
        return { optionId, name: UI_TEXT.vault.allowSession, kind: 'allow_always' }
      }
      case 'deny': {
        return { optionId, name: UI_TEXT.paidDeny, kind: 'reject_once' }
      }
    }
  })
}
export function vaultPermissionAnswer(
  request: VaultApprovalRequest,
  response: RequestPermissionResponse,
): VaultApprovalAnswer {
  const choice = response.outcome.outcome === 'selected' ? response.outcome.optionId : 'deny'
  const isOffered = vaultPermissionOptions(request).some((option) => option.optionId === choice)
  const decision =
    isOffered && (choice === 'allowOnce' || choice === 'allowSession') ? choice : 'deny'
  return { requestId: request.id, digest: request.digest, decision }
}

/** Local slash commands are intercepted before skill or model dispatch. */
export function vaultSlash(text: string): VaultReadCommand | 'invalid' | undefined {
  const [name, command = 'status', ...rest] = text.trim().split(/\s+/u)
  if (name !== '/vault') return undefined
  const choice = (['status', 'list', 'lock', 'audit'] as const).find(
    (candidate) => candidate === command,
  )
  return choice !== undefined && rest.length === 0 ? choice : 'invalid'
}

/** W/X connect broker requests here; a missing editor never authorizes anything. */
export class AcpVault {
  private asker: VaultAsker | undefined
  constructor(private readonly open: () => Promise<VaultCommandPort>) {}
  attach(asker: VaultAsker): void {
    this.asker = asker
  }
  async ask(sessionId: string, raw: VaultApprovalRequest): Promise<VaultApprovalAnswer> {
    const request = vaultApprovalRequestSchema.parse(structuredClone(raw))
    const deny: VaultApprovalAnswer = {
      requestId: request.id,
      digest: request.digest,
      decision: 'deny',
    }
    if (request.requester.conversationId !== sessionId || this.asker === undefined) return deny
    try {
      const answer = vaultApprovalAnswerSchema.parse(await this.asker(sessionId, request))
      return answer.requestId !== request.id ||
        answer.digest !== request.digest ||
        vaultPermissionOptions(request).every((option) => option.optionId !== answer.decision)
        ? deny
        : answer
    } catch {
      return deny
    }
  }
  async command(command: VaultReadCommand): Promise<string> {
    const port = await this.open()
    try {
      return await vaultRead(port, command, true)
    } finally {
      await port.close()
    }
  }
}
