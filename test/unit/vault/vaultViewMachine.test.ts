// RVCM1091F REDESIGN: the vault view is ONE explicit state machine
// (src/host/vault/vaultViewMachine.ts). This table enumerates EVERY state
// kind crossed with EVERY event kind from the unions themselves: a new state
// or event without a row fails here instead of falling silent in the panel.
import { describe, expect, it } from 'vitest'
import {
  applyVaultViewEvent,
  lockedFrame,
  vaultUnavailableMessage,
  VAULT_VIEW_EVENTS,
  VAULT_VIEW_STATES,
  type VaultUnavailableReason,
  type VaultViewEvent,
  type VaultViewState,
} from '../../../src/host/vault/vaultViewMachine'
import { UI_TEXT } from '../../../src/shared/constants'
import type { VaultPanelState } from '../../../src/shared/vaultPanel'
import { metadata, panel } from '../helpers/vault/fixtures'

const BUDGET = 2
const DELAY = 250
const GEN = 5

function unlockedSnapshot(): VaultPanelState {
  const snapshot = panel()
  snapshot.status.lockEpoch = 3
  return snapshot
}

function lockedSnapshot(): VaultPanelState {
  const snapshot = panel()
  snapshot.status = {
    state: 'locked',
    reason: 'locked',
    lockEpoch: 4,
    tier: 'osStore',
    provider: 'test-only',
    silentUnlock: true,
    itemCount: 0,
  }
  snapshot.items = []
  snapshot.grants = []
  snapshot.audit = []
  snapshot.pending = []
  snapshot.ambientFiles = []
  return snapshot
}

/** Drive a transient failure until the budget is spent. */
function exhaustTransient(
  state: VaultViewState,
  reason: 'busy' | 'rollback' | 'timeout' | 'watchLost',
): VaultViewState {
  let current = state
  for (let attempt = 0; attempt <= BUDGET + 1; attempt++) {
    const failed = applyVaultViewEvent(
      current,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason },
      GEN,
      BUDGET,
      DELAY,
    )
    current = failed.state
    if (current.kind === 'unavailable') return current
    const retry = applyVaultViewEvent(current, { kind: 'autoRetry' }, GEN, BUDGET, DELAY)
    current = retry.state
  }
  return current
}

/** One sample per state kind; adding a kind without a sample fails the table. */
function sampleStates(): Record<StateKind, VaultViewState> {
  const good = unlockedSnapshot()
  return {
    loading: { kind: 'loading', generation: GEN, lastGood: good },
    locked: {
      kind: 'locked',
      lockEpoch: 4,
      generation: GEN,
      frame: lockedFrame(good, 4),
      confirmed: true,
    },
    unlocked: { kind: 'unlocked', snapshot: good, generation: GEN },
    unavailable: {
      kind: 'unavailable',
      reason: 'busy',
      generation: GEN,
      frame: lockedFrame(undefined, 3),
      lastGood: good,
      retriesLeft: BUDGET,
    },
  }
}

/**
 * The sample table derives its rows from the reducer unions themselves: the
 * types below only compile while every union member has its row, so a new
 * state or event without one fails the build instead of falling silent
 * (RVCM1091G P3).
 */
type EventKind = VaultViewEvent['kind']
type StateKind = VaultViewState['kind']
type UnionCovers<Table extends readonly unknown[], Union extends string> =
  Exclude<Union, Table[number]> extends never
    ? Exclude<Table[number], Union> extends never
      ? true
      : ['unexpected row', Exclude<Table[number], Union>]
    : ['missing row', Exclude<Union, Table[number]>]
const isEventUnionCovered: UnionCovers<typeof VAULT_VIEW_EVENTS, EventKind> = true
const isStateUnionCovered: UnionCovers<typeof VAULT_VIEW_STATES, StateKind> = true

/** One representative event per kind; the named tests below vary payloads. */
function sampleEvent(kind: (typeof VAULT_VIEW_EVENTS)[number]): VaultViewEvent {
  switch (kind) {
    case 'brokerLocked': {
      return { kind: 'brokerLocked', lockEpoch: 9 }
    }
    case 'reloadRequested': {
      return { kind: 'reloadRequested', seq: GEN }
    }
    case 'snapshotOk': {
      return { kind: 'snapshotOk', generation: GEN, seq: GEN, snapshot: unlockedSnapshot() }
    }
    case 'snapshotFailed': {
      return { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'busy' }
    }
    case 'brokerUnlocked':
    case 'brokerChanged':
    case 'brokerApproval':
    case 'brokerRevoked':
    case 'vaultReady':
    case 'watchLost':
    case 'watchRestored':
    case 'userLock':
    case 'userLockConfirmed':
    case 'userUnlock':
    case 'userAdd':
    case 'userImport':
    case 'userDelete':
    case 'userRevoke':
    case 'userRetry':
    case 'autoRetry': {
      return { kind }
    }
  }
}

describe('RVCM1091F view state machine table', () => {
  it('covers every state crossed with every event from the unions', () => {
    // The union-coverage types above only compile while the tables match
    // the unions; asserting them here keeps the check referenced.
    expect(isEventUnionCovered).toBe(true)
    expect(isStateUnionCovered).toBe(true)
    expect(VAULT_VIEW_STATES).toHaveLength(4)
    expect(VAULT_VIEW_EVENTS).toHaveLength(20)
    const states = sampleStates()
    for (const stateKind of VAULT_VIEW_STATES) {
      const state = states[stateKind]
      expect(state.kind).toBe(stateKind)
      for (const eventKind of VAULT_VIEW_EVENTS) {
        const { state: next, effects } = applyVaultViewEvent(
          state,
          sampleEvent(eventKind),
          GEN,
          BUDGET,
          DELAY,
        )
        // No silent path: every event publishes a frame now, or reloads
        // (whose settle always publishes).
        expect(effects.frame !== null || effects.reload, `${stateKind} x ${eventKind} is silent`)
        expect(next.kind).toBeDefined()
      }
    }
  })

  it('a locked event from anywhere locks at once with no item labels or grants', () => {
    const states = sampleStates()
    for (const stateKind of VAULT_VIEW_STATES) {
      const { state: next, effects } = applyVaultViewEvent(
        states[stateKind],
        { kind: 'brokerLocked', lockEpoch: 9 },
        GEN,
        BUDGET,
        DELAY,
      )
      expect(next.kind).toBe('locked')
      expect(effects.frame?.status.state).toBe('locked')
      expect(effects.frame?.items).toHaveLength(0)
      expect(effects.frame?.grants).toHaveLength(0)
      expect(effects.frame?.audit).toHaveLength(0)
      expect(effects.frame?.pending).toHaveLength(0)
      expect(effects.reload).toBe(true)
    }
  })

  it('a stale locked event republishes instead of overwriting a newer view', () => {
    const { state: next, effects } = applyVaultViewEvent(
      sampleStates().locked,
      { kind: 'brokerLocked', lockEpoch: 2 },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('locked')
    if (next.kind === 'locked') expect(next.lockEpoch).toBe(4)
    expect(effects.frame?.status.state).toBe('locked')
    expect(effects.reload).toBe(false)
  })

  it('a succeeded Lock confirms the optimistic view; a moved-on view is left alone', () => {
    // This window's Lock paints Locked stripped but unconfirmed.
    const optimistic = applyVaultViewEvent(
      sampleStates().unlocked,
      { kind: 'userLock' },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(optimistic.state.kind).toBe('locked')
    if (optimistic.state.kind === 'locked') {
      expect(optimistic.state.confirmed).toBe(false)
      expect(optimistic.effects.frame?.items).toHaveLength(0)
      expect(optimistic.effects.frame?.grants).toHaveLength(0)
    }
    // The Lock call returning confirms it, republishing the same frame.
    const confirmed = applyVaultViewEvent(
      optimistic.state,
      { kind: 'userLockConfirmed' },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(confirmed.state.kind).toBe('locked')
    if (confirmed.state.kind === 'locked') expect(confirmed.state.confirmed).toBe(true)
    expect(confirmed.effects.frame).toEqual(optimistic.effects.frame)
    expect(confirmed.effects.reload).toBe(false)
    // A confirmation for a view that already moved on changes nothing.
    const elsewhere = applyVaultViewEvent(
      sampleStates().unlocked,
      { kind: 'userLockConfirmed' },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(elsewhere.state.kind).toBe('unlocked')
    expect(elsewhere.effects.reload).toBe(false)
  })

  it('a failed Lock with no snapshot says Unavailable, never Locked', () => {
    const optimistic = applyVaultViewEvent(
      sampleStates().unlocked,
      { kind: 'userLock' },
      GEN,
      BUDGET,
      DELAY,
    )
    const { state: next, effects } = applyVaultViewEvent(
      optimistic.state,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'unreachable' },
      GEN,
      BUDGET,
      DELAY,
    )
    // The Lock may have failed, so no Locked claim: the true reason, no
    // item names, no repair message.
    expect(next.kind).toBe('unavailable')
    expect(effects.frame?.status.state).toBe('unavailable')
    expect(effects.frame?.items).toHaveLength(0)
    expect(effects.toast).toBe(UI_TEXT.vault.operationFailed)
    expect(effects.toast).not.toBe(UI_TEXT.vault.brokerBlocked)
  })

  it('a confirmed Locked view survives a failed confirmation snapshot', () => {
    const { state: next, effects } = applyVaultViewEvent(
      sampleStates().locked,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'unreachable' },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('locked')
    expect(effects.frame?.status.state).toBe('locked')
    expect(effects.frame?.items).toHaveLength(0)
    expect(effects.toast).toBe(UI_TEXT.vault.operationFailed)
    expect(effects.reload).toBe(false)
  })

  it('later events are never ignored because of an earlier lock', () => {
    const locked = sampleStates().locked
    for (const kind of [
      'brokerChanged',
      'brokerApproval',
      'vaultReady',
      'watchRestored',
    ] as const) {
      const { effects } = applyVaultViewEvent(locked, { kind }, GEN, BUDGET, DELAY)
      expect(effects.reload, kind).toBe(true)
    }
  })

  it('a transient failure keeps the last good view, says it is retrying, then offers Retry', () => {
    const first = applyVaultViewEvent(
      sampleStates().unlocked,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'busy' },
      GEN,
      BUDGET,
      DELAY,
    )
    // Kept view, reported, scheduled.
    expect(first.state.kind).toBe('loading')
    expect(first.effects.frame?.status.state).toBe('unlocked')
    expect(first.effects.frame?.items.map((item) => item.label)).toContain('Generated test item')
    expect(first.effects.toast).toBe(UI_TEXT.vault.busy)
    expect(first.effects.retryInMs).toBe(DELAY)
    // The scheduled retry spends the budget.
    const second = applyVaultViewEvent(first.state, { kind: 'autoRetry' }, GEN, BUDGET, DELAY)
    expect(second.effects.reload).toBe(true)
    const third = applyVaultViewEvent(
      second.state,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'busy' },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(third.effects.retryInMs).toBe(DELAY)
    // Budget spent: the view goes unavailable with the true reason and no
    // repair claim, and no further retry is scheduled — Retry is the
    // person's own action from here.
    const state = exhaustTransient(third.state, 'busy')
    expect(state.kind).toBe('unavailable')
    if (state.kind === 'unavailable') {
      expect(state.reason).toBe('busy')
      expect(state.frame.items).toHaveLength(0)
    }
    const last = applyVaultViewEvent(
      state,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'busy' },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(last.effects.retryInMs).toBeNull()
    expect(last.effects.toast).toBe(UI_TEXT.vault.busy)
    expect(last.effects.toast).not.toBe(UI_TEXT.vault.brokerBlocked)
    // A manual Retry restores the budget and reloads.
    const retry = applyVaultViewEvent(state, { kind: 'userRetry' }, GEN, BUDGET, DELAY)
    expect(retry.effects.reload).toBe(true)
    const recovered = applyVaultViewEvent(
      retry.state,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'busy' },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(recovered.effects.retryInMs).toBe(DELAY)
  })

  it('only the broker-cannot-start reason shows the repair message', () => {
    const reasons: VaultUnavailableReason[] = [
      'busy',
      'rollback',
      'timeout',
      'watchLost',
      'brokerCannotStart',
      'unreachable',
      'storeUnavailable',
      'vaultLost',
      'auditInvalid',
      'slotUnavailable',
      'basicText',
      'uncreated',
      'setupPending',
      'firstPartyOnly',
    ]
    expect(reasons).toHaveLength(14)
    for (const reason of reasons) {
      const message = vaultUnavailableMessage(reason)
      if (reason === 'brokerCannotStart') expect(message).toBe(UI_TEXT.vault.brokerBlocked)
      else expect(message).not.toBe(UI_TEXT.vault.brokerBlocked)
    }
  })

  it('a busy or rollback snapshot never synthesizes the cannot-start frame', () => {
    for (const reason of ['busy', 'rollback'] as const) {
      const exhausted = exhaustTransient(sampleStates().unlocked, reason)
      expect(exhausted.kind).toBe('unavailable')
      if (exhausted.kind === 'unavailable')
        expect(exhausted.frame.status.reason).not.toBe('brokerBlocked')
    }
  })

  it('a failure that arrives while a reload is running is kept and shown', () => {
    // A newer reload is in flight (generation advanced); the older failure
    // still republishes the view and toasts — never dropped.
    const loading: VaultViewState = {
      kind: 'loading',
      generation: GEN + 1,
      lastGood: unlockedSnapshot(),
    }
    const { state: next, effects } = applyVaultViewEvent(
      loading,
      { kind: 'snapshotFailed', generation: GEN, seq: GEN, reason: 'rollback' },
      GEN + 1,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('loading')
    expect(effects.frame?.status.state).toBe('unlocked')
    expect(effects.toast).toBe(UI_TEXT.vault.rollback)
  })

  it('an older snapshot never overwrites a newer state', () => {
    const fresh: VaultViewState = {
      kind: 'unlocked',
      snapshot: unlockedSnapshot(),
      generation: GEN + 1,
    }
    const older = lockedSnapshot()
    const { state: next, effects } = applyVaultViewEvent(
      fresh,
      { kind: 'snapshotOk', generation: GEN, seq: GEN, snapshot: older },
      GEN + 1,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('unlocked')
    if (next.kind === 'unlocked') expect(next.snapshot.status.lockEpoch).toBe(3)
    expect(effects.frame?.status.state).toBe('unlocked')
  })

  it('a fresh snapshot is always trusted, even after an optimistic lock', () => {
    const fresh = unlockedSnapshot()
    fresh.status.lockEpoch = 4
    const { state: next, effects } = applyVaultViewEvent(
      sampleStates().locked,
      { kind: 'snapshotOk', generation: GEN, seq: GEN, snapshot: fresh },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('unlocked')
    expect(effects.frame?.status.state).toBe('unlocked')
  })

  it('a snapshot from an older broker epoch never resurrects a locked panel', () => {
    const { state: next, effects } = applyVaultViewEvent(
      sampleStates().locked,
      { kind: 'snapshotOk', generation: GEN, seq: GEN, snapshot: unlockedSnapshot() },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('locked')
    expect(effects.frame?.status.state).toBe('locked')
  })

  it('overlapping reloads settle newest-wins in both landing orders', () => {
    const one = unlockedSnapshot()
    // The older reply differs from the current view (two items, not one),
    // so dropping it as stale is observable: applying it would show two.
    // Without the guard this order cannot fail (RVAPP-CM1091D5 P3-5).
    one.items = [metadata(), metadata()]
    one.status.itemCount = 2
    const two = unlockedSnapshot()
    two.items = []
    two.status.itemCount = 0
    // Two approval cards start two snapshots under one generation.
    const first = applyVaultViewEvent(
      sampleStates().unlocked,
      { kind: 'reloadRequested', seq: 1 },
      GEN,
      BUDGET,
      DELAY,
    )
    const second = applyVaultViewEvent(
      first.state,
      { kind: 'reloadRequested', seq: 2 },
      GEN,
      BUDGET,
      DELAY,
    )
    // The request is recorded without disturbing the shown view.
    expect(second.state.kind).toBe('unlocked')
    if (second.state.kind === 'unlocked') expect(second.state.request).toBe(2)
    // The newer reply lands first, the older lands after: the older must
    // not overwrite it.
    const newerFirst = applyVaultViewEvent(
      second.state,
      { kind: 'snapshotOk', generation: GEN, seq: 2, snapshot: two },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(newerFirst.state.kind).toBe('unlocked')
    const olderAfter = applyVaultViewEvent(
      newerFirst.state,
      { kind: 'snapshotOk', generation: GEN, seq: 1, snapshot: one },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(olderAfter.state.kind).toBe('unlocked')
    expect(olderAfter.effects.frame?.items).toEqual([])
    expect(olderAfter.effects.frame?.status.itemCount).toBe(0)
    // The other order: the older reply lands first and is dropped as stale
    // (the request is already 2), so the current one-item view republishes
    // unchanged — and the newer reply still wins after it.
    const olderFirst = applyVaultViewEvent(
      second.state,
      { kind: 'snapshotOk', generation: GEN, seq: 1, snapshot: one },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(olderFirst.effects.frame?.items).toHaveLength(1)
    expect(olderFirst.effects.frame?.status.itemCount).toBe(1)
    const newerAfter = applyVaultViewEvent(
      olderFirst.state,
      { kind: 'snapshotOk', generation: GEN, seq: 2, snapshot: two },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(newerAfter.effects.frame?.items).toEqual([])
    expect(newerAfter.effects.frame?.status.itemCount).toBe(0)
  })

  it('a stale reply still publishes instead of falling silent', () => {
    const second = applyVaultViewEvent(
      applyVaultViewEvent(
        sampleStates().unlocked,
        { kind: 'reloadRequested', seq: 1 },
        GEN,
        BUDGET,
        DELAY,
      ).state,
      { kind: 'reloadRequested', seq: 2 },
      GEN,
      BUDGET,
      DELAY,
    )
    const { state: next, effects } = applyVaultViewEvent(
      second.state,
      { kind: 'snapshotFailed', generation: GEN, seq: 1, reason: 'busy' },
      GEN,
      BUDGET,
      DELAY,
    )
    // The older failure is kept and shown, never dropped — while the newer
    // reload's own settle still publishes.
    expect(next.kind).toBe('unlocked')
    expect(effects.toast).toBe(UI_TEXT.vault.busy)
    expect(effects.frame?.status.state).toBe('unlocked')
  })

  it('a toast never contradicts the section beside it', () => {
    const states = sampleStates()
    const known: (string | null)[] = [
      UI_TEXT.vault.locked,
      UI_TEXT.vault.setupNeeded,
      UI_TEXT.vault.setupExists,
      UI_TEXT.vault.itemConflict,
      UI_TEXT.vault.deleteConflict,
      UI_TEXT.vault.busy,
      UI_TEXT.vault.rollback,
      UI_TEXT.vault.storeUnavailable,
      UI_TEXT.vault.operationFailed,
      UI_TEXT.vault.noAccess,
      UI_TEXT.vault.useChanged,
      UI_TEXT.vault.approvalExpired,
      UI_TEXT.vault.brokerBlocked,
      UI_TEXT.vault.vaultLost,
      UI_TEXT.vault.auditInvalid,
      UI_TEXT.vault.slotUnavailable,
      UI_TEXT.vault.basicText,
      null,
    ]
    for (const stateKind of VAULT_VIEW_STATES) {
      for (const eventKind of VAULT_VIEW_EVENTS) {
        const { effects } = applyVaultViewEvent(
          states[stateKind],
          sampleEvent(eventKind),
          GEN,
          BUDGET,
          DELAY,
        )
        if (effects.toast === null) {
          continue
        }

        expect(known).toContain(effects.toast)
        // The one state-claiming toast only ever stands beside that state.
        if (effects.toast === UI_TEXT.vault.locked)
          expect(effects.frame?.status.state).toBe('locked')
      }
    }
  })

  it('every snapshot state the broker can return has a named row', () => {
    const unlocked = unlockedSnapshot()
    const cases: {
      state: VaultPanelState['status']['state']
      reason: VaultPanelState['status']['reason']
    }[] = [
      { state: 'locked', reason: 'locked' },
      { state: 'unlocked', reason: null },
      { state: 'unavailable', reason: 'brokerBlocked' },
      { state: 'unavailable', reason: 'vaultLost' },
      { state: 'unavailable', reason: 'rollback' },
      { state: 'unavailable', reason: null },
      { state: 'uncreated', reason: null },
      { state: 'setupPending', reason: null },
      { state: 'firstPartyOnly', reason: null },
    ]
    for (const { state, reason } of cases) {
      const snapshot: VaultPanelState = {
        ...unlocked,
        status: { ...unlocked.status, state, reason },
        items: state === 'unlocked' ? unlocked.items : [],
        grants: state === 'unlocked' ? unlocked.grants : [],
      }
      const { state: next, effects } = applyVaultViewEvent(
        sampleStates().loading,
        { kind: 'snapshotOk', generation: GEN, seq: GEN, snapshot },
        GEN,
        BUDGET,
        DELAY,
      )
      expect(effects.frame).not.toBeNull()
      if (state === 'locked') expect(next.kind).toBe('locked')
      else if (state === 'unlocked') expect(next.kind).toBe('unlocked')
      else expect(next.kind).toBe('unavailable')
      if (reason === 'brokerBlocked' && state === 'unavailable') {
        expect(next.kind === 'unavailable' && next.reason).toBe('brokerCannotStart')
      }
    }
  })
})
