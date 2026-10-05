// Lane M98-S: the hidden-session spec, background scheduling, the
// memory-only result cache, the shared stated settle and the prompt wording
// (PLAN.md M98 acceptance items 5 and 9). A fresh Plan session per batch with
// no MCP servers; the item guard cancels on tool items; background calls are
// never awaited and late results dropped; the cache is bounded and
// memory-only; only a `noul` at the bar settles caution.

import { describe, expect, it } from 'vitest'
import { decodeJudgeReply, settleBatch } from '../../src/core/judge/same/answers'
import { JudgeResultCache } from '../../src/core/judge/same/resultCache'
import { runJudgeInBackground } from '../../src/core/judge/same/scheduler'
import { isJudgeTurnItemAllowed, judgeSessionOptions } from '../../src/core/judge/same/sessionSpec'
import { judgePromptWording, judgeStandaloneTurn } from '../../src/core/judge/same/wording'
import { JUDGE_MODEL_TEXT } from '../../src/shared/constants'

const NOUL = { id: 'risk', kind: 'noul' as const, text: 'Is this risky?' }

function mustNotRun(): Promise<void> {
  throw new Error('must not run')
}

describe('judgeSessionOptions', () => {
  it('starts Plan with no MCP servers in the batch folder', () => {
    const options = judgeSessionOptions('model-x', '/tmp/judge-1')
    expect(options).toEqual({
      workspaceRoot: '/tmp/judge-1',
      modelId: 'model-x',
      approvalMode: 'denyUnmatched',
    })
    expect('mcpServers' in options).toBe(false)
  })
})

describe('isJudgeTurnItemAllowed', () => {
  it('keeps message, reminder, reasoning and reply kinds only', () => {
    for (const kind of ['userMessage', 'reminderChild', 'reasoning', 'agentMessage']) {
      expect(isJudgeTurnItemAllowed(kind)).toBe(true)
    }
    for (const kind of ['toolCall', 'userShell', 'subagent', 'workflow', '']) {
      expect(isJudgeTurnItemAllowed(kind)).toBe(false)
    }
  })
})

describe('runJudgeInBackground', () => {
  it('returns at once and settles the call after', async () => {
    let calls = 0
    const errors: unknown[] = []
    runJudgeInBackground(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        calls += 1
      },
      {
        timeoutMs: 5000,
        onError: (error) => {
          errors.push(error)
        },
      },
    )
    expect(calls).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(calls).toBe(1)
    expect(errors).toEqual([])
  })

  it('aborts past the timeout and reports the failure once', async () => {
    const errors: unknown[] = []
    let didAbort = false
    runJudgeInBackground(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            didAbort = true
            reject(new Error('aborted'))
          })
        }),
      {
        timeoutMs: 20,
        onError: (error) => {
          errors.push(error)
        },
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(didAbort).toBe(true)
    expect(errors).toHaveLength(1)
  })

  it('refuses a non-positive timeout loudly', () => {
    const errors: unknown[] = []
    expect(() => {
      runJudgeInBackground(mustNotRun, {
        timeoutMs: 0,
        onError: (error) => {
          errors.push(error)
        },
      })
    }).toThrow(RangeError)
    expect(errors).toEqual([])
  })
})

describe('JudgeResultCache', () => {
  it('returns what settled and drops nothing while room lasts', () => {
    const cache = new JudgeResultCache(2)
    expect(cache.get('k')).toBeUndefined()
    cache.set('k', { outcome: 'caution', model: 'm', answers: [] })
    expect(cache.get('k')?.outcome).toBe('caution')
    expect(cache.size).toBe(1)
  })

  it('evicts the oldest past the cap and keeps each window apart', () => {
    const cache = new JudgeResultCache(2)
    cache.set('a', { outcome: 'none', model: 'm', answers: [] })
    cache.set('b', { outcome: 'none', model: 'm', answers: [] })
    cache.set('c', { outcome: 'caution', model: 'm', answers: [] })
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')?.outcome).toBe('none')
    expect(cache.get('c')?.outcome).toBe('caution')
    const other = new JudgeResultCache(2)
    expect(other.get('c')).toBeUndefined()
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('refuses a non-positive cap loudly', () => {
    expect(() => new JudgeResultCache(0)).toThrow(RangeError)
  })
})

describe('decodeJudgeReply', () => {
  it('reads the whole text and the object inside surrounding words', () => {
    expect(decodeJudgeReply('{"answer":"yes","confidence":80}')).toEqual({
      answer: 'yes',
      confidence: 80,
    })
    expect(decodeJudgeReply('Here it is:\n{"answer":"no","confidence":10}\nDone.')).toEqual({
      answer: 'no',
      confidence: 10,
    })
  })

  it('reads nothing from prose or arrays', () => {
    expect(decodeJudgeReply('no json here')).toBeUndefined()
    expect(decodeJudgeReply('[1,2]')).toBeUndefined()
  })
})

describe('settleBatch', () => {
  it('settles caution for a risky noul at the bar', () => {
    const settled = settleBatch({
      questions: [NOUL],
      questionIds: ['risk'],
      replyText: '{"answer":"yes","confidence":70}',
      model: 'm',
    })
    if (settled.status !== 'answered') {
      throw new Error('expected answers')
    }
    expect(settled.outcome).toBe('caution')
    expect(settled.answers).toHaveLength(1)
    expect(settled.answers[0]?.kind).toBe('noul')
  })

  it('settles none below the bar, and a safe answer changes nothing', () => {
    const settled = settleBatch({
      questions: [NOUL],
      questionIds: ['risk'],
      replyText: '{"answer":"yes","confidence":69}',
      model: 'm',
    })
    if (settled.status !== 'answered') {
      throw new Error('expected answers')
    }
    expect(settled.outcome).toBe('none')
  })

  it('settles a choice distribution and never cautions on it', () => {
    const settled = settleBatch({
      questions: [{ id: 'pick', kind: 'choice', text: 'Pick.', options: ['Aye', 'Nay'] }],
      questionIds: ['pick'],
      replyText: '{"probabilities":[99,1]}',
      model: 'm',
    })
    if (settled.status !== 'answered') {
      throw new Error('expected answers')
    }
    expect(settled.outcome).toBe('none')
  })

  it('fails on an unparseable reply or a missing field, never as certainty', () => {
    expect(
      settleBatch({ questions: [NOUL], questionIds: ['risk'], replyText: 'maybe?', model: 'm' }),
    ).toEqual({ status: 'failure', failure: 'unparseable' })
    expect(
      settleBatch({
        questions: [NOUL],
        questionIds: ['risk'],
        replyText: '{"answer":"yes"}',
        model: 'm',
      }),
    ).toEqual({ status: 'failure', failure: 'missing-field' })
  })

  it('refuses mixed kinds and an empty batch loudly', () => {
    expect(() =>
      settleBatch({
        questions: [NOUL, { id: 'pick', kind: 'choice', text: 'Pick.', options: ['Aye', 'Nay'] }],
        questionIds: ['risk', 'pick'],
        replyText: '{"answer":"yes","confidence":90}',
        model: 'm',
      }),
    ).toThrow(RangeError)
    expect(() =>
      settleBatch({ questions: [], questionIds: [], replyText: '{}', model: 'm' }),
    ).toThrow(RangeError)
  })
})

describe('judge wording', () => {
  it('comes from JUDGE_MODEL_TEXT and matches the stated parser', () => {
    const wording = judgePromptWording()
    expect(wording.systemInstruction).toBe(JUDGE_MODEL_TEXT.judgeSystemInstruction)
    expect(wording.formatAlternative('A', 'Aye')).toContain('A')
    expect(wording.formatAlternative(undefined, '')).toBeDefined()
    const turn = judgeStandaloneTurn('request')
    expect(turn).toContain(JUDGE_MODEL_TEXT.judgeSystemInstruction)
    expect(turn).toContain('Use no tools.')
    expect(turn).toContain('request')
  })

  it('asks for the exact JSON the techniques parser reads', () => {
    expect(JUDGE_MODEL_TEXT.judgeSystemInstruction).toContain('"answer"')
    expect(JUDGE_MODEL_TEXT.judgeSystemInstruction).toContain('"confidence"')
    expect(JUDGE_MODEL_TEXT.judgeSystemInstruction).toContain('"probabilities"')
  })
})
