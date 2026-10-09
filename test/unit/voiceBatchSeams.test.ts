// M105 lane V, seam 4: Muse Voice's batch transcription reserves on D78's
// shared daily ledger and, under a cap, M82's session journal, asks through
// the host's own paid-use question, and counts on the window's tally. The
// real router (`prepareAudioAttachment`) drives the adapters end to end.
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import {
  voiceBatchSeams,
  type PaidExtraClaim,
  type VoiceBatchSeamDeps,
} from '../../src/core/voice/voiceBatchSeams'
import { prepareAudioAttachment, type AudioSource } from '../../src/core/voice/transcribeBatch'
import { createModelApiAudioContext } from '../../src/core/voice/transcribeBatchHttp'
import type { SessionBudgetJournal } from '../../src/core/backends/modelapi/sessionBudget'

const ACCOUNT = 'a'.repeat(64)
/** $0.18 per hour: 20 seconds bill exactly $0.001. */
const TWENTY_SECONDS_USD = '0.001'

interface Ledger {
  readonly reserved: UsdAmount[]
  readonly settled: { readonly amount: UsdAmount; readonly unknown: boolean | undefined }[]
  readonly checks: { count: number }
}

function ledger(options: { readonly failCheck?: boolean } = {}): Ledger & {
  readonly reserve: (cost: UsdAmount) => Promise<PaidExtraClaim>
} {
  const reserved: UsdAmount[] = []
  const settled: Ledger['settled'] = []
  const checks = { count: 0 }
  return {
    reserved,
    settled,
    checks,
    reserve: (cost) => {
      reserved.push(cost)
      return Promise.resolve({
        reservedUsd: cost,
        check: () => {
          checks.count += 1
          if (options.failCheck === true) throw new Error(UI_TEXT.paidDailyStopped)
        },
        settle: (amount, unknown) => {
          settled.push({ amount, unknown })
          return Promise.resolve()
        },
      })
    },
  }
}

function journal(): Ledger & { readonly journal: SessionBudgetJournal } {
  const reserved: UsdAmount[] = []
  const settled: Ledger['settled'] = []
  const checks = { count: 0 }
  const total = { spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }
  return {
    reserved,
    settled,
    checks,
    journal: {
      read: () => Promise.resolve(total),
      record: () => Promise.resolve(total),
      reserve: (sessionId, accountId, cost) => {
        expect([sessionId, accountId]).toEqual(['session-1', ACCOUNT])
        reserved.push(cost)
        return Promise.resolve({
          claimId: 'claim-1',
          reservedUsd: cost,
          check: () => {
            checks.count += 1
            return total
          },
          settle: (amount, unknown) => {
            settled.push({ amount, unknown })
            return Promise.resolve(total)
          },
        })
      },
    },
  }
}

function deps(overrides: Partial<VoiceBatchSeamDeps> = {}): VoiceBatchSeamDeps {
  return {
    sessionId: 'session-1',
    isPaidFeatureOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: vi.fn(),
    reservePaidExtra: undefined,
    session: {
      capUsd: () => Usd.from(0).toAmount(),
      journal: undefined,
      accountId: () => Promise.resolve(ACCOUNT),
    },
    ...overrides,
  }
}

const wav: AudioSource = {
  name: 'note.wav',
  pathToken: 'attached-wav',
  info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 640_044, durationSeconds: 20 },
}

function transcribe(seams: ReturnType<typeof voiceBatchSeams>, billedSeconds = 20) {
  const send = vi.fn()
  return {
    send,
    run: prepareAudioAttachment(
      wav,
      'transcribe',
      {
        context: createModelApiAudioContext({
          modelId: 'muse-spark-1.3-contributor',
          canExtractWav: false,
          isVoiceOn: true,
        }),
        assertCurrent: () => undefined,
        batch: {
          billableSecondsUpperBound: (source) => source.info.durationSeconds ?? undefined,
          transcribe: (_source, _signal, admitSend) => {
            admitSend()
            send()
            return Promise.resolve({ text: 'Hello there.', billedSeconds })
          },
        },
        ...seams,
      },
      new AbortController().signal,
    ),
  }
}

describe('Muse Voice batch consent and reserve adapters (M105 lane V seam 4)', () => {
  it('asks through the host question for this session and counts on the tally', async () => {
    const allowsPaidUse = vi.fn(() => Promise.resolve(true as const))
    const notePaidUse = vi.fn()
    const daily = ledger()
    const seams = voiceBatchSeams(
      deps({ allowsPaidUse, notePaidUse, reservePaidExtra: daily.reserve }),
    )
    const { run, send } = transcribe(seams)
    const prepared = await run
    expect(prepared.transcript?.text).toBe('Hello there.')
    expect(allowsPaidUse).toHaveBeenCalledWith({ feature: 'voice' }, false, 'session-1')
    expect(send).toHaveBeenCalledOnce()
    expect(notePaidUse).toHaveBeenCalledWith('voice', 20)
    // Reserved and settled at exactly the billed seconds' price.
    expect(daily.reserved).toEqual([TWENTY_SECONDS_USD])
    expect(daily.checks.count).toBeGreaterThanOrEqual(2)
    expect(daily.settled).toEqual([{ amount: TWENTY_SECONDS_USD, unknown: false }])
  })

  it('refuses before any reservation or send when the host says no', async () => {
    const daily = ledger()
    const seams = voiceBatchSeams(
      deps({ allowsPaidUse: () => Promise.resolve(false), reservePaidExtra: daily.reserve }),
    )
    const { run, send } = transcribe(seams)
    await expect(run).rejects.toThrow(UI_TEXT.museVoiceRefused)
    expect(daily.reserved).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses without a daily ledger: nothing billed outside a request goes unbudgeted', async () => {
    const { run, send } = transcribe(voiceBatchSeams(deps()))
    await expect(run).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    expect(send).not.toHaveBeenCalled()
  })

  it('reserves on the session journal too under an M82 cap, and settles both', async () => {
    const daily = ledger()
    const session = journal()
    const seams = voiceBatchSeams(
      deps({
        reservePaidExtra: daily.reserve,
        session: {
          capUsd: () => Usd.from('1').toAmount(),
          journal: session.journal,
          accountId: () => Promise.resolve(ACCOUNT),
        },
      }),
    )
    const { run } = transcribe(seams)
    await run
    expect(session.reserved).toEqual([TWENTY_SECONDS_USD])
    // The reservation check, then the synchronous send admission.
    expect(session.checks.count).toBe(2)
    expect(session.settled).toEqual([{ amount: TWENTY_SECONDS_USD, unknown: false }])
    expect(daily.settled).toEqual([{ amount: TWENTY_SECONDS_USD, unknown: false }])
  })

  it('refunds the daily claim when a capped session has no journal', async () => {
    const daily = ledger()
    const seams = voiceBatchSeams(
      deps({
        reservePaidExtra: daily.reserve,
        session: {
          capUsd: () => Usd.from('1').toAmount(),
          journal: undefined,
          accountId: () => Promise.resolve(ACCOUNT),
        },
      }),
    )
    const { run, send } = transcribe(seams)
    await expect(run).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(daily.settled).toEqual([{ amount: '0', unknown: undefined }])
    expect(send).not.toHaveBeenCalled()
  })

  it('refunds both claims when the daily ledger refuses at admission', async () => {
    const daily = ledger({ failCheck: true })
    const session = journal()
    const seams = voiceBatchSeams(
      deps({
        reservePaidExtra: daily.reserve,
        session: {
          capUsd: () => Usd.from('1').toAmount(),
          journal: session.journal,
          accountId: () => Promise.resolve(ACCOUNT),
        },
      }),
    )
    const { run, send } = transcribe(seams)
    await expect(run).rejects.toThrow(UI_TEXT.paidDailyStopped)
    expect(daily.settled).toEqual([{ amount: '0', unknown: undefined }])
    expect(session.settled).toEqual([{ amount: '0', unknown: undefined }])
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps the full reservation as uncertain liability when no bill came back', async () => {
    const daily = ledger()
    const seams = voiceBatchSeams(deps({ reservePaidExtra: daily.reserve }))
    const claim = await seams.reserve(Usd.from(TWENTY_SECONDS_USD), new AbortController().signal)
    claim.admitSend()
    await claim.settle(undefined)
    expect(daily.settled).toEqual([{ amount: TWENTY_SECONDS_USD, unknown: true }])
  })

  it('reads the gate per call', () => {
    const isPaidFeatureOn = vi.fn((feature: string) => feature === 'voice')
    const seams = voiceBatchSeams(deps({ isPaidFeatureOn }))
    expect(seams.gate.isOn('voice')).toBe(true)
    expect(seams.gate.isOn('webSearch')).toBe(false)
  })
})
