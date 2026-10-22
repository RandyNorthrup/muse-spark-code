import { Readable } from 'node:stream'
import type {
  JevAnswer,
  JudgeOutcome,
  JudgeQuestion,
  JudgeRequest,
} from '../../src/core/judge/schema'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import type { JudgeCliSource } from '../../src/runtime/judge/commands'
import type { FdWriter } from '../../src/runtime/exec/fdWriter'

export const REQUEST: JudgeRequest = {
  state: 'git status',
  questions: { risk: { type: 'noul', instructions: 'Is this destructive?' } },
}

export function answered(): JudgeOutcome {
  return {
    outcome: 'answered',
    result: {
      model: 'chosen',
      usage: { input_tokens: 1, output_tokens: 1 },
      answers: { risk: { type: 'noul', noul: 0, probabilities: { true: 0, false: 1 } } },
      muse: {
        risk: {
          source: 'same',
          technique: 'stated',
          model: 'chosen',
          label: 'uncalibrated',
          confidence: 1,
          partial: false,
        },
      },
    },
  }
}

/** Synthetic engine envelopes exercise the CLI/MCP boundary, not a vendor parser. */
export function evidenceCases() {
  const choice: JudgeQuestion = {
    type: 'choice',
    instructions: 'Choose one',
    criteria: { A: 'first', B: 'second' },
  }
  const score: JudgeQuestion = {
    type: 'score',
    instructions: 'Score this',
    criteria: ['low', 'high'],
  }
  const choiceAnswer: JevAnswer = {
    type: 'choice',
    choice: 'A',
    confidence: 1,
    probabilities: { A: 1, B: 0 },
  }
  const scoreAnswer: JevAnswer = {
    type: 'score',
    score: 0,
    confidence: 1,
    probabilities: { '0': 1, '1': 0 },
    legend: { '0': 'low', '1': 'high' },
  }
  const noulAnswer: JevAnswer = {
    type: 'noul',
    noul: 0,
    probabilities: { true: 0, false: 1 },
  }
  const cases: {
    name: string
    question: JudgeQuestion
    answer: JevAnswer
    partial?: boolean
    valid?: boolean
  }[] = [
    {
      name: 'foreign score evidence',
      question: score,
      answer: { ...scoreAnswer, probabilities: { '9': 1 }, legend: { '9': 'foreign' } },
    },
    {
      name: 'foreign zero-mass score level',
      question: score,
      answer: { ...scoreAnswer, probabilities: { '0': 1, '9': 0 } },
    },
    {
      name: 'empty complete choice evidence',
      question: choice,
      answer: { ...choiceAnswer, probabilities: {} },
    },
    {
      name: 'contradictory noul',
      question: REQUEST.questions['risk'] ?? choice,
      answer: { ...noulAnswer, probabilities: { true: 1, false: 0 } },
    },
    {
      name: 'unnormalized noul',
      question: REQUEST.questions['risk'] ?? choice,
      answer: { ...noulAnswer, probabilities: { true: 0, false: 0 } },
    },
    {
      name: 'unnormalized choice',
      question: choice,
      answer: { ...choiceAnswer, probabilities: { A: 0.2, B: 0.2 } },
    },
    {
      name: 'foreign choice option',
      question: choice,
      answer: { ...choiceAnswer, probabilities: { A: 0.5, C: 0.5 } },
      partial: true,
    },
    {
      name: 'choice is not most probable',
      question: choice,
      answer: { ...choiceAnswer, probabilities: { A: 0, B: 1 } },
    },
    {
      name: 'chosen option absent from evidence',
      question: choice,
      answer: { ...choiceAnswer, probabilities: { B: 1 } },
      partial: true,
    },
    {
      name: 'missing choice without partial',
      question: choice,
      answer: { ...choiceAnswer, probabilities: { A: 1 } },
    },
    {
      name: 'missing score without partial',
      question: score,
      answer: { ...scoreAnswer, probabilities: { '0': 1 } },
    },
    {
      name: 'wrong score legend text',
      question: score,
      answer: { ...scoreAnswer, legend: { '0': 'high', '1': 'low' } },
    },
    {
      name: 'incomplete score legend',
      question: score,
      answer: { ...scoreAnswer, legend: { '0': 'low' } },
      partial: true,
    },
    {
      name: 'extra score legend level',
      question: score,
      answer: { ...scoreAnswer, legend: { '0': 'low', '1': 'high', '9': 'foreign' } },
    },
    {
      name: 'score differs from expectation',
      question: score,
      answer: { ...scoreAnswer, score: 1 },
    },
    {
      name: 'empty partial choice evidence',
      question: choice,
      answer: { ...choiceAnswer, probabilities: {} },
      partial: true,
    },
    { name: 'complete choice', question: choice, answer: choiceAnswer, valid: true },
    {
      name: 'partial choice',
      question: choice,
      answer: { ...choiceAnswer, probabilities: { A: 1 } },
      partial: true,
      valid: true,
    },
    {
      name: 'zero-padded partial choice',
      question: choice,
      answer: choiceAnswer,
      partial: true,
      valid: true,
    },
    {
      name: 'tied choice',
      question: choice,
      answer: { ...choiceAnswer, choice: 'B', probabilities: { A: 0.5, B: 0.5 } },
      valid: true,
    },
    {
      name: 'fractional expected score',
      question: score,
      answer: { ...scoreAnswer, score: 0.75, probabilities: { '0': 0.25, '1': 0.75 } },
      valid: true,
    },
    {
      name: 'partial score',
      question: score,
      answer: { ...scoreAnswer, probabilities: { '0': 1 } },
      partial: true,
      valid: true,
    },
    {
      name: 'partial noul',
      question: REQUEST.questions['risk'] ?? choice,
      answer: noulAnswer,
      partial: true,
      valid: true,
    },
    {
      name: 'floating-point noul',
      question: REQUEST.questions['risk'] ?? choice,
      answer: { ...noulAnswer, noul: 0.3, probabilities: { true: 0.1 + 0.2, false: 0.7 } },
      valid: true,
    },
  ]
  return cases.map(({ name, question, answer, partial = false, valid = false }) => {
    const good = answered()
    if (good.outcome !== 'answered') throw new Error('fixture')
    const meta = good.result.muse['risk']
    if (meta === undefined) throw new Error('fixture')
    return {
      name,
      valid,
      request: { ...REQUEST, questions: { risk: question } },
      outcome: {
        outcome: 'answered' as const,
        result: { ...good.result, answers: { risk: answer }, muse: { risk: { ...meta, partial } } },
      },
    }
  })
}

export function source(
  billing: 'free' | 'paid' = 'free',
  cost?: number,
  answer?: JudgeOutcome | Error,
) {
  const calls: { request: JudgeRequest; signal: AbortSignal }[] = []
  const judge: JudgeCliSource['runtime']['judge'] = (request, signal) => {
    calls.push({ request, signal })
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? answered())
  }
  const value: JudgeCliSource = {
    source: 'same',
    model: 'chosen',
    billing,
    worstCaseUsd: () => cost,
    runtime: { judge },
  }
  return { value, judge, calls }
}

export function command(action = 'ask', args: readonly string[] = ['--model', 'chosen']) {
  const parsed = parseCommandLine(['judge', action, ...args])
  if (parsed.command !== 'judge') throw new Error('invalid test command')
  return parsed
}

export function writer(isFlushed = true, isClosed = false) {
  const chunks: string[] = []
  let flushes = 0
  const value: FdWriter = {
    write: (chunk) => {
      chunks.push(chunk)
    },
    flush: () => {
      flushes += 1
      return Promise.resolve(isFlushed)
    },
    queuedBytes: 0,
    isClosed,
  }
  return { value, text: () => chunks.join(''), flushes: () => flushes }
}

export function io(input: string | Uint8Array = JSON.stringify(REQUEST)) {
  const stdout = writer()
  const stderr = writer()
  return {
    stdin: Readable.from([input]),
    stdout: stdout.value,
    stderr: stderr.value,
    output: stdout.text,
    error: stderr.text,
  }
}
