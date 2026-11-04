// A refused landing in the person's words, the one source for the merge card,
// Traffic and an ACP session (CC-WINLAND §5 item 6). Every sentence says what
// happened and what to do next. The holder arrives untyped from the landing and
// is read here by its shape: it is never shown as it came, and what the sentence
// leaves out goes to the log through `mergeRefusalForLog`.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { TeamMergeRefusal } from './teamHostService'

function textOf(value: object, key: string): string | undefined {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' && field !== '' ? field : undefined
}

function ownerOf(holder: object): object | undefined {
  const owner: unknown = 'owner' in holder ? holder.owner : undefined
  return typeof owner === 'object' && owner !== null ? owner : undefined
}

/**
What holds the repository and how to clear it, or undefined when the refusal does
not know. A lock with no owner record is git's or a stranger's, and only the person
may remove it; one with an owner record is another landing's.
*/
function holderWords(holder: unknown): string | undefined {
  if (typeof holder !== 'object' || holder === null) return undefined
  const notices = UI_TEXT.teamTrafficNotices
  const path = textOf(holder, 'path') ?? ''
  switch (textOf(holder, 'kind')) {
    case 'lock': {
      return fill(ownerOf(holder) === undefined ? notices.heldByLock : notices.heldByLanding, {
        path,
      })
    }
    case 'operation': {
      return fill(notices.heldByOperation, { path })
    }
    case 'hint': {
      return notices.heldByWindow
    }
    default: {
      return undefined
    }
  }
}

/** The sentence for a refused landing. `changed`'s offers the Undo Merge a card and Traffic have. */
export function mergeRefusalSentence(refusal: TeamMergeRefusal): string {
  const notices = UI_TEXT.teamTrafficNotices
  const paths = (refusal.paths ?? []).join(', ')
  switch (refusal.kind) {
    case 'changed': {
      return fill(notices.changedDuringLanding, { path: paths })
    }
    case 'held': {
      return fill(notices.fileHeld, { path: paths })
    }
    case 'checks': {
      return fill(notices.checksFailed, { name: refusal.check ?? '' })
    }
    case 'stale': {
      return notices.landingStale
    }
    case 'denied': {
      return notices.landingDenied
    }
    case 'busy': {
      const held = holderWords(refusal.holder)
      return held === undefined ? notices.landingBusyOpen : `${held} ${notices.landingBusyThen}`
    }
    case 'branched': {
      // The name the person would type: the landing keeps the full ref.
      const branch = (refusal.branch ?? '').replace(/^refs\/heads\//u, '')
      const kept = fill(notices.landingBranchedThen, { branch })
      const held = holderWords(refusal.holder)
      return held === undefined ? kept : `${held} ${kept}`
    }
  }
}

/** The refusal's technical detail for the log: its kind and ids, never a path. */
export function mergeRefusalForLog(refusal: TeamMergeRefusal): string {
  const holder = refusal.holder
  const details: string[] = [refusal.kind]
  if (typeof holder === 'object' && holder !== null) {
    const owner = ownerOf(holder)
    details.push(`holder ${textOf(holder, 'kind') ?? 'unknown'}`)
    if (owner !== undefined)
      details.push(
        `landing ${textOf(owner, 'landingId') ?? 'unknown'}`,
        `window ${textOf(owner, 'windowInstanceId') ?? 'unknown'}`,
      )
    const window = textOf(holder, 'windowInstanceId')
    if (window !== undefined) details.push(`window ${window}`)
  }
  if (refusal.branch !== undefined) details.push(`branch ${refusal.branch}`)
  return details.join(', ')
}
