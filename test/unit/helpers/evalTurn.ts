// One eval turn on the real `ModelApiHost` over the fake Model API (M75):
// the shared driver for the eval unit tests, so the arms' suites do not
// duplicate its setup.

import { runEvalTurn, type EvalHostChange } from '../../../src/core/eval/driver'
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

/** Scripts the replies, sends the prompt as the user's message, and reports the turn. */
export async function driveEvalTurn(options: {
  readonly replies: readonly ScriptedReply[]
  readonly files: Readonly<Record<string, string>>
  readonly prompt: string
  readonly change?: EvalHostChange | undefined
  readonly turnTimeoutMs?: number | undefined
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
    },
    workspace: EVAL_TURN_ROOT,
    prompt: options.prompt,
    change: options.change,
  })
  return { api, io, outcome }
}
