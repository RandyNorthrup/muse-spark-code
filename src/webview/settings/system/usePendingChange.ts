// Muse Desktop (M111, D91.16) lane ST1: the confirmation every system
// change passes through. A page stages its change with `request` and the
// dialog's Confirm is the only path to `onApply`; Cancel (or Escape, via
// the dialog) drops it without a call.

import { useState } from 'react'

export interface PendingChange<Change> {
  readonly change: Change
  readonly description: string
}

export interface PendingChangeHandle<Change> {
  readonly pending: PendingChange<Change> | null
  readonly request: (change: Change, description: string) => void
  readonly confirm: () => void
  readonly cancel: () => void
}

export function usePendingChange<Change>(
  onApply: (change: Change) => void,
): PendingChangeHandle<Change> {
  const [pending, setPending] = useState<PendingChange<Change> | null>(null)
  return {
    pending,
    request: (change, description) => {
      setPending({ change, description })
    },
    confirm: () => {
      const staged = pending
      setPending(null)
      if (staged !== null) {
        onApply(staged.change)
      }
    },
    cancel: () => {
      setPending(null)
    },
  }
}
