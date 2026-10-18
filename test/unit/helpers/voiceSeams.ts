// Test-only deps for Muse Voice's batch seams (M105 lane V): the host says
// yes, nothing is capped, and no daily ledger is bound unless a case adds it.
import type { VoiceBatchSeamDeps } from '../../../src/core/voice/voiceBatchSeams'
import type { SessionBudgetJournal } from '../../../src/core/backends/modelapi/sessionBudget'
import { Usd } from '../../../src/shared/usd'

export const VOICE_ACCOUNT = 'a'.repeat(64)

/** An M82 session capped at $1, over the given journal. */
export function cappedSession(journal: SessionBudgetJournal | undefined) {
  return {
    capUsd: () => Usd.from('1').toAmount(),
    journal,
    accountId: () => Promise.resolve(VOICE_ACCOUNT),
  }
}

export function voiceSeamDeps(overrides: Partial<VoiceBatchSeamDeps> = {}): VoiceBatchSeamDeps {
  return {
    sessionId: 'session-1',
    isPaidFeatureOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: () => undefined,
    reservePaidExtra: undefined,
    session: {
      capUsd: () => Usd.from(0).toAmount(),
      journal: undefined,
      accountId: () => Promise.resolve(VOICE_ACCOUNT),
    },
    ...overrides,
  }
}
