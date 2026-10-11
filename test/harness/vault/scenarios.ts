// The mounted-vault harness scenarios (RVCM1091D P3): one VaultPanelState
// per scene, shaped like the management snapshot really serves it, so a
// re-shot shows the pixels the certification changed. A locked snapshot
// carries no items and no observed slot; uncreated and setup-pending keep
// the broker's locked baseline; the lost vault is unavailable with Reset;
// first-party-only keeps the broker's tier but no items. `unreachable` is
// what the panel host publishes when no snapshot can be had (RVCM1091E):
// unavailable with the broker-blocked sentence, never Reset, no items.
// `connecting` has no state yet: the host has not answered.
import { type VaultPanelState } from '../../../src/shared/modelsPanel'
import { type VaultStatus } from '../../../src/shared/vaultStatus'

export const VAULT_MOUNTED_SCENARIOS = [
  'mounted',
  'mounted-locked',
  'mounted-connecting',
  'mounted-uncreated',
  'mounted-setup-pending',
  'mounted-unavailable',
  'mounted-unreachable',
  'mounted-first-party-only',
] as const
export type VaultMountedScenario = (typeof VAULT_MOUNTED_SCENARIOS)[number]

function lockedBaseline(): VaultStatus {
  return {
    state: 'locked',
    lockEpoch: 1,
    tier: null,
    provider: null,
    silentUnlock: false,
    itemCount: 0,
    reason: 'locked',
  }
}

function fixtureItem(now: number): VaultPanelState['items'][number] {
  return {
    id: 'd'.repeat(32),
    name: 'deploy',
    handle: 'secret://deploy',
    label: 'Deployment credential',
    kind: 'secret',
    bindings: [],
    requirePresence: true,
    hidden: false,
    firstParty: false,
    policy: { mode: 'askEveryTime', unattendedAllowed: false, allowDisclosure: false },
    dates: { createdAt: now, rotatedAt: null, expiresAt: null, lastUsedAt: now },
    publicKey: null,
    fingerprint: null,
  }
}

export function vaultScenarioState(
  scenario: VaultMountedScenario,
  now: number,
): VaultPanelState | undefined {
  switch (scenario) {
    case 'mounted-connecting': {
      return undefined
    }
    case 'mounted': {
      return {
        status: {
          state: 'unlocked',
          lockEpoch: 1,
          tier: 'osStore',
          provider: 'loginKeychain',
          silentUnlock: true,
          itemCount: 1,
          reason: null,
        },
        items: [fixtureItem(now)],
        grants: [],
        audit: [],
        pending: [],
        ambientFiles: [],
      }
    }
    case 'mounted-locked': {
      return {
        status: lockedBaseline(),
        items: [],
        grants: [],
        audit: [],
        pending: [],
        ambientFiles: [],
      }
    }
    case 'mounted-uncreated': {
      return {
        status: { ...lockedBaseline(), state: 'uncreated' },
        items: [],
        grants: [],
        audit: [],
        pending: [],
        ambientFiles: [],
      }
    }
    case 'mounted-setup-pending': {
      return {
        status: { ...lockedBaseline(), state: 'setupPending' },
        items: [],
        grants: [],
        audit: [],
        pending: [],
        ambientFiles: [],
      }
    }
    case 'mounted-unavailable': {
      return {
        status: { ...lockedBaseline(), state: 'unavailable', reason: 'vaultLost' },
        items: [],
        grants: [],
        audit: [],
        pending: [],
        ambientFiles: [],
      }
    }
    case 'mounted-unreachable': {
      return {
        status: {
          ...lockedBaseline(),
          state: 'unavailable',
          reason: 'brokerBlocked',
          tier: null,
          provider: null,
          silentUnlock: false,
          itemCount: 0,
        },
        items: [],
        grants: [],
        audit: [],
        pending: [],
        ambientFiles: [],
      }
    }
    case 'mounted-first-party-only': {
      return {
        status: {
          ...lockedBaseline(),
          state: 'firstPartyOnly',
          reason: 'brokerBlocked',
          tier: 'osStore',
          provider: 'loginKeychain',
          silentUnlock: true,
        },
        items: [],
        grants: [],
        audit: [],
        pending: [],
        ambientFiles: [],
      }
    }
  }
}
