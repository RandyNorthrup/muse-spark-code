// RVCM1091F REDESIGN (fourth round on the vault section's host): the view is
// ONE explicit state machine, never a boolean. `lockRequested` meant three
// things at once (this window's Lock in flight, a Lock that succeeded without
// a locked snapshot, an optimistic Locked view from a broker event) and
// silenced failures and later events. Every broker event, user action and
// snapshot result below is a closed-union member; the one pure transition
// names the next state and its effects for EVERY state crossed with EVERY
// event (vaultViewMachine.test.ts enumerates the unions themselves, so a new
// state or event without a row fails that test instead of falling silent).
import { UI_TEXT } from '../../shared/constants'
import type { VaultPanelState } from '../../shared/vaultPanel'
import type { VaultStatus } from '../../shared/vaultStatus'

/** Transient snapshot failures: the last good view is kept and re-tried. */
export type VaultTransientReason = 'busy' | 'rollback' | 'timeout' | 'watchLost'

/**
 * Why the section is unavailable. `brokerCannotStart` is the ONLY reason
 * that shows the repair sentence, and it is only reached from the broker's
 * own `brokerBlocked` verdict (never synthesized from a busy/rollback/io
 * failure). `uncreated`, `setupPending` and `firstPartyOnly` are normal
 * snapshots the broker returns, each named so no new snapshot state falls
 * through to a repair claim.
 */
export type VaultUnavailableReason =
  | VaultTransientReason
  | 'brokerCannotStart'
  | 'unreachable'
  | 'storeUnavailable'
  | 'vaultLost'
  | 'auditInvalid'
  | 'slotUnavailable'
  | 'basicText'
  | 'uncreated'
  | 'setupPending'
  | 'firstPartyOnly'

/** The closed state union: a new kind without a table row fails the test. */
export type VaultViewState =
  | {
      readonly kind: 'loading'
      readonly generation: number
      readonly lastGood?: VaultPanelState
      /** Remaining auto-retries if the in-flight reload fails transiently. */
      readonly retriesLeft?: number
    }
  | {
      readonly kind: 'locked'
      readonly lockEpoch: number
      readonly generation: number
      readonly frame: VaultPanelState
      /**
       * True once the broker confirmed the lock (its event, a locked
       * snapshot, or this window's own Lock call returning). An optimistic
       * Locked painted from this window's in-flight Lock is unconfirmed: a
       * snapshot failure there says Unavailable (the lock may have failed),
       * while a confirmed one keeps Locked (RVCM1091F: a failed Lock with no
       * snapshot is Unavailable; a Lock that succeeded while the snapshot is
       * down stays Locked).
       */
      readonly confirmed: boolean
    }
  | { readonly kind: 'unlocked'; readonly snapshot: VaultPanelState; readonly generation: number }
  | {
      readonly kind: 'unavailable'
      readonly reason: VaultUnavailableReason
      readonly generation: number
      readonly frame: VaultPanelState
      readonly lastGood?: VaultPanelState
      readonly retriesLeft: number
    }

/** Every state kind, for the exhaustive table test. */
export const VAULT_VIEW_STATES = ['loading', 'locked', 'unlocked', 'unavailable'] as const

/**
 * The closed event union: every broker event, every user action and every
 * snapshot result. `brokerUnlocked` is the broker's post-unlock change as
 * this window observes it; `watchRestored` is a reopened stream's first
 * change; `autoRetry` is the machine's own bounded retry (it never resets
 * the budget — only `userRetry` does).
 */
export type VaultViewEvent =
  | { readonly kind: 'brokerLocked'; readonly lockEpoch: number }
  | { readonly kind: 'brokerUnlocked' }
  | { readonly kind: 'brokerChanged' }
  | { readonly kind: 'brokerApproval' }
  | { readonly kind: 'brokerRevoked' }
  | { readonly kind: 'vaultReady' }
  | { readonly kind: 'watchLost' }
  | { readonly kind: 'watchRestored' }
  | { readonly kind: 'userLock' }
  /** This window's Lock call returned: the optimistic view is broker truth. */
  | { readonly kind: 'userLockConfirmed' }
  | { readonly kind: 'userUnlock' }
  | { readonly kind: 'userAdd' }
  | { readonly kind: 'userImport' }
  | { readonly kind: 'userDelete' }
  | { readonly kind: 'userRevoke' }
  | { readonly kind: 'userRetry' }
  | { readonly kind: 'autoRetry' }
  | {
      readonly kind: 'snapshotOk'
      readonly generation: number
      readonly snapshot: VaultPanelState
    }
  | {
      readonly kind: 'snapshotFailed'
      readonly generation: number
      readonly reason: VaultUnavailableReason
    }

/** Every event kind, for the exhaustive table test. */
export const VAULT_VIEW_EVENTS = [
  'brokerLocked',
  'brokerUnlocked',
  'brokerChanged',
  'brokerApproval',
  'brokerRevoked',
  'vaultReady',
  'watchLost',
  'watchRestored',
  'userLock',
  'userLockConfirmed',
  'userUnlock',
  'userAdd',
  'userImport',
  'userDelete',
  'userRevoke',
  'userRetry',
  'autoRetry',
  'snapshotOk',
  'snapshotFailed',
] as const

export interface VaultViewEffects {
  /** The frame to publish now; null only while loading before the first view. */
  readonly frame: VaultPanelState | null
  /** A failure sentence to toast; null means the frame speaks for itself. */
  readonly toast: string | null
  /** The host must take a fresh snapshot (its settle always publishes). */
  readonly reload: boolean
  /** The host must schedule a bounded retry after this delay. */
  readonly retryInMs: number | null
}

export interface VaultViewResult {
  readonly state: VaultViewState
  readonly effects: VaultViewEffects
}

/** The sentence each unavailable reason toasts; null means no toast. */
export function vaultUnavailableMessage(reason: VaultUnavailableReason): string | null {
  switch (reason) {
    case 'busy': {
      return UI_TEXT.vault.busy
    }
    case 'rollback': {
      return UI_TEXT.vault.rollback
    }
    case 'timeout':
    case 'watchLost':
    case 'unreachable': {
      return UI_TEXT.vault.operationFailed
    }
    case 'brokerCannotStart': {
      return UI_TEXT.vault.brokerBlocked
    }
    case 'storeUnavailable': {
      return UI_TEXT.vault.storeUnavailable
    }
    case 'vaultLost': {
      return UI_TEXT.vault.vaultLost
    }
    case 'auditInvalid': {
      return UI_TEXT.vault.auditInvalid
    }
    case 'slotUnavailable': {
      return UI_TEXT.vault.slotUnavailable
    }
    case 'basicText': {
      return UI_TEXT.vault.basicText
    }
    case 'uncreated':
    case 'setupPending':
    case 'firstPartyOnly': {
      return null
    }
  }
}

/**
 * The status reason an exhausted unavailable frame carries. Transient
 * host-side reasons need their own names so they never borrow the repair
 * sentence; `brokerCannotStart` keeps the broker's own `brokerBlocked`.
 */
export function vaultFrameReason(reason: VaultUnavailableReason): VaultStatus['reason'] {
  switch (reason) {
    case 'brokerCannotStart': {
      return 'brokerBlocked'
    }
    case 'unreachable': {
      return 'unreachable'
    }
    case 'timeout': {
      return 'timeout'
    }
    case 'watchLost': {
      return 'watchLost'
    }
    case 'busy': {
      return 'busy'
    }
    case 'storeUnavailable': {
      return 'storeUnavailable'
    }
    case 'rollback':
    case 'vaultLost':
    case 'auditInvalid':
    case 'slotUnavailable':
    case 'basicText': {
      return reason
    }
    case 'uncreated':
    case 'setupPending':
    case 'firstPartyOnly': {
      return null
    }
  }
}

/** The frame this view currently shows, if it has shown one yet. */
export function vaultViewFrame(state: VaultViewState): VaultPanelState | null {
  return currentFrame(state)
}

function currentFrame(state: VaultViewState): VaultPanelState | null {
  switch (state.kind) {
    case 'loading': {
      return state.lastGood ?? null
    }
    case 'locked': {
      return state.frame
    }
    case 'unlocked': {
      return state.snapshot
    }
    case 'unavailable': {
      return state.frame
    }
  }
}

/**
 * The auto-retry budget left for a failure in this state. A manual Retry
 * restores the full budget; any other event spends the in-flight one, so
 * overlapping failures cannot retry forever.
 */
function retryBudgetFor(
  state: VaultViewState,
  eventKind: VaultViewEvent['kind'],
  retryBudget: number,
  failedReason?: VaultUnavailableReason,
): number {
  if (eventKind === 'userRetry') return retryBudget
  if (state.kind === 'loading') return state.retriesLeft ?? retryBudget
  return state.kind === 'unavailable' &&
    (failedReason === undefined || state.reason === failedReason)
    ? state.retriesLeft
    : retryBudget
}

function lastGoodOf(state: VaultViewState): VaultPanelState | undefined {
  switch (state.kind) {
    case 'loading': {
      return state.lastGood
    }
    case 'locked': {
      return undefined
    }
    case 'unlocked': {
      return state.snapshot
    }
    case 'unavailable': {
      return state.lastGood
    }
  }
}

function knownEpoch(state: VaultViewState): number {
  switch (state.kind) {
    case 'loading': {
      return state.lastGood?.status.lockEpoch ?? 0
    }
    case 'locked': {
      return state.lockEpoch
    }
    case 'unlocked': {
      return state.snapshot.status.lockEpoch
    }
    case 'unavailable': {
      return state.lastGood?.status.lockEpoch ?? state.frame.status.lockEpoch
    }
  }
}

/**
 * The optimistic Locked frame a `locked` event or this window's Lock paints
 * at once: no item labels, no grants, no audit, no pending, no importable
 * paths — a locked section never lists item names (RVCM1091F P2). The next
 * snapshot replaces it with the broker's own locked frame.
 */
export function lockedFrame(
  lastGood: VaultPanelState | undefined,
  lockEpoch: number,
): VaultPanelState {
  return {
    status: {
      state: 'locked',
      reason: 'locked',
      lockEpoch,
      tier: lastGood?.status.tier ?? null,
      provider: lastGood?.status.provider ?? null,
      silentUnlock: lastGood?.status.silentUnlock ?? false,
      itemCount: 0,
    },
    notices: lastGood?.notices,
    items: [],
    grants: [],
    audit: [],
    pending: [],
    ambientFiles: [],
  }
}

function unavailableFrame(
  lastGood: VaultPanelState | undefined,
  reason: VaultUnavailableReason,
): VaultPanelState {
  return {
    status: {
      state: 'unavailable',
      reason: vaultFrameReason(reason),
      lockEpoch: lastGood?.status.lockEpoch ?? 0,
      tier: null,
      provider: null,
      silentUnlock: false,
      itemCount: 0,
    },
    notices: lastGood?.notices,
    items: [],
    grants: [],
    audit: [],
    pending: [],
    ambientFiles: [],
  }
}

function isTransient(reason: VaultUnavailableReason): reason is VaultTransientReason {
  switch (reason) {
    case 'busy':
    case 'rollback':
    case 'timeout':
    case 'watchLost': {
      return true
    }
    default: {
      return false
    }
  }
}

function reasonForSnapshot(status: VaultPanelState['status']): VaultUnavailableReason {
  switch (status.reason) {
    case 'brokerBlocked': {
      return 'brokerCannotStart'
    }
    case 'slotUnavailable':
    case 'basicText':
    case 'rollback':
    case 'auditInvalid':
    case 'vaultLost': {
      return status.reason
    }
    case 'locked': {
      return 'unreachable'
    }
    case null: {
      switch (status.state) {
        case 'uncreated':
        case 'setupPending':
        case 'firstPartyOnly': {
          return status.state
        }
        default: {
          return 'unreachable'
        }
      }
    }
    default: {
      return 'unreachable'
    }
  }
}

function stateForSnapshot(
  snapshot: VaultPanelState,
  generation: number,
  lastGood: VaultPanelState | undefined,
  retriesLeft: number,
): VaultViewState {
  switch (snapshot.status.state) {
    case 'locked': {
      return {
        kind: 'locked',
        lockEpoch: snapshot.status.lockEpoch,
        generation,
        frame: snapshot,
        confirmed: true,
      }
    }
    case 'unlocked': {
      return { kind: 'unlocked', snapshot, generation }
    }
    case 'unavailable':
    case 'uncreated':
    case 'setupPending':
    case 'firstPartyOnly': {
      // The broker's own `brokerBlocked` verdict is the one true source of
      // the repair message; every other snapshot-carried reason keeps its
      // own name. A snapshot that names no reason is `unreachable`, never
      // a repair claim.
      const reason = reasonForSnapshot(snapshot.status)
      return {
        kind: 'unavailable',
        reason,
        generation,
        frame: snapshot,
        ...(lastGood !== undefined && { lastGood }),
        retriesLeft,
      }
    }
  }
}

/**
 * The ONE transition: (state, event, host generation) -> (state, effects).
 * No event is ever gated on an earlier one: every cell either publishes a
 * frame now or reloads (whose settle always publishes), so there is no
 * silent path. A stale snapshot (older generation, or an older broker
 * epoch) republishes the current view instead of overwriting it; a stale
 * failure still toasts — it is kept and shown, never dropped.
 */
export function applyVaultViewEvent(
  state: VaultViewState,
  event: VaultViewEvent,
  generation: number,
  retryBudget: number,
  retryDelayMs: number,
): VaultViewResult {
  const republish = (next: VaultViewState, toast: string | null = null): VaultViewResult => ({
    state: next,
    effects: { frame: currentFrame(next), toast, reload: false, retryInMs: null },
  })
  const reloadFrom = (
    lastGood: VaultPanelState | undefined,
    toast: string | null = null,
    retriesLeft?: number,
  ): VaultViewResult => ({
    state: {
      kind: 'loading',
      generation,
      ...(lastGood !== undefined && { lastGood }),
      ...(retriesLeft !== undefined && { retriesLeft }),
    },
    effects: { frame: lastGood ?? null, toast, reload: true, retryInMs: null },
  })

  switch (event.kind) {
    case 'brokerLocked': {
      // An older broker epoch cannot resurrect — or re-lock — a newer view,
      // but the event is still answered with a publish, never ignored.
      if (event.lockEpoch < knownEpoch(state)) return republish(state)
      const lastGood = lastGoodOf(state)
      const frame = lockedFrame(lastGood, event.lockEpoch)
      return {
        state: { kind: 'locked', lockEpoch: event.lockEpoch, generation, frame, confirmed: true },
        effects: { frame, toast: null, reload: true, retryInMs: null },
      }
    }
    case 'brokerUnlocked':
    case 'brokerChanged':
    case 'brokerApproval':
    case 'brokerRevoked':
    case 'watchRestored':
    case 'vaultReady': {
      return reloadFrom(lastGoodOf(state))
    }
    case 'watchLost': {
      // The stream is down; the broker may be fine. Keep the view, say the
      // operation failed, and reload to confirm what is true.
      return reloadFrom(lastGoodOf(state), UI_TEXT.vault.operationFailed)
    }
    case 'userLock': {
      // This window's Lock paints Locked at once (labels stripped) but
      // unconfirmed: the host's own lock-then-load settles the truth, and
      // `userLockConfirmed` records the Lock call returning. A re-pressed
      // Lock over broker-confirmed Locked keeps the confirmation. No reload
      // effect: the caller drives the operation, whose snapshot result
      // follows.
      const lastGood = lastGoodOf(state)
      const frame = lockedFrame(lastGood, knownEpoch(state))
      return {
        state: {
          kind: 'locked',
          lockEpoch: knownEpoch(state),
          generation,
          frame,
          confirmed: state.kind === 'locked' && state.confirmed,
        },
        effects: { frame, toast: null, reload: false, retryInMs: null },
      }
    }
    case 'userLockConfirmed': {
      // The Lock call returned, so the optimistic view is broker truth — but
      // only while this window's Lock still owns the view. Any other state
      // already moved on (a barrier retired the lock): republish it
      // unchanged, never resurrected. With no view at all, reload instead
      // of staying silent (the caller refreshes anyway).
      if (state.kind === 'locked' && !state.confirmed)
        return republish({ ...state, confirmed: true })
      if (currentFrame(state) === null)
        return {
          state,
          effects: { frame: null, toast: null, reload: true, retryInMs: null },
        }
      return republish(state)
    }
    case 'userUnlock':
    case 'userAdd':
    case 'userImport':
    case 'userDelete':
    case 'userRevoke': {
      // The caller drives the operation and feeds its snapshot result; the
      // view republishes meanwhile so the action is never silent. With no
      // view yet, the action itself loads one.
      const lastGood = lastGoodOf(state)
      return {
        state: {
          kind: 'loading',
          generation,
          ...(lastGood !== undefined && { lastGood }),
        },
        effects: {
          frame: lastGood ?? null,
          toast: null,
          reload: lastGood === undefined,
          retryInMs: null,
        },
      }
    }
    case 'userRetry':
    case 'autoRetry': {
      // A manual Retry restores the full budget; the scheduled one keeps
      // the remaining budget, so auto-retries stay bounded.
      return reloadFrom(lastGoodOf(state), null, retryBudgetFor(state, event.kind, retryBudget))
    }
    case 'snapshotOk': {
      // An older broker epoch cannot resurrect a locked panel either: the
      // snapshot is as superseded as an older generation.
      if (
        event.generation < state.generation ||
        event.snapshot.status.lockEpoch < knownEpoch(state)
      ) {
        // Superseded by a newer reload, whose settle publishes. With no
        // view at all, reload instead of staying silent.
        if (currentFrame(state) === null)
          return {
            state,
            effects: { frame: null, toast: null, reload: true, retryInMs: null },
          }
        return republish(state)
      }
      const next = stateForSnapshot(event.snapshot, generation, lastGoodOf(state), retryBudget)
      return {
        state: next,
        effects: { frame: currentFrame(next), toast: null, reload: false, retryInMs: null },
      }
    }
    case 'snapshotFailed': {
      if (state.kind === 'locked' && state.confirmed && event.generation >= state.generation) {
        // A confirmed locked view shows no item names, so a failed
        // confirmation keeps it instead of replacing known Locked with
        // Unavailable: republish the stripped frame and report — never
        // silently. An unconfirmed (optimistic) Locked falls through: the
        // Lock may have failed, so the failure below says Unavailable with
        // its true reason instead of claiming Locked.
        return {
          state,
          effects: {
            frame: state.frame,
            toast: vaultUnavailableMessage(event.reason) ?? UI_TEXT.vault.operationFailed,
            reload: false,
            retryInMs: isTransient(event.reason) ? retryDelayMs : null,
          },
        }
      }
      if (event.generation < state.generation) {
        // Stale, but never dropped: the current view republishes and the
        // failure is still shown. With no view at all, reload as well.
        if (currentFrame(state) === null)
          return {
            state,
            effects: {
              frame: null,
              toast: vaultUnavailableMessage(event.reason),
              reload: true,
              retryInMs: null,
            },
          }
        return republish(state, vaultUnavailableMessage(event.reason))
      }
      const lastGood = lastGoodOf(state)
      if (isTransient(event.reason)) {
        // A reload that a new event already superseded still spends from
        // the in-flight budget, so overlapping failures cannot retry forever.
        const left = retryBudgetFor(state, event.kind, retryBudget, event.reason)
        if (left > 0) {
          // Keep the last good view, say it is retrying, retry boundedly.
          const next: VaultViewState =
            lastGood === undefined
              ? {
                  kind: 'unavailable',
                  reason: event.reason,
                  generation,
                  frame: unavailableFrame(undefined, event.reason),
                  retriesLeft: left - 1,
                }
              : { kind: 'loading', generation, lastGood, retriesLeft: left - 1 }
          return {
            state: next,
            effects: {
              frame: currentFrame(next),
              toast: vaultUnavailableMessage(event.reason),
              reload: false,
              retryInMs: retryDelayMs,
            },
          }
        }
      }
      const frame = unavailableFrame(lastGood, event.reason)
      const next: VaultViewState = {
        kind: 'unavailable',
        reason: event.reason,
        generation,
        frame,
        ...(lastGood !== undefined && { lastGood }),
        retriesLeft: 0,
      }
      return {
        state: next,
        effects: {
          frame,
          toast: vaultUnavailableMessage(event.reason),
          reload: false,
          retryInMs: null,
        },
      }
    }
    // A new event without a row above fails here instead of falling silent.
    // (The cast reads the kind off the `never` the exhaustive switch leaves;
    // it is unreachable unless a union member lost its row.)
    default: {
      throw new Error(`vault view: unhandled event ${(event as VaultViewEvent).kind}`)
    }
  }
}
