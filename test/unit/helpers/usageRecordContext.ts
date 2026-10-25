// One usage-record context for suites building records directly: the
// duplication gate keeps the construction here instead of copied per suite.
import { toEpochMs } from '../../../src/shared/epochMs'
import type { UsageRecordContext } from '../../../src/core/usage/journalRecord'

export function usageRecordContextAt(at: number): UsageRecordContext {
  return {
    id: `call-${String(at)}`,
    at: toEpochMs(at),
    startedAt: toEpochMs(at - 1000),
    client: 'Zed',
    backend: 'modelApi',
    provider: 'custom',
    model: 'test-model',
    kind: 'turn',
    outcome: 'completed',
  }
}
