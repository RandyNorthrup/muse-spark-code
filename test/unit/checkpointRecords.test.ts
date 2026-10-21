// The checkpoint records' and archives' malformed-JSON reads
// (src/host/checkpoints/checkpointRecords.ts,
// src/host/checkpoints/checkpointArchives.ts): text that does not parse
// is dropped or skipped; the drop is only ever for malformed text.
import { describe, expect, it } from 'vitest'
import { parseRecord, parseUnit } from '../../src/host/checkpoints/checkpointRecords'

const unit = {
  kind: 'unit',
  owner: { instance: 'i', sessionId: 's', unitKind: 'turn', unitId: 'u' },
  sequence: 1,
  createdAt: 1,
  status: 'complete',
  ranProcesses: false,
  isMarkedIncomplete: false,
  writes: [],
}

const restore = {
  kind: 'restore',
  top: '/ws',
  prefix: '',
  id: 'r',
  sessionId: 's',
  createdAt: 1,
  entries: [],
}

describe('parseUnit', () => {
  it('drops text that is not JSON', () => {
    expect(parseUnit('{nope')).toBe(undefined)
  })

  it('drops JSON of the wrong shape', () => {
    expect(parseUnit('{"kind":"unit"}')).toBe(undefined)
  })

  it('reads a unit record', () => {
    expect(parseUnit(JSON.stringify(unit))?.owner.unitId).toBe('u')
  })
})

describe('parseRecord', () => {
  it('drops text that is not JSON', () => {
    expect(parseRecord('{nope')).toBe(undefined)
  })

  it('reads a restore record', () => {
    expect(parseRecord(JSON.stringify(restore))?.id).toBe('r')
  })
})
