import { ESLint } from 'eslint'
import * as ts from 'typescript'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { memoryStoreOver } from './helpers/fakeMemoryIo'
import { memoryContextIo } from './helpers/fakeContextIo'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  RecordingReader,
  RecordingScope,
  recordProjection,
  recordOperation,
  RECORDING_BUILDERS,
  ReaderContent,
} from '../../src/core/context/recordingReader'
import { contentHash, ProvenanceLedger } from '../../src/core/schedules/provenance'

const brandProbe: { lines: readonly number[]; memoryPortRejected: boolean } = {
  lines: [],
  memoryPortRejected: false,
}
function compileReaderBrand(): typeof brandProbe {
  const filename = path.resolve('test/unit/readerBrandProbe.ts')
  const code = `import { RecordingScope, RecordingReader, recordOperation, type ReaderContent } from '../../src/core/context/recordingReader'
function unread(reader: RecordingScope): ReaderContent<string> { return { value: 'outside' } }
function appended(reader: RecordingScope): ReaderContent<{ inside: string; outside: string }> {
  const content = reader.read({ inside: 'read' }, 'read', { kind: 'tool', callId: 'test' })
  return { value: { ...content.value, outside: 'outside' } }
}
function valid(reader: RecordingScope): ReaderContent<string> { return reader.read('read', 'read', { kind: 'tool', callId: 'test' }) }
declare const rawPort: import('../../src/core/context/contextFiles').ContextIo
async function raw(reader: RecordingScope): Promise<ReaderContent<Uint8Array | undefined>> { return { value: await rawPort.readFile('/workspace/.muse/private.txt') } }
function copied(reader: RecordingScope): ReaderContent<string> { const content = reader.read('read', 'read', { kind: 'tool', callId: 'test' }); return { ...content, value: 'outside' } }
function unrecordedMemory(reader: RecordingReader) { return reader.run(recordOperation, { kind: 'memory', store: { snapshot: async () => [] } }) }
`
  const config = ts.readConfigFile(path.resolve('tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
  const host = ts.createCompilerHost(parsed.options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, onError, create) =>
    file.replaceAll('\\', '/') === filename.replaceAll('\\', '/')
      ? ts.createSourceFile(filename, code, language, true)
      : original(file, language, onError, create)
  const program = ts.createProgram([filename], parsed.options, host)
  const sourceFile = program.getSourceFile(filename)
  if (sourceFile === undefined) throw new Error('Missing brand probe')
  const diagnostics = program.getSemanticDiagnostics(sourceFile)
  return {
    lines: diagnostics
      .filter((entry) =>
        ts.flattenDiagnosticMessageText(entry.messageText, ' ').includes('READER_CONTENT'),
      )
      .map((entry) => sourceFile.getLineAndCharacterOfPosition(entry.start ?? 0).line),
    memoryPortRejected: diagnostics.some(
      (entry) =>
        sourceFile.getLineAndCharacterOfPosition(entry.start ?? 0).line === 10 &&
        ts.flattenDiagnosticMessageText(entry.messageText, ' ').includes('MemoryStore'),
    ),
  }
}

beforeAll(() => {
  Object.assign(brandProbe, compileReaderBrand())
})

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
    const io = memoryContextIo(
      new Map([
        ['/workspace/AGENTS.md', 'first file'],
        ['/workspace/src/AGENTS.md', 'second file'],
      ]),
    )
    const readFile = io.readFile.bind(io)
    io.readFile = async (...args) => {
      if (args[0] === '/workspace/AGENTS.md') {
        entered.resolve(undefined)
        await held.promise
      }
      return await readFile(...args)
    }
    const deps = { io, workspaceRoot: '/workspace', platform: 'linux' as const }
    const first = reader.run(recordOperation, { kind: 'rules', deps, directory: '' })
    await entered.promise
    const second = await reader.run(recordOperation, { kind: 'rules', deps, directory: 'src' })
    held.resolve(undefined)
    const result = await first
    expect(result.scope.hashes()).toEqual([contentHash('first file')])
    expect(second.scope.hashes()).toEqual([contentHash('second file')])
    expect(result.value.file?.text).toBe('first file')
    expect(second.value.file?.text).toBe('second file')
  })

  it('RVM115U5 reader: unavailable read identities leave an uncertified scope', async () => {
    const reader = new RecordingReader()
    const { store } = memoryStoreOver(
      new Map([['/workspace/.agents/memory/MEMORY.md', 'unidentified']]),
      { workspaceRoot: '/workspace', dataRoot: undefined },
    )
    const guarded = store.withIo((io) => ({
      ...io,
      readFile: async (...args) => {
        reader.capture({ bytes: 'unidentified', source })
        reader.unrecordable()
        return await io.readFile(...args)
      },
    }))
    const recorded = await reader.run(recordOperation, { kind: 'memory', store: guarded })
    expect(recorded.scope.inventory()).toBeUndefined()
    const ledger = new ProvenanceLedger()
    ledger.preFire('unidentified', source)
    ledger.derive('projection', recorded.scope, 'unidentified-read')
    expect(ledger.allows('projection')).toBe(false)
  })

  it('RVM115U5 reader: a closed scope pins read bytes and rejects later additions', () => {
    const bytes = Buffer.from('allowed')
    const { scope } = RecordingScope.build(recordProjection, {
      inputs: [{ bytes, source }],
      project: (inputs) => inputs,
    })
    bytes.fill(0)
    const ledger = new ProvenanceLedger()
    ledger.preFire('allowed', source)
    ledger.derive('projection', scope, 'projection')
    expect(ledger.allows('projection')).toBe(true)
    expect(() => scope.read('late', 'late', source)).toThrow('closed')
  })

  it('RVM115U6 P2-1: read content rejects forged authority and cannot have its value overwritten', () => {
    expect(() => {
      Reflect.construct(ReaderContent, ['outside', Symbol('forged')])
    }).toThrow('recording reader')
    const project = vi.spyOn(RecordingScope.prototype, 'project')
    try {
      RecordingScope.build(recordProjection, { inputs: [], project: () => 'read' })
      const content = project.mock.results[0]?.value
      if (!(content instanceof ReaderContent)) throw new Error('Missing read content')
      expect(Object.isFrozen(content)).toBe(true)
      expect(() => Object.defineProperty(content, 'value', { value: 'outside' })).toThrow()
    } finally {
      project.mockRestore()
    }
  })

  it('RVM115U6 P2-1: closed scopes cannot mint content or rerun their adapter', async () => {
    const { store } = memoryStoreOver(new Map(), {
      workspaceRoot: '/workspace',
      dataRoot: undefined,
    })
    const snapshot = vi.spyOn(store, 'snapshot')
    const { scope } = await new RecordingReader().run(recordOperation, { kind: 'memory', store })
    await expect(scope.load()).rejects.toThrow('closed')
    expect(() => scope.readInputs()).toThrow('closed')
    expect(() => {
      Reflect.apply(scope.project, scope, [{ value: 'outside' }, (value: unknown) => value])
    }).toThrow('closed')
    expect(() => scope.context(memoryContextIo(new Map()))).toThrow('closed')
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('RVM115U6 P2-1: every registered builder is a module-level named function with one reader parameter', () => {
    const file = ts.createSourceFile(
      'recordingReader.ts',
      readFileSync(path.resolve('src/core/context/recordingReader.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const declarations = file.statements.filter((entry) => ts.isFunctionDeclaration(entry))
    expect(RECORDING_BUILDERS.map((builder) => builder.name)).toEqual([
      'recordProjection',
      'recordOperation',
    ])
    for (const builder of RECORDING_BUILDERS) {
      const declaration = declarations.find((entry) => entry.name?.text === builder.name)
      expect(declaration).toBeDefined()
      expect(declaration?.parameters).toHaveLength(1)
      expect(declaration?.parameters[0]?.name.getText(file)).toBe('reader')
      expect(builder.length).toBe(1)
      const captured: string[] = []
      const inspect = (node: ts.Node) => {
        if (
          ts.isIdentifier(node) &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
          node.text !== 'reader'
        )
          captured.push(node.text)
        ts.forEachChild(node, inspect)
      }
      if (declaration?.body !== undefined) inspect(declaration.body)
      expect(captured).toEqual([])
    }
  })

  it('RVM115U6 P2-1: arbitrary callbacks cannot close an inventory', async () => {
    const rawRead = vi.fn(() => 'protected outside bytes')
    const callback: typeof recordProjection = (reader) => {
      rawRead()
      return reader.project(reader.readInputs(), reader.projection)
    }
    const asynchronous: typeof recordOperation = async (reader) => {
      rawRead()
      return await reader.load()
    }
    expect(() => RecordingScope.build(callback, { inputs: [], project: () => 'outside' })).toThrow(
      'Unregistered',
    )
    await expect(
      RecordingScope.run(asynchronous, {
        kind: 'rules',
        deps: { io: memoryContextIo(new Map()), workspaceRoot: '/workspace', platform: 'linux' },
        directory: '',
      }),
    ).rejects.toThrow('Unregistered')
    expect(rawRead).not.toHaveBeenCalled()
  })

  it('RVM115U6 P2-1: reader output rejects ordinary content, an unread field and copied brands at compile time', () => {
    expect(brandProbe.lines).toEqual([1, 4, 8, 9])
    expect(brandProbe.memoryPortRejected).toBe(true)
  })

  it.each([
    'node:fs/promises',
    'node:child_process',
    '../../host/git',
    '../../host/skills/skillStore',
  ])('RVM115U6 P2-1: dynamic native/skill-store import %s is forbidden', async (specifier) => {
    const results = await eslint.lintText(`void import(${JSON.stringify(specifier)})`, {
      filePath: 'src/core/context/recordingReader.ts',
    })
    expect(
      results
        .flatMap((result) => result.messages)
        .some((message) => message.ruleId === 'recording/boundary'),
    ).toBe(true)
  })

  it.each([
    'void import(target)',
    "void require('node:fs/promises')",
    "void require('../../host/git')",
    "void require('../../host/skills/skillStore')",
  ])('RVM115U6 P2-1: computed/CommonJS builder access is forbidden: %s', async (code) => {
    const results = await eslint.lintText(code, { filePath: 'src/core/context/recordingReader.ts' })
    expect(
      results
        .flatMap((result) => result.messages)
        .some((message) => message.ruleId === 'recording/boundary'),
    ).toBe(true)
  })

  it.each(
    [
      'src/core/context/recordingReader.ts',
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
      [
        'node:fs/promises',
        'node:child_process',
        '../../host/git',
        '../../host/skills/skillStore',
      ].map((specifier) => ({
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
