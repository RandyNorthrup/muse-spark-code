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
import { JudgeEntryStore } from '../../src/core/judge/entries'
import { JudgeResultCache } from '../../src/core/judge/same/resultCache'
import { MuseCodeSameJudge } from '../../src/host/judge/museCodeSameJudge'
import { removeJudgeTempRoot } from '../../src/host/judge/tempRoot'
import { JUDGE_MODEL_TEXT } from '../../src/shared/constants'

const STAND_DOWN = 'The Muse Code judge batch stood down: the approval was answered first'
const TIMED_OUT = 'The Muse Code judge batch failed: the approval stopped waiting'

interface Captured {
  readonly infos: string[]
  readonly warns: string[]
  readonly errors: unknown[]
}

function captured(): Captured & { infos: string[]; warns: string[]; errors: unknown[] } {
  return { infos: [], warns: [], errors: [] }
}

function neverSession(options: StartSessionOptions): never {
  throw new Error(`the answered batch starts no session: ${options.modelId}`)
}

describe('judge batch stand-down', () => {
  it('an approval answered first stands the batch down, quietly settled', async () => {
    const entries = new JudgeEntryStore()
    const seen = captured()
    const lifetime = new AbortController()
    lifetime.abort()
    const judge = new MuseCodeSameJudge({
      signal: lifetime.signal,
      entries,
      cache: new JudgeResultCache(),
      modelId: 'muse-spark-1.3',
      measureTokens: (text) => Buffer.byteLength(text),
      onError: (error) => {
        seen.errors.push(error)
      },
      readSettingsText: () => undefined,
      startSession: (options) => neverSession(options),
      makeTempRoot: () => mkdtemp(path.join(tmpdir(), 'muse-spark-judge-test-')),
      removeTempRoot: (root) => removeJudgeTempRoot(root),
      onSideSession: () => {
        throw new Error('the answered batch starts no session')
      },
      logInfo: (message) => {
        seen.infos.push(message)
      },
      logWarn: (message) => {
        seen.warns.push(message)
      },
    })
    const handle = entries.start({
      backend: 'museCode',
      sessionId: 'stand-down',
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
    for (let waited = 0; waited < 100 && seen.infos.length === 0; waited += 1) {
      await delay(50)
    }
    expect(seen.infos).toEqual([STAND_DOWN])
    expect(seen.warns).toEqual([])
    expect(seen.errors).toEqual([])
    // Settled without a verdict: a late settle finds nothing.
    expect(entries.settle(handle, 'failed')).toBe(false)
  })

  it('a batch the timeout stopped still fails loud', async () => {
    const entries = new JudgeEntryStore()
    const seen = captured()
    const judge = new MuseCodeSameJudge({
      entries,
      cache: new JudgeResultCache(),
      modelId: 'muse-spark-1.3',
      timeoutMs: 1,
      measureTokens: (text) => Buffer.byteLength(text),
      onError: (error) => {
        seen.errors.push(error)
      },
      readSettingsText: () => undefined,
      startSession: (options) => neverSession(options),
      makeTempRoot: async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'muse-spark-judge-test-'))
        // The timeout fires inside this wait, every run.
        await delay(50)
        return root
      },
      removeTempRoot: (root) => removeJudgeTempRoot(root),
      onSideSession: () => {
        throw new Error('the timed-out batch starts no session')
      },
      logInfo: (message) => {
        seen.infos.push(message)
      },
      logWarn: (message) => {
        seen.warns.push(message)
      },
    })
    const handle = entries.start({
      backend: 'museCode',
      sessionId: 'timed-out',
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
    for (let waited = 0; waited < 100 && seen.warns.length === 0; waited += 1) {
      await delay(50)
    }
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
    const judge = new MuseCodeSameJudge({
      signal: lifetime.signal,
      entries,
      cache: new JudgeResultCache(),
      modelId: 'muse-spark-1.3',
      measureTokens: (text) => Buffer.byteLength(text),
      onError: (error) => {
        seen.errors.push(error)
      },
      readSettingsText: () => undefined,
      startSession: (options) => neverSession(options),
      makeTempRoot: async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'muse-spark-judge-test-'))
        roots.push(root)
        // The test pins the folder inside this wait, every run.
        await delay(200)
        return root
      },
      removeTempRoot: (root) => removeJudgeTempRoot(root),
      onSideSession: () => {
        throw new Error('the answered batch starts no session')
      },
      logInfo: (message) => {
        seen.infos.push(message)
      },
      logWarn: (message) => {
        seen.warns.push(message)
      },
    })
    const handle = entries.start({
      backend: 'museCode',
      sessionId: 'removal-names-code',
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
    for (let waited = 0; waited < 100 && roots.length === 0; waited += 1) {
      await delay(10)
    }
    const root = roots[0]
    if (root === undefined) throw new Error('the batch made no folder')
    const previous = process.cwd()
    process.chdir(root)
    try {
      for (let waited = 0; waited < 100 && seen.warns.length === 0; waited += 1) {
        await delay(50)
      }
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
