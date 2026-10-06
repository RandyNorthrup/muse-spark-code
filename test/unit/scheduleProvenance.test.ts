import { RecordingScope } from '../../src/core/context/recordingReader'
import { describe, expect, it } from 'vitest'
import {
  contentHash,
  ProvenanceLedger,
  type ContentSource,
} from '../../src/core/schedules/provenance'

const SOURCE: ContentSource = {
  kind: 'file',
  contentHash: contentHash('source bytes'),
  file: { path: '/workspace/src/source.txt', dev: '1', ino: '2', size: 12, mtime: '100' },
}

function recorded(...bytes: readonly string[]): RecordingScope {
  return RecordingScope.build((reader) => {
    for (const input of bytes) reader.read(input, input, SOURCE)
  }).scope
}

describe('scheduled byte provenance ledger', () => {
  it('RVM115U5 structural: only closed recording scopes certify all consumed inputs', () => {
    const ledger = new ProvenanceLedger()
    ledger.preFire('allowed leaf', SOURCE)
    ledger.derive('forgotten inventory', undefined, 'incomplete-summary')
    const complete = RecordingScope.build((reader) => {
      reader.read('allowed leaf', 'allowed leaf', SOURCE)
      ledger.derive('open inventory', reader, 'open-summary')
    })
    ledger.derive('complete inventory', complete.scope, 'complete-summary')
    const incomplete = RecordingScope.build((reader) => {
      reader.read('allowed leaf', 'allowed leaf', SOURCE)
      reader.unrecordable()
    })
    ledger.derive('explicitly incomplete inventory', incomplete.scope, 'incomplete-summary')
    expect(ledger.allows('forgotten inventory')).toBe(false)
    expect(ledger.allows('open inventory')).toBe(false)
    expect(ledger.allows('explicitly incomplete inventory')).toBe(false)
    expect(ledger.allows('complete inventory')).toBe(true)
    expect(() => complete.scope.read('late', 'late', SOURCE)).toThrow('closed')
  })

  it('RVM115U3 P2-7: equal bytes in different buffers and replay objects retain proof by SHA-256', () => {
    const ledger = new ProvenanceLedger()
    const bytes = Buffer.from('source bytes')
    ledger.preFire(bytes, SOURCE)
    expect(ledger.allows(Buffer.from(bytes))).toBe(true)
    ledger.decided(
      JSON.stringify({ output: 'read bytes' }),
      { kind: 'tool', callId: 'read' },
      'decision',
    )
    expect(ledger.allows(JSON.stringify(JSON.parse('{"output":"read bytes"}')))).toBe(true)
    expect(ledger.allows('read bytes changed')).toBe(false)
    expect(ledger.entry(bytes)?.source).toEqual(SOURCE)
  })

  it('RVM115U3 P1-2: opaque content cannot claim a decision or authorize a transformation', () => {
    const ledger = new ProvenanceLedger()
    ledger.opaque('opaque protected output', 'opaque-tool')
    ledger.derive('compacted opaque output', recorded('opaque protected output'), 'compaction')
    expect(ledger.allows('opaque protected output')).toBe(false)
    expect(ledger.allows('compacted opaque output')).toBe(false)
    expect(ledger.entry('opaque protected output')).toMatchObject({ class: 'opaque' })
    expect(ledger.entry('opaque protected output')).not.toHaveProperty('decisionId')
    ledger.decideTool('other-tool')
    expect(ledger.allows('opaque protected output')).toBe(false)
    ledger.decideTool('opaque-tool')
    expect(ledger.allows('opaque protected output')).toBe(true)
    expect(ledger.allows('compacted opaque output')).toBe(true)
    expect(ledger.entry('opaque protected output')).not.toHaveProperty('decisionId')
  })

  it('RVM115U3 P2-6/7/8: verification, media fitting, dates and compaction retain all input hashes', () => {
    const ledger = new ProvenanceLedger()
    ledger.preFire('unchanged rule bytes', SOURCE)
    ledger.decided('authorized edit output', { kind: 'tool', callId: 'write' }, 'edit-decision')
    const fitted = ledger.derive('smaller media', recorded('authorized edit output'), 'media-fit')
    const note = ledger.derive(
      'clean verification',
      recorded('authorized edit output'),
      'verification-note',
    )
    const refreshed = ledger.derive(
      'new date, same rules',
      recorded('unchanged rule bytes'),
      'instruction-refresh',
    )
    ledger.derive(
      'summary',
      recorded('smaller media', 'clean verification', 'new date, same rules'),
      'compaction',
    )
    expect(ledger.allows('summary')).toBe(true)
    expect(ledger.entry('summary')).toMatchObject({
      class: 'derived',
      derivedFrom: [fitted, note, refreshed],
    })
    ledger.derive('unknown source summary', recorded('smaller media', 'unseen bytes'), 'compaction')
    expect(ledger.allows('unknown source summary')).toBe(false)
    ledger.derive('empty source summary', recorded(), 'compaction')
    expect(ledger.allows('empty source summary')).toBe(false)
  })

  it('does not erase proved equal bytes, crosses no fire boundary with an opaque tool grant, and rejects cycles', () => {
    const ledger = new ProvenanceLedger()
    const allowedHash = ledger.preFire('delivered', SOURCE)
    ledger.opaque('delivered')
    expect(ledger.allows('delivered')).toBe(true)
    ledger.derive('cycle', recorded('cycle'), 'cycle')
    expect(ledger.allows('cycle')).toBe(false)
    ledger.decideTool('call')
    ledger.opaque('allowed opaque', 'call')
    const next = new ProvenanceLedger([ledger.entry('delivered')!])
    expect(next.allows('delivered')).toBe(true)
    expect(next.allows('allowed opaque')).toBe(false)
    expect(next.entry('delivered')?.hash).toBe(allowedHash)
  })

  it('property: random transformation chains retain provenance exactly when every input is allowed', () => {
    let seed = 115
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed
    }
    for (let chain = 0; chain < 100; chain += 1) {
      const ledger = new ProvenanceLedger()
      const nodes = Array.from({ length: 8 }, (_, index) => {
        const bytes = `leaf ${String(chain)} ${String(index)}`
        const isAllowed = random() % 2 === 0
        const hash = isAllowed ? ledger.decided(bytes, SOURCE, 'decision') : ledger.opaque(bytes)
        return { hash, bytes, isAllowed }
      })
      for (let step = 0; step < 100; step += 1) {
        const count = 1 + (random() % 4)
        const inputs = Array.from({ length: count }, () => nodes[random() % nodes.length]!)
        const isInputsComplete = random() % 2 === 0
        const isAllowed = isInputsComplete && inputs.every((input) => input.isAllowed)
        const bytes = `transformation ${String(chain)} ${String(step)}`
        const hash = ledger.derive(
          bytes,
          RecordingScope.build((reader) => {
            for (const input of inputs) reader.read(input.bytes, input.bytes, SOURCE)
            if (!isInputsComplete) reader.unrecordable()
          }).scope,
          'random-transform',
        )
        expect(ledger.allows(bytes)).toBe(isAllowed)
        nodes.push({ hash, bytes, isAllowed })
      }
    }
  })
})
