import { Readable } from 'node:stream'
import { vi } from 'vitest'
import type { JudgeOutcome, JudgeRequest } from '../../src/core/judge/schema'
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

export function source(billing: 'free' | 'paid' = 'free', cost?: number) {
  const judge = vi.fn(() => Promise.resolve(answered()))
  const value: JudgeCliSource = {
    source: 'same',
    model: 'chosen',
    billing,
    worstCaseUsd: () => cost,
    runtime: { judge },
  }
  return { value, judge }
}

export function command(action = 'ask', args: readonly string[] = ['--model', 'chosen']) {
  const parsed = parseCommandLine(['judge', action, ...args])
  if (parsed.command !== 'judge') throw new Error('invalid test command')
  return parsed
}

export function writer(isFlushed = true, isClosed = false) {
  const chunks: string[] = []
  const value: FdWriter = {
    write: (chunk) => {
      chunks.push(chunk)
    },
    flush: vi.fn(() => Promise.resolve(isFlushed)),
    queuedBytes: 0,
    isClosed,
  }
  return { value, text: () => chunks.join('') }
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
