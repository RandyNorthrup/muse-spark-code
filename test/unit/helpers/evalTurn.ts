// One eval turn on the real `ModelApiHost` over the fake Model API (M75):
// the shared driver for the eval unit tests, so the arms' suites do not
// duplicate its setup.

import {
  createEvalCompactionLedger,
  evalPaidUseFence,
  runEvalTurn,
  type EvalCompactionAdmission,
  type EvalHostChange,
} from '../../../src/core/eval/driver'
import type { EvalBudget } from '../../../src/core/eval/wire'
import type { MemoryStore } from '../../../src/core/memory/memoryStore'
import { EVAL_BUDGET_USD } from '../../../src/shared/constants'
import type { ApprovalMode } from '../../../src/shared/permissionModes'
import { Usd } from '../../../src/shared/usd'
import { memoryContextIo } from './fakeContextIo'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  type FakeModelApi,
  type ScriptedReply,
} from './fakeModelApi'
import { FakeLogOutputChannel } from './fakes'
import { memoryToolIo, type MemoryToolIo } from './fakeToolIo'

export const EVAL_TURN_ROOT = '/ws'

export interface DrivenEvalTurn {
  readonly api: FakeModelApi
  readonly io: MemoryToolIo
  readonly outcome: Awaited<ReturnType<typeof runEvalTurn>>
}

/**
 * The turn's spend authority on fakes: the real D78 admission over a real
 * ledger against a throwaway run budget. Fake scripts never approach its
 * cap, so every scripted compaction is admitted, settled and tallied —
 * exercising the production path, not an allowance stub. A caller proving
 * a refusal passes its own admission instead.
 */
export function testEvalAdmission(budget?: EvalBudget): EvalCompactionAdmission {
  const run = budget ?? { spentUsd: Usd.from(0).toAmount() }
  const ledger = createEvalCompactionLedger(run)
  return {
    ledger,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: () => {
      ledger.tally.started += 1
    },
    paidUseFence: () => evalPaidUseFence(run),
    dailyBudgetUsd: () => Usd.from(EVAL_BUDGET_USD).toAmount(),
  }
}

/** Scripts the replies, sends the prompt as the user's message, and reports the turn. */
export async function driveEvalTurn(options: {
  readonly replies: readonly ScriptedReply[]
  readonly files: Readonly<Record<string, string>>
  readonly prompt: string
  readonly change?: EvalHostChange | undefined
  readonly turnTimeoutMs?: number | undefined
  readonly windowTokens?: number | undefined
  readonly memory?: MemoryStore | undefined
  readonly approvalMode?: ApprovalMode | undefined
  /** Explicit null exercises the driver's missing-admission refusal. */
  readonly admission?: EvalCompactionAdmission | null | undefined
}): Promise<DrivenEvalTurn> {
  const api = fakeModelApi()
  api.script(...options.replies)
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(options.files, EVAL_TURN_ROOT)
  let ids = 0
  const outcome = await runEvalTurn({
    deps: {
      client: fakeModelApiClient(api, log),
      io,
      contextIo: memoryContextIo(io.files),
      platform: 'linux',
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      log,
      now: () => 0,
      newId: () => {
        ids += 1
        return `id${String(ids)}`
      },
      turnTimeoutMs: options.turnTimeoutMs,
      memory: options.memory,
      admission:
        options.admission === null ? undefined : (options.admission ?? testEvalAdmission()),
    },
    workspace: EVAL_TURN_ROOT,
    prompt: options.prompt,
    change: options.change,
    windowTokens: options.windowTokens,
    approvalMode: options.approvalMode,
  })
  return { api, io, outcome }
}
