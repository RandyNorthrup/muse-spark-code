// M125 lane F1b: the skip's audit facts (D107 §9.6). The shared
// schema admits closed vocabularies only; the journal keeps a full
// audit, omits one that fails the schema or trips the redactor while
// the skip fact itself still lands, and reads old records without
// audits back unchanged.
import { describe, expect, it } from 'vitest'
import { agentEventSchema } from '../../src/shared/agentEvents'
import { fastPathAuditSchema, type FastPathAudit } from '../../src/shared/fastPathAudit'
import {
  buildFlightRecord,
  parseJournalText,
  serializeFlightRecord,
} from '../../src/core/support/flightRecorder'

function audit(overrides: Partial<FastPathAudit> = {}): FastPathAudit {
  return {
    class: 'B1',
    program: 'cat',
    executable: '/usr/bin/cat',
    confinement: 'landlock',
    confinementVersion: 6,
    deadlineMs: 5000,
    excluded: 2,
    ...overrides,
  }
}

function built(inputAudit: FastPathAudit): ReturnType<typeof buildFlightRecord> {
  return buildFlightRecord(
    {
      kind: 'judgeFastSkip',
      code: 'fast-path-allow',
      ext: '0.19.0',
      host: '1.99.0',
      count: inputAudit.excluded,
      audit: inputAudit,
    },
    1000,
  )
}

describe('fast-path audit', () => {
  it('keeps a full audit with its pipeline detail', () => {
    const full = built(
      audit({ engine: 'tev1:4b', pYesMilli: 30, thresholdMilli: 800, excluded: 0 }),
    )
    expect(full.ok).toBe(true)
    if (!full.ok) return
    expect(full.record.audit).toEqual({
      class: 'B1',
      program: 'cat',
      executable: '/usr/bin/cat',
      confinement: 'landlock',
      confinementVersion: 6,
      deadlineMs: 5000,
      excluded: 0,
      engine: 'tev1:4b',
      pYesMilli: 30,
      thresholdMilli: 800,
    })
    expect(full.record.count).toBe(0)
  })

  it('keeps a stat audit with no executable and no pipeline numbers', () => {
    const stat = built({
      class: 'B1',
      program: 'stat',
      confinement: 'landlock',
      confinementVersion: 6,
      deadlineMs: 5000,
      excluded: 1,
    })
    expect(stat.ok).toBe(true)
    if (!stat.ok) return
    expect(stat.record.audit?.executable).toBeUndefined()
    expect(stat.record.audit?.engine).toBeUndefined()
  })

  it('omits the audit but keeps the skip when a field leaves the vocabulary', () => {
    const offSchema = built({
      ...audit(),
      program: 'rg',
      executable: '/tmp/evil',
    } as unknown as FastPathAudit)
    expect(offSchema.ok).toBe(true)
    if (!offSchema.ok) return
    expect(offSchema.record.audit).toBeUndefined()
    expect(offSchema.record.kind).toBe('judgeFastSkip')
  })

  it('omits the audit when the engine trips the redactor', () => {
    const keyShaped = built(audit({ engine: 'AKIAIOSFODNN7EXAMPLE' }))
    expect(keyShaped.ok).toBe(true)
    if (keyShaped.ok) expect(keyShaped.record.audit).toBeUndefined()
  })

  it('round-trips the audit through the journal file', () => {
    const record = built(audit())
    expect(record.ok).toBe(true)
    if (!record.ok) return
    const parsed = parseJournalText(serializeFlightRecord(record.record))
    expect(parsed.skipped).toBe(0)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]?.audit).toEqual(audit())
  })

  it('reads records written without audits back unchanged', () => {
    const record = buildFlightRecord(
      { kind: 'toolCallFailed', code: 'unknown', ext: '0.19.0', host: '1.99.0' },
      1000,
    )
    expect(record.ok).toBe(true)
    if (!record.ok) return
    const parsed = parseJournalText(serializeFlightRecord(record.record))
    expect(parsed.skipped).toBe(0)
    expect(parsed.entries[0]?.audit).toBeUndefined()
  })

  it('refuses audit fields outside their bounds', () => {
    expect(fastPathAuditSchema.safeParse(audit({ pYesMilli: 1001 })).success).toBe(false)
    expect(fastPathAuditSchema.safeParse(audit({ thresholdMilli: -1 })).success).toBe(false)
    expect(fastPathAuditSchema.safeParse(audit({ excluded: -1 })).success).toBe(false)
    expect(fastPathAuditSchema.safeParse({ ...audit(), class: 'B2' }).success).toBe(false)
    expect(fastPathAuditSchema.safeParse(audit({ executable: '/usr/bin/cat;evil' })).success).toBe(
      false,
    )
    expect(fastPathAuditSchema.safeParse(audit({ engine: 'has space' })).success).toBe(false)
  })

  it('parses the skip event the fence emits', () => {
    const event = agentEventSchema.safeParse({
      type: 'judgeFastSkip',
      itemId: 'i1',
      audit: audit(),
    })
    expect(event.success).toBe(true)
  })
})
