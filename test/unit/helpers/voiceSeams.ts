// Test-only deps for Muse Voice's batch seams (M105 lane V): the host says
// yes, nothing is capped, and no daily ledger is bound unless a case adds it.
import type { VoiceBatchSeamDeps } from '../../../src/core/voice/voiceBatchSeams'
import { Usd, type UsdAmount } from '../../../src/shared/usd'

/** An M82 conversation capped at $1, over its in-memory running total (D121). */
export function cappedSession() {
  const spent = { amount: Usd.from(0).toAmount() }
  const charged: (UsdAmount | undefined)[] = []
  return {
    spent,
    charged,
    scope: {
      capUsd: () => Usd.from('1').toAmount(),
      spentUsd: () => spent.amount,
      charge: (cost: UsdAmount | undefined) => {
        charged.push(cost)
        if (cost !== undefined) spent.amount = Usd.from(spent.amount).add(Usd.from(cost)).toAmount()
      },
    } satisfies NonNullable<VoiceBatchSeamDeps['session']>,
  }
}

export function voiceSeamDeps(overrides: Partial<VoiceBatchSeamDeps> = {}): VoiceBatchSeamDeps {
  return {
    sessionId: 'session-1',
    isPaidFeatureOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: () => undefined,
    reservePaidExtra: undefined,
    session: undefined,
    ...overrides,
  }
}
