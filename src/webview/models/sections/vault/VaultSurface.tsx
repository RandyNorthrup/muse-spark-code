import { lazy, Suspense } from 'react'
import { UI_TEXT } from '../../../../shared/constants'
import {
  vaultClientMessageSchema,
  vaultHostMessageSchema,
} from '../../../../shared/hostApi/vaultMessages'
import type { VaultPanelPost } from './VaultSection'

const Section = lazy(async () => {
  const module = await import('./VaultSection')
  return { default: module.VaultSection }
})
const Approval = lazy(async () => {
  const module = await import('../../../components/VaultApprovalCard')
  return { default: module.VaultApprovalCard }
})

/** M95/M104 supply a snapshot and authenticated post port. No persistence or secret entry in this surface. */
export function VaultSurface({
  raw,
  post,
  onManage,
  cardsOnly = false,
}: {
  readonly raw: unknown
  readonly post: VaultPanelPost
  readonly onManage: () => void
  readonly cardsOnly?: boolean
}) {
  const parsed = vaultHostMessageSchema.safeParse(raw)
  if (!parsed.success) return <p role="alert">{UI_TEXT.vault.operationFailed}</p>
  const state = parsed.data.state
  function send(message: Parameters<VaultPanelPost>[0]): void {
    post(vaultClientMessageSchema.parse(message))
  }
  return (
    <Suspense fallback={<p role="status">{UI_TEXT.loadingOutput}</p>}>
      {!cardsOnly && <Section state={state} post={send} />}
      {state.status.state === 'unlocked' &&
        state.pending.map((request) => (
          <Approval
            key={`${request.id}:${request.digest}`}
            request={request}
            onAnswer={(answer) => {
              send({ type: 'vaultAnswer', answer })
            }}
            onManage={onManage}
          />
        ))}
    </Suspense>
  )
}
