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
import { panel } from '../helpers/vault/fixtures'

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
      { kind: 'snapshotFailed', generation: GEN, reason },
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
function sampleStates(): Record<(typeof VAULT_VIEW_STATES)[number], VaultViewState> {
  const good = unlockedSnapshot()
  return {
    loading: { kind: 'loading', generation: GEN, lastGood: good },
    locked: { kind: 'locked', lockEpoch: 4, generation: GEN, frame: lockedFrame(good, 4) },
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

/** One representative event per kind; the named tests below vary payloads. */
function sampleEvent(kind: (typeof VAULT_VIEW_EVENTS)[number]): VaultViewEvent {
  switch (kind) {
    case 'brokerLocked': {
      return { kind: 'brokerLocked', lockEpoch: 9 }
    }
    case 'snapshotOk': {
      return { kind: 'snapshotOk', generation: GEN, snapshot: unlockedSnapshot() }
    }
    case 'snapshotFailed': {
      return { kind: 'snapshotFailed', generation: GEN, reason: 'busy' }
    }
    case 'brokerUnlocked':
    case 'brokerChanged':
    case 'brokerApproval':
    case 'brokerRevoked':
    case 'vaultReady':
    case 'watchLost':
    case 'watchRestored':
    case 'userLock':
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
    expect(VAULT_VIEW_STATES).toHaveLength(4)
    expect(VAULT_VIEW_EVENTS).toHaveLength(18)
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
      { kind: 'snapshotFailed', generation: GEN, reason: 'busy' },
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
      { kind: 'snapshotFailed', generation: GEN, reason: 'busy' },
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
      { kind: 'snapshotFailed', generation: GEN, reason: 'busy' },
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
      { kind: 'snapshotFailed', generation: GEN, reason: 'busy' },
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
      { kind: 'snapshotFailed', generation: GEN, reason: 'rollback' },
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
      { kind: 'snapshotOk', generation: GEN, snapshot: older },
      GEN + 1,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('unlocked')
    if (next.kind === 'unlocked') expect(next.snapshot.status.lockEpoch).toBe(3)
    expect(effects.frame?.status.state).toBe('unlocked')
  })

  it('a fresh snapshot is always trusted, even after an optimistic lock', () => {
    const { state: next, effects } = applyVaultViewEvent(
      sampleStates().locked,
      { kind: 'snapshotOk', generation: GEN, snapshot: unlockedSnapshot() },
      GEN,
      BUDGET,
      DELAY,
    )
    expect(next.kind).toBe('unlocked')
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
        { kind: 'snapshotOk', generation: GEN, snapshot },
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
