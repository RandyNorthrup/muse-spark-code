// M105 lane V, seam 4: Muse Voice's batch transcription reserves on D78's
// shared daily ledger and, under a cap, the owner's running total (D208),
// asks through the host's own paid-use question, and counts on the window's
// tally. The real router (`prepareAudioAttachment`) drives the adapters end
// to end.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import { voiceBatchSeams, type PaidExtraClaim } from '../../src/core/voice/voiceBatchSeams'
import { prepareAudioAttachment, type AudioSource } from '../../src/core/voice/transcribeBatch'
import { createModelApiAudioContext } from '../../src/core/voice/transcribeBatchHttp'
import { cappedSession, voiceSeamDeps } from './helpers/voiceSeams'

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

const deps = voiceSeamDeps

const wav: AudioSource = {
  name: 'note.wav',
  pathToken: 'attached-wav',
  info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 640_044, durationSeconds: 20 },
}

function transcribe(seams: ReturnType<typeof voiceBatchSeams>) {
  const sends: true[] = []
  const send = () => {
    sends.push(true)
  }
  return {
    sends,
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
          transcribe: (_source, _signal, admission) => {
            admission.dispatch()
            send()
            return Promise.resolve({ text: 'Hello there.', billedSeconds: 20 })
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
    const asked: unknown[][] = []
    const allowsPaidUse = (...args: unknown[]) => {
      asked.push(args)
      return Promise.resolve(true as const)
    }
    const noted: unknown[][] = []
    const notePaidUse = (...args: unknown[]) => {
      noted.push(args)
    }
    const daily = ledger()
    const seams = voiceBatchSeams(
      deps({ allowsPaidUse, notePaidUse, reservePaidExtra: daily.reserve }),
    )
    const { run, sends } = transcribe(seams)
    const prepared = await run
    expect(prepared.transcript?.text).toBe('Hello there.')
    expect(asked).toEqual([[{ feature: 'voice' }, false, 'session-1']])
    expect(sends).toHaveLength(1)
    expect(noted).toEqual([['voice', 20]])
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
    const { run, sends } = transcribe(seams)
    await expect(run).rejects.toThrow(UI_TEXT.museVoiceRefused)
    expect(daily.reserved).toHaveLength(0)
    expect(sends).toHaveLength(0)
  })

  it('refuses without a daily ledger: nothing billed outside a request goes unbudgeted', async () => {
    const { run, sends } = transcribe(voiceBatchSeams(deps()))
    await expect(run).rejects.toThrow(UI_TEXT.paidDailyLedgerUnavailable)
    expect(sends).toHaveLength(0)
  })

  it('admits a bounded cost under an M82 cap, and charges both totals', async () => {
    const daily = ledger()
    const session = cappedSession()
    const seams = voiceBatchSeams(
      deps({
        reservePaidExtra: daily.reserve,
        session: session.scope,
      }),
    )
    const { run } = transcribe(seams)
    await run
    // The reported cost joins the owner's running total, like a request's.
    expect(session.charged).toEqual([TWENTY_SECONDS_USD])
    expect(session.spent.amount).toEqual(TWENTY_SECONDS_USD)
    expect(daily.settled).toEqual([{ amount: TWENTY_SECONDS_USD, unknown: false }])
  })

  it('refuses a batch cost that would pass the session cap, sending nothing', async () => {
    const daily = ledger()
    const session = cappedSession()
    session.scope.charge(Usd.from('1').toAmount())
    const seams = voiceBatchSeams(
      deps({
        reservePaidExtra: daily.reserve,
        session: session.scope,
      }),
    )
    const { run, sends } = transcribe(seams)
    await expect(run).rejects.toThrow(/would pass the session budget of \$1\.00 \(\$1\.00 used\)/u)
    expect(daily.settled).toEqual([{ amount: '0', unknown: undefined }])
    // The session admission threw before taking anything: nothing held, nothing to refund.
    expect(session.charged).toEqual([Usd.from('1').toAmount()])
    expect(sends).toHaveLength(0)
  })

  it('refunds both claims when the daily ledger refuses at admission', async () => {
    const daily = ledger({ failCheck: true })
    const session = cappedSession()
    const seams = voiceBatchSeams(
      deps({
        reservePaidExtra: daily.reserve,
        session: session.scope,
      }),
    )
    const { run, sends } = transcribe(seams)
    await expect(run).rejects.toThrow(UI_TEXT.paidDailyStopped)
    expect(daily.settled).toEqual([{ amount: '0', unknown: undefined }])
    expect(session.charged).toEqual([Usd.from(0).toAmount()])
    expect(sends).toHaveLength(0)
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
    const seams = voiceBatchSeams(deps({ isPaidFeatureOn: (feature) => feature === 'voice' }))
    expect(seams.gate.isOn('voice')).toBe(true)
    expect(seams.gate.isOn('webSearch')).toBe(false)
  })
})
