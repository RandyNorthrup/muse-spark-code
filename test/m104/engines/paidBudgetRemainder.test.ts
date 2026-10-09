import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { admitJudgeCall, type JudgeDailyLedger } from '../../../src/core/judge/admission'
import { createPaidDailyBudget } from '../../../src/host/vscode/paid/paidDailyBudget'
import { createRuntimePaidBudget } from '../../../src/runtime/features/paidBudget'
import { UI_TEXT } from '../../../src/shared/constants'
import { Usd, type UsdAmount } from '../../../src/shared/usd'

// 0.17 keeps money as exact decimal strings (CAPS017).
const usd = (value: number): UsdAmount => Usd.from(value).toAmount()

const DAY = new Date(2026, 9, 6, 12).getTime()

/** One shared vector table: every row must behave identically on both ledgers. */
const vectors = [
  { capUsd: usd(0.5), settledUsd: [usd(0.4)], exactUsd: usd(0.1), overUsd: usd(0.100000001) },
  {
    capUsd: usd(0.6),
    settledUsd: [usd(0.1), usd(0.2)],
    exactUsd: usd(0.3),
    overUsd: usd(0.300000001),
  },
] as const

const roots: string[] = []
const disposables: { dispose: () => Promise<void> }[] = []
afterEach(async () => {
  await Promise.all(disposables.splice(0).map((ledger) => ledger.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeLedgers(
  capUsd: UsdAmount,
): Promise<Record<'vscode' | 'portable', JudgeDailyLedger>> {
  const vscodeRoot = await mkdtemp(path.join(tmpdir(), 'm104-pb-vscode-'))
  const portableRoot = await mkdtemp(path.join(tmpdir(), 'm104-pb-portable-'))
  roots.push(vscodeRoot, portableRoot)
  const vscode = createPaidDailyBudget({
    directory: vscodeRoot,
    now: () => DAY,
    capUsd: () => capUsd,
    sleep: () => Promise.resolve(),
    isModelApi: () => true,
  })
  const portable = createRuntimePaidBudget(
    {
      directory: portableRoot,
      now: () => DAY,
      capUsd: () => capUsd,
      sleep: () => Promise.resolve(),
      assertCurrent: () => undefined,
      isLocalStorage: () => true,
    },
    UI_TEXT,
    'en',
  )
  disposables.push(portable)
  return { vscode: vscode.judgeLedger, portable: portable.judgeLedger }
}

describe.each(['vscode', 'portable'] as const)('%s daily ledger remainder', (kind) => {
  it.each(vectors)(
    'admits an exactly affordable remainder and refuses one nano more (cap $capUsd)',
    async (vector) => {
      const both = await makeLedgers(vector.capUsd)
      const ledger = both[kind]
      for (const amount of vector.settledUsd) {
        const claim = await ledger.reserve(amount)
        await claim.settle(amount)
      }
      expect(await ledger.remainingUsd()).toBe(vector.exactUsd)
      const admission = await admitJudgeCall({
        binding: {
          ownerId: 'owner',
          modelId: 'model',
          engine: 'same',
          confidential: false,
          backend: 'modelApi',
          consent: 'granted',
        },
        billing: { kind: 'metered', ledger },
        estimatedInputTokens: Math.round((Number(vector.exactUsd) * 1_000_000) / 1000),
        maxOutputTokens: 1,
        priceOf: () => ({ input: usd(1000), cachedInput: usd(0), output: usd(0) }),
      })
      expect(admission.admitted).toBe(true)
      if (admission.admitted) await admission.claim.refundNonSend()
      await expect(ledger.reserve(vector.overUsd)).rejects.toThrow()
    },
  )
})
