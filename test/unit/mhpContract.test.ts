import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { MHP, MHP_ERROR_CODES } from '../../src/shared/constants'
import {
  MHP_CAPABILITIES,
  offeredCapabilitiesSchema,
  selectMhpRoute,
  isMhpVersionSupported,
} from '../../src/shared/hostApi/capabilities'
import {
  MHP_EDITORS,
  MHP_FEATURES,
  featureSchema,
  mhpRegistryProblems,
} from '../../src/shared/hostApi/features'
import {
  MHP_METHODS,
  type HostServices,
  type MhpParams,
  type MhpResult,
} from '../../src/shared/hostApi/methods'
import {
  failureFrameSchema,
  parseMhpCall,
  parseMhpResult,
  type MhpFailureFrame,
} from '../../src/shared/hostApi/protocol'

const uri = 'file:///workspace/main.ts'
const position = { line: 0, character: 1 }
const range = { start: position, end: { line: 0, character: 2 } }
const document = { uri, version: 2, dirty: false, languageId: 'typescript' }
const edits = { uri, expectedVersion: 1, edits: [{ range, newText: 'x' }], undoLabel: 'test-edit' }
const initialize = {
  host: { id: 'fake-host', version: '1.0.0' },
  protocolRange: { minimum: MHP.minimumVersion, maximumExclusive: MHP.maximumVersionExclusive },
  capabilities: [...MHP_CAPABILITIES],
  locale: 'en',
  theme: { kind: 'dark', tokens: { '--muse-editor-background': '#000000' } },
  folders: [{ uri: 'file:///workspace', name: 'workspace' }],
  trusted: true,
}
const call = (method: string, params: unknown, id: string | number = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
})
const notification = (method: string, params: unknown) => ({ jsonrpc: '2.0', method, params })

describe('MHP 1.5 boundary and native export', () => {
  it('round trips initialization and a versioned atomic edit with one undo label', () => {
    expect(MHP_METHODS.initialize.direction).toBe('hostToRuntime')
    expect(MHP_METHODS.shutdown.direction).toBe('hostToRuntime')
    const frame = call('initialize', initialize)
    const wire = JSON.stringify(frame)
    expect(parseMhpCall(JSON.parse(wire))).toEqual(frame)
    expect(
      parseMhpResult('initialize', {
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: MHP.version, capabilities: [...MHP_CAPABILITIES] },
      }).result,
    ).toEqual({ protocolVersion: MHP.version, capabilities: [...MHP_CAPABILITIES] })
    expect(parseMhpCall(call('documents/applyEdits', edits)).params).toEqual(edits)
    expect(
      parseMhpResult('documents/applyEdits', { jsonrpc: '2.0', id: 1, result: document }).result,
    ).toEqual(document)
  })

  it.each(['expectedVersion', 'undoLabel', 'edits'])('rejects an edit missing %s', (field) => {
    const invalid = Object.fromEntries(Object.entries(edits).filter(([key]) => key !== field))
    expect(() => parseMhpCall(call('documents/applyEdits', invalid))).toThrow()
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe version %s',
    (expectedVersion) => {
      expect(() =>
        parseMhpCall(call('documents/applyEdits', { ...edits, expectedVersion })),
      ).toThrow()
    },
  )

  it('rejects empty edits and malformed positions before reaching an adapter', () => {
    expect(() => parseMhpCall(call('documents/applyEdits', { ...edits, edits: [] }))).toThrow()
    expect(() =>
      parseMhpCall(
        call('editor/open', { uri, range: { ...range, end: { line: -1, character: 0 } } }),
      ),
    ).toThrow()
  })

  it('refuses empty undo labels, dialog choices and request ids', () => {
    expect(() => parseMhpCall(call('documents/applyEdits', { ...edits, undoLabel: '' }))).toThrow()
    expect(() =>
      parseMhpCall(call('ui/confirm', { title: 'test', message: 'test', choices: [] })),
    ).toThrow()
    expect(() =>
      parseMhpCall(
        call('ui/confirm', {
          title: 'test',
          message: 'test',
          choices: [{ id: '', title: 'test' }],
        }),
      ),
    ).toThrow()
    expect(() => parseMhpCall(call('shutdown', {}, ''))).toThrow()
  })

  it('keeps hunk decisions and paid popup choices as opaque ids including cancellation', () => {
    const hunk = { id: 'h1', uri, expectedVersion: 1, range, before: 'a', after: 'b' }
    expect(parseMhpCall(call('diff/review', { reviewId: 'r1', hunks: [hunk] })).params).toEqual({
      reviewId: 'r1',
      hunks: [hunk],
    })
    for (const decision of ['accept', 'reject', 'cancel']) {
      expect(
        parseMhpCall(notification('diff/didDecide', { reviewId: 'r1', hunkId: 'h1', decision }))
          .method,
      ).toBe('diff/didDecide')
    }
    const choices = ['once', 'always', 'deny'].map((id) => ({ id, title: id }))
    expect(
      parseMhpCall(
        call('ui/confirm', { title: 'test-paid-modal', message: 'test-price-and-budget', choices }),
      ).method,
    ).toBe('ui/confirm')
    for (const result of [...choices.map((item) => item.id), null]) {
      expect(parseMhpResult('ui/confirm', { jsonrpc: '2.0', id: 1, result }).result).toBe(result)
    }
  })

  it('round trips diagnostics and host-to-runtime Tab completions', () => {
    const result = [{ uri, range, severity: 'error', message: 'test-diagnostic', code: 1 }]
    expect(parseMhpResult('diagnostics/get', { jsonrpc: '2.0', id: 1, result }).result).toEqual(
      result,
    )
    const params = {
      uri,
      position,
      version: 2,
      context: { prefix: 'a', suffix: 'b', trigger: 'invoke' },
    }
    expect(parseMhpCall(call('tab/complete', params)).params).toEqual(params)
    expect(MHP_METHODS['tab/complete'].direction).toBe('hostToRuntime')
    expect(
      parseMhpResult('tab/complete', {
        jsonrpc: '2.0',
        id: 1,
        result: [{ id: 'c1', text: 'x', range }],
      }).result,
    ).toHaveLength(1)
  })

  it('rejects unknown methods, prototype names, batches, extra fields and wrong RPC versions', () => {
    for (const frame of [
      call('secrets/get', {}),
      call('toString', {}),
      [call('shutdown', {})],
      { ...call('shutdown', {}), jsonrpc: '1.0' },
      { ...call('shutdown', {}), extra: true },
      call('shutdown', { apiKey: 'forbidden-field' }),
    ]) {
      expect(() => parseMhpCall(frame)).toThrow()
    }
  })

  it('requires ids only for requests, and cancellation remains bidirectional', () => {
    expect(() => parseMhpCall(notification('documents/read', { uri }))).toThrow()
    expect(() => parseMhpCall(call('documents/didClose', { uri }))).toThrow()
    expect(parseMhpCall(notification('$/cancelRequest', { id: 'request-1' })).params).toEqual({
      id: 'request-1',
    })
    expect(MHP_METHODS['$/cancelRequest'].direction).toBe('bidirectional')
  })

  it('rejects malformed results rather than an empty success', () => {
    for (const result of [
      {},
      { ...document, version: -1 },
      { ...document, token: 'forbidden-field' },
    ]) {
      expect(() => parseMhpResult('documents/read', { jsonrpc: '2.0', id: 1, result })).toThrow()
    }
    expect(() =>
      parseMhpResult('shutdown', {
        jsonrpc: '2.0',
        id: 1,
        result: null,
        error: { code: MHP_ERROR_CODES.cancelled, message: 'MHP_CANCELLED' },
      }),
    ).toThrow()
  })

  it('never offers secrets, password input, token results or credential environment variables', () => {
    expect(Object.keys(MHP_METHODS).some((method) => method.startsWith('secrets/'))).toBe(false)
    expect(() =>
      parseMhpCall(call('ui/input', { title: 'test', prompt: 'test', password: true })),
    ).toThrow()
    expect(() =>
      parseMhpResult('auth/github', {
        jsonrpc: '2.0',
        id: 1,
        result: { authenticated: true, token: 'forbidden-field' },
      }),
    ).toThrow()
    const params = { cwd: uri, executable: 'test-agent', args: ['auth', 'set'], env: {} }
    expect(parseMhpCall(call('terminal/create', params)).params).toEqual(params)
    expect(
      parseMhpCall(call('terminal/create', { ...params, env: { LANG: 'en_US.UTF-8' } })).method,
    ).toBe('terminal/create')
    for (const name of ['META_API_KEY', 'OPENAI_API_KEY', 'GH_TOKEN', 'NODE_OPTIONS']) {
      expect(() =>
        parseMhpCall(call('terminal/create', { ...params, env: { [name]: 'forbidden-field' } })),
      ).toThrow()
    }
  })

  it('bounds selection excerpts and rejects non-Muse theme tokens', () => {
    const selection = {
      uri,
      version: 1,
      range,
      excerpt: 'x'.repeat(MHP.maximumSelectionChars),
      truncated: true,
    }
    expect(parseMhpCall(notification('editor/didChangeSelection', { selection })).params).toEqual({
      selection,
    })
    expect(() =>
      parseMhpCall(
        notification('editor/didChangeSelection', {
          selection: { ...selection, excerpt: `${selection.excerpt}x` },
        }),
      ),
    ).toThrow()
    expect(() =>
      parseMhpCall(
        call('initialize', {
          ...initialize,
          theme: { kind: 'dark', tokens: { '--vscode-editor-background': '#000' } },
        }),
      ),
    ).toThrow()
  })

  it('rejects external executable URLs and secret-shaped settings keys', () => {
    for (const external of [
      'javascript:alert(1)',
      'file:///workspace/key',
      'data:text/html,test',
    ]) {
      expect(() => parseMhpCall(call('ui/openExternal', { uri: external }))).toThrow()
    }
    expect(() => parseMhpCall(call('settings/get', { key: 'META_API_KEY' }))).toThrow()
  })

  it('parses every error code and refuses raw provider errors and unknown data fields', () => {
    for (const code of Object.values(MHP_ERROR_CODES)) {
      const frame: MhpFailureFrame = {
        jsonrpc: '2.0',
        id: null,
        error: { code, message: 'MHP_ERROR' },
      }
      expect(failureFrameSchema.parse(frame)).toEqual(frame)
    }
    expect(
      failureFrameSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: 999, message: 'MHP_ERROR' },
      }).success,
    ).toBe(false)
    expect(
      failureFrameSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: MHP_ERROR_CODES.internalError,
          message: 'MHP_ERROR',
          data: { token: 'forbidden-field' },
        },
      }).success,
    ).toBe(false)
    expect(
      failureFrameSchema.safeParse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: MHP_ERROR_CODES.internalError, message: 'profile-specific raw error' },
      }).success,
    ).toBe(false)
  })

  it('keeps HostServices injectable and preserves typed params and results', () => {
    expectTypeOf<HostServices['request']>().toBeFunction()
    expectTypeOf<MhpParams<'documents/applyEdits'>>().toEqualTypeOf<typeof edits>()
    expectTypeOf<MhpResult<'documents/list'>>().toEqualTypeOf<(typeof document)[]>()
    expectTypeOf(
      parseMhpResult('documents/list', { jsonrpc: '2.0', id: 1, result: [document] }).result,
    ).toEqualTypeOf<MhpResult<'documents/list'>>()
  })

  it('refuses silent re-adoption of the frozen version and preserves all snapshot bytes', async () => {
    const files = [
      'src/shared/hostApi/mhp-v1.schema.json',
      'src/shared/hostApi/mhp-v1.lock.json',
      'src/shared/hostApi/mhp-v1.1.schema.json',
      'src/shared/hostApi/mhp-v1.1.lock.json',
    ]
    const before = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    await expect(
      promisify(execFile)(
        process.execPath,
        ['scripts/mhp-schema.mjs', '--adopt-version=mhp/1.5.0'],
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow('MHP_VERSION_ALREADY_ADOPTED')
    expect(await Promise.all(files.map((file) => readFile(file, 'utf8')))).toEqual(before)
  })

  it('exports current JSON Schemas for the native plugins', async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['scripts/mhp-schema.mjs', '--check'],
      { cwd: process.cwd() },
    )
    expect(stdout).toContain('MHP schemas match.')
    const snapshot = JSON.parse(await readFile('src/shared/hostApi/mhp-v1.schema.json', 'utf8'))
    expect(snapshot).toMatchObject({
      protocol: 'mhp/1.5.0',
      methods: {
        initialize: {
          call: {
            properties: {
              params: {
                properties: {
                  capabilities: { uniqueItems: true, contains: { const: 'lifecycle' } },
                },
              },
            },
          },
          result: {
            properties: {
              result: {
                properties: {
                  capabilities: { uniqueItems: true, contains: { const: 'lifecycle' } },
                },
              },
            },
          },
        },
      },
    })
  })
})

describe('MHP negotiation and feature skeleton', () => {
  // constants.ts writes the limit as a literal so bundles that never use MHP
  // can drop the block; this keeps the literal from drifting.
  it('keeps the integer limit at the largest safe integer', () => {
    expect(MHP.maximumInteger).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([
    ['mhp/1.0.0', 'mhp/2.0.0', true],
    ['mhp/0.9.0', 'mhp/1.0.1', false],
    ['mhp/1.4.0', 'mhp/1.5.0', false],
    ['mhp/1.5.0', 'mhp/1.6.0', true],
    ['mhp/1.0.0', 'mhp/1.0.0', false],
    ['mhp/2.0.0', 'mhp/3.0.0', false],
    ['mhp/0.0.0', 'mhp/1.0.0', false],
    ['mhp/1.0', 'mhp/2.0.0', false],
    ['mhp/01.0.0', 'mhp/2.0.0', false],
  ])('negotiates [%s, %s)', (minimum, maximumExclusive, expected) => {
    expect(isMhpVersionSupported({ minimum, maximumExclusive })).toBe(expected)
  })

  it('selects a native group only when advertised and keeps every fallback explicit', () => {
    for (const definition of Object.values(MHP_METHODS)) {
      expect(
        selectMhpRoute(definition.capability, [definition.capability], definition.fallback),
      ).toBe('native')
      expect(selectMhpRoute(definition.capability, [], definition.fallback)).toBe(
        definition.fallback,
      )
    }
    expect(offeredCapabilitiesSchema.safeParse(['secrets']).success).toBe(false)
    expect(
      offeredCapabilitiesSchema.safeParse(['lifecycle', 'documents', 'documents']).success,
    ).toBe(false)
    expect(offeredCapabilitiesSchema.safeParse(['documents']).success).toBe(false)
  })

  it('covers F1–F56, every editor and every method without claiming adapter certification', () => {
    expect(mhpRegistryProblems(MHP_FEATURES)).toEqual([])
    expect(MHP_FEATURES.map((feature) => feature.id)).toEqual(
      Array.from({ length: 56 }, (_, index) => `F${String(index + 1)}`),
    )
    for (const feature of MHP_FEATURES) {
      expect(Object.keys(feature.editors)).toEqual([...MHP_EDITORS])
      expect(
        Object.values(feature.editors).every(
          (cell) => cell.status === 'M' && cell.evidence.length === 0,
        ),
      ).toBe(true)
    }
  })

  it('rejects missing editor rows, duplicate features, unmapped methods and W without evidence', () => {
    const first = MHP_FEATURES[0]!
    const editors = Object.fromEntries(
      Object.entries(first.editors).filter(([editor]) => editor !== 'jetbrains'),
    )
    expect(featureSchema.safeParse({ ...first, editors }).success).toBe(false)
    expect(mhpRegistryProblems([...MHP_FEATURES, first])).toContain('MHP_DUPLICATE_FEATURE')
    expect(mhpRegistryProblems(MHP_FEATURES.slice(1))).toContain('MHP_FEATURE_COUNT')
    const missing = MHP_FEATURES.map((feature) => ({
      ...feature,
      methods: feature.methods.filter((method) => method !== 'initialize'),
    }))
    expect(mhpRegistryProblems(missing)).toContain('MHP_UNMAPPED_METHOD:initialize')
    const unsupported = MHP_FEATURES.map((feature) =>
      feature.id === 'F1'
        ? {
            ...feature,
            editors: { ...feature.editors, vscode: { status: 'W' as const, evidence: [] } },
          }
        : feature,
    )
    expect(mhpRegistryProblems(unsupported)).toContain('MHP_MISSING_EVIDENCE:F1:vscode')
  })
})
