import { vi } from 'vitest'
import type { ExecResult } from '../../../src/runtime/exec/execProtocol'
import type { FdWriter } from '../../../src/runtime/exec/fdWriter'

export function outputWriter(): FdWriter & { chunks: string[] } {
  const chunks: string[] = []
  return {
    chunks,
    write: vi.fn((chunk: string) => {
      chunks.push(chunk)
    }),
    queuedBytes: 0,
    isClosed: false,
    flush: vi.fn(() => Promise.resolve(true)),
  }
}

export function resultRecord(): ExecResult {
  return {
    v: 1,
    status: 'completed',
    exitCode: 0,
    signal: null,
    stopReason: 'end_turn',
    terminal: 'completed',
    incompleteReason: null,
    backend: 'modelApi',
    mode: 'plan',
    model: 'muse-spark',
    sessionId: 'session',
    ephemeral: true,
    finalMessage: 'done',
    filesChanged: [],
    denials: [],
    questionsDeclined: 0,
    inputs: [],
    usage: {
      requests: 1,
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: {
        settled: 0.000002,
        uncertain: 0,
        reserved: 0,
        total: 0.000002,
        isUpperBound: false,
      },
      paid: {
        imageAttempts: 0,
        imagesReturned: 0,
        imagesRefunded: 0,
        imagesUncertain: 0,
        settledUsd: 0,
        uncertainUsd: 0,
      },
    },
    ledger: {
      capUsd: 1,
      breach: false,
      refusal: null,
      lastResponse: {
        n: 1,
        terminal: 'completed',
        incompleteReason: null,
        endedWithoutTerminal: false,
        httpStatus: 200,
        transportError: null,
        usage: 'valid',
        settlement: 'priced',
      },
    },
    limits: { budgetUsd: 1, maxRequests: 30, timeoutSeconds: 1800 },
    durationMs: 1,
    error: null,
  }
}
