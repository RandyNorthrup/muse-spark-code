import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'
import { RecordingReader, RecordingScope } from '../../src/core/context/recordingReader'
import { contentHash, ProvenanceLedger } from '../../src/core/schedules/provenance'

const source = { kind: 'tool', callId: 'test-reader' } as const
const eslint = new ESLint()
beforeAll(async () => {
  await eslint.lintText('export {}', { filePath: 'src/core/context/workspaceContext.ts' })
})

describe('structural recording inputs', () => {
  it('RVM115U5 reader: file and cached reads in concurrent derivations have separate closed inventories', async () => {
    const reader = new RecordingReader()
    const held = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const first = reader.run(async (scope) => {
      reader.capture({ bytes: 'first file', source })
      entered.resolve(undefined)
      await held.promise
      return scope.read('first cached', 'first cached', source)
    })
    await entered.promise
    const second = await reader.run(async (scope) => {
      await Promise.resolve()
      reader.capture({ bytes: 'second file', source })
      return scope.read('second cached', 'second cached', source)
    })
    held.resolve(undefined)
    const result = await first
    expect(result.scope.hashes()).toEqual(
      ['first file', 'first cached'].map((bytes) => contentHash(bytes)),
    )
    expect(second.scope.hashes()).toEqual(
      ['second file', 'second cached'].map((bytes) => contentHash(bytes)),
    )
  })

  it('RVM115U5 reader: unavailable read identities leave an uncertified scope', async () => {
    const reader = new RecordingReader()
    const recorded = await reader.run(async () => {
      reader.capture({ bytes: 'unidentified', source })
      reader.unrecordable()
      await Promise.resolve()
      return 'projection'
    })
    expect(recorded.scope.inventory()).toBeUndefined()
    const ledger = new ProvenanceLedger()
    ledger.preFire('unidentified', source)
    ledger.derive(recorded.value, recorded.scope, 'unidentified-read')
    expect(ledger.allows(recorded.value)).toBe(false)
  })

  it('RVM115U5 reader: a closed scope pins read bytes and rejects later additions', () => {
    const bytes = Buffer.from('allowed')
    const { scope } = RecordingScope.build((reader) => reader.read(bytes, bytes, source))
    bytes.fill(0)
    const ledger = new ProvenanceLedger()
    ledger.preFire('allowed', source)
    ledger.derive('projection', scope, 'projection')
    expect(ledger.allows('projection')).toBe(true)
    expect(() => scope.read('late', 'late', source)).toThrow('closed')
  })

  it.each(
    [
      'src/core/context/workspaceContext.ts',
      'src/core/context/rules.ts',
      'src/core/context/skills.ts',
      'src/core/context/customAgents.ts',
      'src/core/codeIntel/repoMap.ts',
      'src/core/memory/memoryStore.ts',
      'src/core/memory/memoryIndex.ts',
      'src/core/backends/modelapi/ModelApiHost.ts',
      'src/core/backends/modelapi/instructions.ts',
      'src/core/backends/modelapi/mediaBudget.ts',
      'src/core/backends/modelapi/verifyLoop.ts',
      'src/core/backends/modelapi/schedulesEntry.ts',
    ].flatMap((filePath) =>
      ['node:fs/promises', 'node:child_process', '../../host/git'].map((specifier) => ({
        filePath,
        specifier,
      })),
    ),
  )(
    'RVM115U5 type boundary: $filePath cannot import $specifier directly',
    async ({ filePath, specifier }) => {
      const results = await eslint.lintText(`import * as native from '${specifier}'\nvoid native`, {
        filePath,
      })
      expect(
        results
          .flatMap((result) => result.messages)
          .some((message) => message.ruleId === 'no-restricted-imports'),
      ).toBe(true)
    },
  )
})
