// RLWINFIX item 4: a batch whose approval was answered stands down and
// says so, instead of failing loud; a batch the timeout stopped still
// fails loud; and a removal that still fails names its real code. Real
// code throughout: the real judge adapter over the real entry store,
// cache, planner and filesystem, with only the model session unreached.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import type { StartSessionOptions } from '../../src/core/agent/agentBackend'
import { JudgeEntryStore, type JudgeEntryHandle } from '../../src/core/judge/entries'
import { JudgeResultCache } from '../../src/core/judge/same/resultCache'
import { MuseCodeSameJudge } from '../../src/host/judge/museCodeSameJudge'
import { removeJudgeTempRoot } from '../../src/host/judge/tempRoot'
import { JUDGE_MODEL_TEXT } from '../../src/shared/constants'

const STAND_DOWN = 'The Muse Code judge batch stood down: the approval was answered first'
const TIMED_OUT = 'The Muse Code judge batch failed: the approval stopped waiting'

function captured(): { infos: string[]; warns: string[]; errors: unknown[] } {
  return { infos: [], warns: [], errors: [] }
}

function neverSession(options: StartSessionOptions): never {
  throw new Error(`the answered batch starts no session: ${options.modelId}`)
}

function testJudge(
  entries: JudgeEntryStore,
  seen: { infos: string[]; warns: string[]; errors: unknown[] },
  options: {
    readonly signal?: AbortSignal | undefined
    readonly timeoutMs?: number | undefined
    readonly makeTempRoot: () => Promise<string>
    readonly sideSessionMessage: string
  },
): MuseCodeSameJudge {
  return new MuseCodeSameJudge({
    ...(options.signal !== undefined && { signal: options.signal }),
    entries,
    cache: new JudgeResultCache(),
    modelId: 'muse-spark-1.3',
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    measureTokens: (text) => Buffer.byteLength(text),
    onError: (error) => {
      seen.errors.push(error)
    },
    readSettingsText: () => undefined,
    startSession: (startOptions) => neverSession(startOptions),
    makeTempRoot: options.makeTempRoot,
    removeTempRoot: (root) => removeJudgeTempRoot(root),
    onSideSession: () => {
      throw new Error(options.sideSessionMessage)
    },
    logInfo: (message) => {
      seen.infos.push(message)
    },
    logWarn: (message) => {
      seen.warns.push(message)
    },
  })
}

function judgeTestAction(
  entries: JudgeEntryStore,
  judge: MuseCodeSameJudge,
  sessionId: string,
): JudgeEntryHandle {
  const handle = entries.start({
    backend: 'museCode',
    sessionId,
    turnId: 'turn',
    tool: 'test',
    args: {},
  })
  judge.judge({
    entryKey: handle,
    stateText: 'test state',
    questions: [
      { id: 'risk.destructive', kind: 'noul', text: JUDGE_MODEL_TEXT.judgeDestructiveQuestion },
    ],
  })
  return handle
}

async function untilTold(isTold: () => boolean, waitMs: number): Promise<void> {
  for (let waited = 0; waited < 100 && !isTold(); waited += 1) {
    await delay(waitMs)
  }
}

describe('judge batch stand-down', () => {
  it('an approval answered first stands the batch down, quietly settled', async () => {
    const entries = new JudgeEntryStore()
    const seen = captured()
    const lifetime = new AbortController()
    lifetime.abort()
    const judge = testJudge(entries, seen, {
      signal: lifetime.signal,
      makeTempRoot: () => mkdtemp(path.join(tmpdir(), 'muse-spark-judge-test-')),
      sideSessionMessage: 'the answered batch starts no session',
    })
    const handle = judgeTestAction(entries, judge, 'stand-down')
    await untilTold(() => seen.infos.length > 0, 50)
    expect(seen.infos).toEqual([STAND_DOWN])
    expect(seen.warns).toEqual([])
    expect(seen.errors).toEqual([])
    // Settled without a verdict: a late settle finds nothing.
    expect(entries.settle(handle, 'failed')).toBe(false)
  })

  it('a batch the timeout stopped still fails loud', async () => {
    const entries = new JudgeEntryStore()
    const seen = captured()
    const judge = testJudge(entries, seen, {
      timeoutMs: 1,
      makeTempRoot: async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'muse-spark-judge-test-'))
        // The timeout fires inside this wait, every run.
        await delay(50)
        return root
      },
      sideSessionMessage: 'the timed-out batch starts no session',
    })
    const handle = judgeTestAction(entries, judge, 'timed-out')
    await untilTold(() => seen.warns.length > 0, 50)
    expect(seen.warns).toEqual([TIMED_OUT])
    expect(seen.infos).toEqual([])
    expect(seen.errors).toEqual([])
    expect(entries.settle(handle, 'failed')).toBe(false)
  })
})

describe.runIf(process.platform === 'win32')('judge batch removal failure', () => {
  it('names the held file by its real code', async () => {
    const entries = new JudgeEntryStore()
    const seen = captured()
    const lifetime = new AbortController()
    lifetime.abort()
    const roots: string[] = []
    const judge = testJudge(entries, seen, {
      signal: lifetime.signal,
      makeTempRoot: async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'muse-spark-judge-test-'))
        roots.push(root)
        // The test pins the folder inside this wait, every run.
        await delay(200)
        return root
      },
      sideSessionMessage: 'the answered batch starts no session',
    })
    const handle = judgeTestAction(entries, judge, 'removal-names-code')
    await untilTold(() => roots.length > 0, 10)
    const root = roots[0]
    if (root === undefined) throw new Error('the batch made no folder')
    const previous = process.cwd()
    process.chdir(root)
    try {
      await untilTold(() => seen.warns.length > 0, 50)
    } finally {
      process.chdir(previous)
    }
    await removeJudgeTempRoot(root)
    expect(seen.infos).toEqual([STAND_DOWN])
    expect(seen.warns).toHaveLength(1)
    expect(seen.warns[0]).toMatch(
      /^The Muse Code judge could not remove its folder: (EBUSY|EPERM|EACCES|ENOTEMPTY)$/,
    )
    expect(seen.errors).toEqual([])
    expect(entries.settle(handle, 'failed')).toBe(false)
  })
})
