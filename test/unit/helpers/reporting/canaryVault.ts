import type { SecurityVaultSnapshot } from '../../../../src/runtime/reporting/reportInputs'

/**
A vault view whose every value field names a canary. The security reader
must project all of them away; the canary suite asserts none reaches any
report output.
*/
export const CANARY_ID = 'c0ffee'.padEnd(32, '0')
export const CANARY_DIGEST = 'deadbeef'.padEnd(64, 'f')
export const CANARIES = [
  'canary-target-Z9x8',
  'canary-item-name',
  'Canary Item Label',
  'canary-role-name',
  'canary-grant.example.invalid',
  CANARY_ID,
  CANARY_DIGEST,
]

export function canaryVaultSnapshot(): SecurityVaultSnapshot {
  return {
    state: 'unlocked',
    tier: 'osStore',
    items: [
      {
        id: CANARY_ID,
        name: 'canary-item-name',
        handle: 'secret://canary-item-name',
        label: 'Canary Item Label',
        kind: 'password',
        bindings: [],
        requirePresence: false,
        hidden: false,
        firstParty: false,
        policy: { mode: 'askEveryTime', unattendedAllowed: false, allowDisclosure: false },
        dates: { createdAt: 1, rotatedAt: null, expiresAt: null, lastUsedAt: null },
        publicKey: null,
        fingerprint: null,
      },
    ],
    grants: [
      {
        id: CANARY_ID,
        itemId: CANARY_ID,
        roles: [{ kind: 'role', name: 'canary-role-name' }],
        workspaces: ['fixture'],
        target: { kind: 'origin', origin: 'https://canary-grant.example.invalid' },
        maxUses: null,
        uses: 1,
        expiresAt: null,
        window: null,
        unattendedAllowed: false,
        sessionId: null,
        taskId: null,
        ceiling: 'none',
        createdAt: 1,
        createdBy: 'vaultCli',
      },
    ],
    audit: [
      {
        v: 1,
        id: CANARY_ID,
        generation: 1,
        time: 1,
        requester: {
          id: CANARY_ID,
          hostId: CANARY_ID,
          conversationId: null,
          taskId: null,
          role: { kind: 'orchestrator' },
          workspaceId: null,
          deviceId: null,
          peerProcessId: 1,
          sessionId: null,
          unattended: false,
          source: 'conversation',
        },
        handle: 'secret://canary-item-name',
        kind: 'environment',
        target: 'canary-target-Z9x8',
        digest: CANARY_DIGEST,
        decision: 'allow',
        authority: 'grant',
        grantId: CANARY_ID,
        outcome: 'succeeded',
        previousHash: CANARY_DIGEST,
        hash: CANARY_DIGEST,
        mac: CANARY_DIGEST,
      },
    ],
  }
}
