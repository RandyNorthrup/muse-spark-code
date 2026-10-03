// The approvals Muse is waiting on, docked just above the composer as in
// Claude Code's panel (PLAN.md D26): always in view, whatever the scroll. The
// oldest waits here, in the order Muse Code asked; a count says how many
// more do, each moving up as the one before is settled. Its row in the
// transcript keeps a compact record and, once decided, the decision.
//
// Focus moves to a card when it arrives, unless the user is typing (the
// panel's live region announces it then): onto the card itself, never onto
// a choice that a stray Enter would make.

import { useEffect, useRef } from 'react'
import { DOCK_TYPING_GRACE_MS, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import type { WaitingApproval } from '../state/uiState'
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'

export interface ApprovalDockProps {
  /** The approvals waiting, oldest first. */
  readonly waiting: readonly WaitingApproval[]
  readonly onDecide: ApprovalCardProps['onDecide']
  /** Behind a modal (M25). */
  readonly isInert?: boolean
}

/**
 * Whether the user is typing where focus is: a field holding text, or one
 * that took a key a moment ago. A card arriving then leaves focus there.
 * An empty composer that merely kept focus after a send is not typing.
 */
function isTyping(element: Element | null, lastKeyAt: number): boolean {
  const isRecentKey = Date.now() - lastKeyAt < DOCK_TYPING_GRACE_MS
  const isTextField = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
  return isTextField
    ? element.value !== '' || isRecentKey
    : (element instanceof HTMLSelectElement ||
        (element instanceof HTMLElement && element.isContentEditable)) &&
        isRecentKey
}

export function ApprovalDock({ waiting, onDecide, isInert = false }: ApprovalDockProps) {
  const dock = useRef<HTMLElement>(null)
  const lastKeyAt = useRef(0)
  useEffect(() => {
    const onKey = () => {
      lastKeyAt.current = Date.now()
    }
    document.addEventListener('keydown', onKey, { capture: true })
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [])
  const first = waiting[0]
  const stageKey =
    first === undefined
      ? undefined
      : `${first.approval.approvalId}:${String(first.approval.requirementId.sourceIndex)}`
  useEffect(() => {
    if (stageKey === undefined || isInert || isTyping(document.activeElement, lastKeyAt.current)) {
      return
    }
    dock.current?.querySelector<HTMLElement>('[role="group"]')?.focus()
  }, [stageKey, isInert])
  if (first === undefined) {
    return null
  }
  return (
    <section
      ref={dock}
      className="approval-dock"
      aria-label={UI_TEXT.approvalDockLabel}
      inert={isInert}
    >
      {waiting.length > 1 ? (
        <p className="approval-dock-count">
          {fill(UI_TEXT.approvalDockCount, { count: formatNumber(waiting.length) })}
        </p>
      ) : null}
      <ApprovalCard
        key={stageKey}
        approval={first.approval}
        toolName={first.toolName}
        onDecide={onDecide}
      />
    </section>
  )
}
