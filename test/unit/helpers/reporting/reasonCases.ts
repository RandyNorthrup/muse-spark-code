// Shared context and assertion for the accounts/security reason suites
// (RVCM1133B): one copy of the boilerplate instead of a clone in every
// file that reads a source through its real port.
import { expect } from 'vitest'
import { REPORT_FIXTURE_AS_OF } from './snapshot'
import type { tempDirTracker } from './tempDir'

export type ReasonTempDirs = ReturnType<typeof tempDirTracker>

export type ReasonRun = (dataDir: string) => Promise<{
  record: { status: string; reason: unknown }
  data: unknown
}>

export interface ReasonWant {
  readonly status: string
  readonly reasons: readonly string[]
  readonly check?: (data: unknown) => void
}

/** A source-read context for the reason suites, identical in every file. */
export const reasonContext = (kind: 'accounts' | 'security') => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: {
    kind,
    asOf: REPORT_FIXTURE_AS_OF,
    scope: '',
    full: false,
    network: false,
    failOn: [],
  },
  signal: new AbortController().signal,
})

/** One reason record, asserted the same way in every suite: the status and
 * each true reason. Only fixed sentences travel in a reason, so no record
 * text may appear in one. */
export function assertReasonRecord(
  result: { record: { status: string; reason: unknown } },
  want: Pick<ReasonWant, 'status' | 'reasons'>,
): void {
  expect(result.record.status).toBe(want.status)
  const reason = typeof result.record.reason === 'string' ? result.record.reason : ''
  for (const sentence of want.reasons) expect(reason).toContain(sentence)
  expect(reason).not.toContain('{nope}')
  expect(reason).not.toContain('bogus')
}

/** One reason case, asserted the same way in every suite: the record above
 * plus the surviving rows. */
export async function assertReasonResult(
  temps: ReasonTempDirs,
  prefix: string,
  run: ReasonRun,
  want: ReasonWant,
): Promise<void> {
  const result = await run(await temps.dir(prefix))
  assertReasonRecord(result, want)
  want.check?.(result.data)
}

/** Malformed ports bypass constructors; a valid exemplar can infer the expected type. */
export function malformed<T>(value: unknown, _validExample?: T): T {
  // Test-only fault injection bypasses the port type to exercise its runtime validator (PLAN §8 CM1133R4).
  return value as T
}
