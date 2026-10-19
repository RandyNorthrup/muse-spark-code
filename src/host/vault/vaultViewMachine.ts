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
Why the section is unavailable. `brokerCannotStart` is the ONLY reason
that shows the repair sentence, and it is only reached from the broker's
own `brokerBlocked` verdict (never synthesized from a busy/rollback/io
failure). `uncreated`, `setupPending` and `firstPartyOnly` are normal
snapshots the broker returns, each named so no new snapshot state falls
through to a repair claim.
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

/**
The closed state union: a new kind without a table row fails the test
(the exhaustive table derives its rows from these members, and the
transition's default branch asserts `never`, so a member without a row
does not compile).
*/
export type VaultViewState =
  | {
      readonly kind: 'loading'
      readonly generation: number
      readonly lastGood?: VaultPanelState
      /** Remaining auto-retries if the in-flight reload fails transiently. */
      readonly retriesLeft?: number
      /**
      The newest reload this view asked for. A snapshot reply is applied
      only when it answers the newest request: overlapping reloads share
      one generation (two approval cards), so the generation alone cannot
      tell an older reply from a newer one (RVCM1091G P2).
      */
      readonly request?: number
    }
  | {
      readonly kind: 'locked'
      readonly lockEpoch: number
      readonly generation: number
      readonly frame: VaultPanelState
      /**
      True once the broker confirmed the lock (its event, a locked
      snapshot, or this window's own Lock call returning). An optimistic
      Locked painted from this window's in-flight Lock is unconfirmed: a
      snapshot failure there says Unavailable (the lock may have failed),
      while a confirmed one keeps Locked (RVCM1091F: a failed Lock with no
      snapshot is Unavailable; a Lock that succeeded while the snapshot is
      down stays Locked).
      */
      readonly confirmed: boolean
      /** The newest reload requested while this view lives (see above). */
      readonly request?: number
    }
  | {
      readonly kind: 'unlocked'
      readonly snapshot: VaultPanelState
      readonly generation: number
      /** The newest reload requested while this view lives (see above). */
      readonly request?: number
    }
  | {
      readonly kind: 'unavailable'
      readonly reason: VaultUnavailableReason
      readonly generation: number
      readonly frame: VaultPanelState
      readonly lastGood?: VaultPanelState
      readonly retriesLeft: number
      /** The newest reload requested while this view lives (see above). */
      readonly request?: number
    }

/** Every state kind, for the exhaustive table test. */
export const VAULT_VIEW_STATES = ['loading', 'locked', 'unlocked', 'unavailable'] as const

/**
The closed event union: every broker event, every user action and every
snapshot result. `brokerUnlocked` is the broker's post-unlock change as
this window observes it; `watchRestored` is a reopened stream's first
change; `autoRetry` is the machine's own bounded retry (it never resets
the budget — only `userRetry` does).
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
  /**
  The host records each reload request inside the machine, before the
  snapshot call starts. A reply carries the request it answers; only the
  newest requested reply is applied (RVCM1091G P2).
  */
  | { readonly kind: 'reloadRequested'; readonly seq: number }
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
      /** The reload request this reply answers (see `reloadRequested`). */
      readonly seq: number
      readonly snapshot: VaultPanelState
    }
  | {
      readonly kind: 'snapshotFailed'
      readonly generation: number
      /** The reload request this reply answers (see `reloadRequested`). */
      readonly seq: number
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
  'reloadRequested',
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

/**
The sentence each unavailable reason toasts; null means no toast. A
table, not code: a new reason without a row does not compile, so no
failure can fall through to the repair message by accident (RVCM1091G P2).
*/
function unavailableToastTable(): Record<VaultUnavailableReason, string | null> {
  // Built on use, never at module load: the installed language is the one
  // shown (PLAN.md D33).
  return {
    busy: UI_TEXT.vault.busy,
    rollback: UI_TEXT.vault.rollback,
    timeout: UI_TEXT.vault.operationFailed,
    watchLost: UI_TEXT.vault.operationFailed,
    unreachable: UI_TEXT.vault.operationFailed,
    brokerCannotStart: UI_TEXT.vault.brokerBlocked,
    storeUnavailable: UI_TEXT.vault.storeUnavailable,
    vaultLost: UI_TEXT.vault.vaultLost,
    auditInvalid: UI_TEXT.vault.auditInvalid,
    slotUnavailable: UI_TEXT.vault.slotUnavailable,
    basicText: UI_TEXT.vault.basicText,
    uncreated: null,
    setupPending: null,
    firstPartyOnly: null,
  }
}

export function vaultUnavailableMessage(reason: VaultUnavailableReason): string | null {
  return unavailableToastTable()[reason]
}

/**
The status reason an exhausted unavailable frame carries. Transient
host-side reasons need their own names so they never borrow the repair
sentence; `brokerCannotStart` keeps the broker's own `brokerBlocked`.
A table for the same reason as above.
*/
function frameReasonTable(): Record<VaultUnavailableReason, VaultStatus['reason']> {
  return {
    brokerCannotStart: 'brokerBlocked',
    unreachable: 'unreachable',
    timeout: 'timeout',
    watchLost: 'watchLost',
    busy: 'busy',
    storeUnavailable: 'storeUnavailable',
    rollback: 'rollback',
    vaultLost: 'vaultLost',
    auditInvalid: 'auditInvalid',
    slotUnavailable: 'slotUnavailable',
    basicText: 'basicText',
    uncreated: null,
    setupPending: null,
    firstPartyOnly: null,
  }
}

export function vaultFrameReason(reason: VaultUnavailableReason): VaultStatus['reason'] {
  return frameReasonTable()[reason]
}

/**
One read of what a view shows, keeps and knows: the frame on screen, the
last good snapshot and the newest broker epoch. A single row per state
kind replaces the three per-kind switches this file used to carry.
*/
function describeView(state: VaultViewState): {
  readonly frame: VaultPanelState | null
  readonly lastGood: VaultPanelState | undefined
  readonly epoch: number
} {
  switch (state.kind) {
    case 'loading': {
      return {
        frame: state.lastGood ?? null,
        lastGood: state.lastGood,
        epoch: state.lastGood?.status.lockEpoch ?? 0,
      }
    }
    case 'locked': {
      return { frame: state.frame, lastGood: undefined, epoch: state.lockEpoch }
    }
    case 'unlocked': {
      return {
        frame: state.snapshot,
        lastGood: state.snapshot,
        epoch: state.snapshot.status.lockEpoch,
      }
    }
    case 'unavailable': {
      return {
        frame: state.frame,
        lastGood: state.lastGood,
        epoch: state.lastGood?.status.lockEpoch ?? state.frame.status.lockEpoch,
      }
    }
  }
}

/** The frame this view currently shows, if it has shown one yet. */
export function vaultViewFrame(state: VaultViewState): VaultPanelState | null {
  return describeView(state).frame
}

/**
The auto-retry budget left for a failure in this state. A manual Retry
restores the full budget; any other event spends the in-flight one, so
overlapping failures cannot retry forever.
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

/**
The optimistic Locked frame a `locked` event or this window's Lock paints
at once: no item labels, no grants, no audit, no pending, no importable
paths — a locked section never lists item names (RVCM1091F P2). The next
snapshot replaces it with the broker's own locked frame.
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
  // The same stripped shape as a locked frame, but nothing about it claims
  // an observed slot: the tier, provider and silent unlock stay empty until
  // a snapshot observes them again.
  const stripped = lockedFrame(lastGood, lastGood?.status.lockEpoch ?? 0)
  return {
    ...stripped,
    status: {
      ...stripped.status,
      state: 'unavailable',
      reason: vaultFrameReason(reason),
      tier: null,
      provider: null,
      silentUnlock: false,
    },
  }
}

const TRANSIENT_REASONS: ReadonlySet<VaultUnavailableReason> = new Set<VaultUnavailableReason>([
  'busy',
  'rollback',
  'timeout',
  'watchLost',
])

function isTransient(reason: VaultUnavailableReason): reason is VaultTransientReason {
  return TRANSIENT_REASONS.has(reason)
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
  request: number | undefined,
): VaultViewState {
  switch (snapshot.status.state) {
    case 'locked': {
      return {
        kind: 'locked',
        lockEpoch: snapshot.status.lockEpoch,
        generation,
        frame: snapshot,
        confirmed: true,
        ...(request !== undefined && { request }),
      }
    }
    case 'unlocked': {
      return { kind: 'unlocked', snapshot, generation, ...(request !== undefined && { request }) }
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
        ...(request !== undefined && { request }),
      }
    }
  }
}

/**
The ONE transition: (state, event, host generation) -> (state, effects).
No event is ever gated on an earlier one: every cell either publishes a
frame now or reloads (whose settle always publishes), so there is no
silent path. A stale snapshot (older generation, or an older broker
epoch) republishes the current view instead of overwriting it; a stale
failure still toasts — it is kept and shown, never dropped.
*/
export function applyVaultViewEvent(
  state: VaultViewState,
  event: VaultViewEvent,
  generation: number,
  retryBudget: number,
  retryDelayMs: number,
): VaultViewResult {
  const seen = describeView(state)
  const republish = (next: VaultViewState, toast: string | null = null): VaultViewResult => ({
    state: next,
    effects: { frame: describeView(next).frame, toast, reload: false, retryInMs: null },
  })
  const reloadFrom = (
    lastGood: VaultPanelState | undefined,
    toast: string | null = null,
    retriesLeft?: number,
    request?: number,
  ): VaultViewResult => ({
    state: {
      kind: 'loading',
      generation,
      ...(lastGood !== undefined && { lastGood }),
      ...(retriesLeft !== undefined && { retriesLeft }),
      ...(request !== undefined && { request }),
    },
    effects: { frame: lastGood ?? null, toast, reload: true, retryInMs: null },
  })
  /** An older reply never overwrites a newer request (RVCM1091G P2). */
  const isStaleReply = (seq: number): boolean => state.request !== undefined && seq < state.request

  switch (event.kind) {
    case 'brokerLocked': {
      // An older broker epoch cannot resurrect — or re-lock — a newer view,
      // but the event is still answered with a publish, never ignored.
      if (event.lockEpoch < seen.epoch) return republish(state)
      const frame = lockedFrame(seen.lastGood, event.lockEpoch)
      return {
        state: {
          kind: 'locked',
          lockEpoch: event.lockEpoch,
          generation,
          frame,
          confirmed: true,
          ...(state.request !== undefined && { request: state.request }),
        },
        effects: { frame, toast: null, reload: true, retryInMs: null },
      }
    }
    case 'brokerUnlocked':
    case 'brokerChanged':
    case 'brokerApproval':
    case 'brokerRevoked':
    case 'watchRestored':
    case 'vaultReady': {
      return reloadFrom(seen.lastGood, null, undefined, state.request)
    }
    case 'watchLost': {
      // The stream is down; the broker may be fine. Keep the view, say the
      // operation failed, and reload to confirm what is true.
      return reloadFrom(seen.lastGood, UI_TEXT.vault.operationFailed, undefined, state.request)
    }
    case 'reloadRequested': {
      // The host's own record of a new reload request: the in-flight reply
      // for an older request is stale from here on, whichever lands first.
      // The view itself is untouched — a confirmed Locked in particular
      // survives its own confirmation snapshot failing — and republishes
      // (or asks for a reload when nothing is shown yet, which beginReload's
      // own load covers since it always starts one), so the request is never
      // silent.
      const request = state.request === undefined ? event.seq : Math.max(state.request, event.seq)
      const next: VaultViewState = { ...state, request }
      const frame = describeView(next).frame
      return {
        state: next,
        effects: { frame, toast: null, reload: frame === null, retryInMs: null },
      }
    }
    case 'userLock': {
      // This window's Lock paints Locked at once (labels stripped) but
      // unconfirmed: the host's own lock-then-load settles the truth, and
      // `userLockConfirmed` records the Lock call returning. A re-pressed
      // Lock over broker-confirmed Locked keeps the confirmation. No reload
      // effect: the caller drives the operation, whose snapshot result
      // follows.
      const frame = lockedFrame(seen.lastGood, seen.epoch)
      return {
        state: {
          kind: 'locked',
          lockEpoch: seen.epoch,
          generation,
          frame,
          confirmed: state.kind === 'locked' && state.confirmed,
          ...(state.request !== undefined && { request: state.request }),
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
      if (seen.frame === null)
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
      return {
        state: {
          kind: 'loading',
          generation,
          ...(seen.lastGood !== undefined && { lastGood: seen.lastGood }),
          ...(state.request !== undefined && { request: state.request }),
        },
        effects: {
          frame: seen.lastGood ?? null,
          toast: null,
          reload: seen.lastGood === undefined,
          retryInMs: null,
        },
      }
    }
    case 'userRetry':
    case 'autoRetry': {
      // A manual Retry restores the full budget; the scheduled one keeps
      // the remaining budget, so auto-retries stay bounded.
      return reloadFrom(
        seen.lastGood,
        null,
        retryBudgetFor(state, event.kind, retryBudget),
        state.request,
      )
    }
    case 'snapshotOk': {
      // An older broker epoch cannot resurrect a locked panel either: the
      // snapshot is as superseded as an older generation — and a reply to
      // an older reload request never overwrites the newest one, whichever
      // lands first (RVCM1091G P2).
      if (
        event.generation < state.generation ||
        event.snapshot.status.lockEpoch < seen.epoch ||
        isStaleReply(event.seq)
      ) {
        // Superseded by a newer reload, whose settle publishes. With no
        // view at all, reload instead of staying silent.
        if (seen.frame === null)
          return {
            state,
            effects: { frame: null, toast: null, reload: true, retryInMs: null },
          }
        return republish(state)
      }
      const next = stateForSnapshot(
        event.snapshot,
        generation,
        seen.lastGood,
        retryBudget,
        event.seq,
      )
      return {
        state: next,
        effects: { frame: describeView(next).frame, toast: null, reload: false, retryInMs: null },
      }
    }
    case 'snapshotFailed': {
      const isStale = event.generation < state.generation || isStaleReply(event.seq)
      if (!isStale && state.kind === 'locked' && state.confirmed) {
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
      if (isStale) {
        // Stale, but never dropped: the current view republishes and the
        // failure is still shown. With no view at all, reload as well.
        if (seen.frame === null)
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
      if (isTransient(event.reason)) {
        // A reload that a new event already superseded still spends from
        // the in-flight budget, so overlapping failures cannot retry forever.
        const left = retryBudgetFor(state, event.kind, retryBudget, event.reason)
        if (left > 0) {
          // Keep the last good view, say it is retrying, retry boundedly.
          const next: VaultViewState =
            seen.lastGood === undefined
              ? {
                  kind: 'unavailable',
                  reason: event.reason,
                  generation,
                  frame: unavailableFrame(undefined, event.reason),
                  retriesLeft: left - 1,
                  request: event.seq,
                }
              : {
                  kind: 'loading',
                  generation,
                  lastGood: seen.lastGood,
                  retriesLeft: left - 1,
                  request: event.seq,
                }
          return {
            state: next,
            effects: {
              frame: describeView(next).frame,
              toast: vaultUnavailableMessage(event.reason),
              reload: false,
              retryInMs: retryDelayMs,
            },
          }
        }
      }
      const frame = unavailableFrame(seen.lastGood, event.reason)
      const next: VaultViewState = {
        kind: 'unavailable',
        reason: event.reason,
        generation,
        frame,
        ...(seen.lastGood !== undefined && { lastGood: seen.lastGood }),
        retriesLeft: 0,
        request: event.seq,
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
    // A new event without a row above fails the build instead of falling
    // silent: the assignment below only compiles while every union member
    // has its row (RVCM1091G P3).
    default: {
      const unhandled: never = event
      throw new Error(`vault view: unhandled event ${String(unhandled)}`)
    }
  }
}
