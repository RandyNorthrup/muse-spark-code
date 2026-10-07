import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeVerify, type RuntimeVerifyDeps } from '../../../src/runtime/features/verify'
import { parseMhpResult } from '../../../src/shared/hostApi/protocol'
import { MHP } from '../../../src/shared/constants'
import type { HostServices } from '../../../src/shared/hostApi/methods'
import { fingerprint } from '../../../src/core/verify/fingerprint'

const owners: ReturnType<typeof createRuntimeVerify>[] = []
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()))
})

function setup() {
  const state = { version: 1, text: 'before\r\ntext\r\n', dirty: false, isTrusted: true }
  const uri = 'file:///ws/src/file.ts'
  const requests: string[] = []
  const format = vi.fn<() => unknown>(() => [])
  const read = vi.fn(() => ({
    document: { uri, version: state.version, dirty: state.dirty, languageId: 'typescript' },
    text: state.text,
  }))
  const host: HostServices = {
    request: (method) => {
      requests.push(method)
      let result: unknown
      if (method === 'documents/read') result = read()
      else if (method === 'codeIntel/format') result = format()
      else throw new Error('unexpected editor request')
      return Promise.resolve(
        parseMhpResult(method, { jsonrpc: MHP.jsonRpcVersion, id: 1, result }).result,
      )
    },
    notify: () => undefined,
  }
  const diagnostics = vi.fn<RuntimeVerifyDeps['settledDiagnostics']>((requested, version) =>
    Promise.resolve({ uri: requested, version, diagnostics: [] }),
  )
  const owner = createRuntimeVerify({
    workspaceRoot: '/ws',
    platform: 'linux',
    host,
    realPath: (file) => Promise.resolve(file),
    assertCurrent: () => {
      if (!state.isTrusted) throw new Error('restricted')
    },
    settings: () => ({ diagnosticsAfterEdits: true, formatOnEdit: true, checkCommands: [] }),
    settledDiagnostics: diagnostics,
  })
  owners.push(owner)
  const file = { relative: 'src/file.ts', absolute: '/ws/src/file.ts' }
  const signal = new AbortController().signal
  return { state, uri, requests, format, read, diagnostics, owner, file, signal }
}

describe('portable versioned editor verification', () => {
  it('reports a version-attested diagnostic using workspace paths and one-based positions', async () => {
    const { owner, diagnostics, uri, file, signal } = setup()
    diagnostics.mockResolvedValue({
      uri,
      version: 1,
      diagnostics: [
        {
          uri,
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
          severity: 'error',
          message: 'broken',
          source: 'test server',
        },
      ],
    })
    expect(await owner.verify.diagnosticsAfterEdit([file], signal)).toEqual([
      {
        file,
        entries: [
          {
            path: 'src/file.ts',
            severity: 'error',
            line: 1,
            column: 2,
            message: 'broken',
            source: 'test server',
          },
        ],
      },
    ])
  })

  it('keeps absent reports and dirty documents unchecked', async () => {
    const { owner, diagnostics, file, signal, state } = setup()
    diagnostics.mockResolvedValue(undefined)
    expect(await owner.verify.diagnosticsAfterEdit([file], signal)).toEqual([
      { file, entries: [], unchecked: 'noReport' },
    ])
    diagnostics.mockClear()
    state.dirty = true
    expect(await owner.verify.diagnosticsAfterEdit([file], signal)).toEqual([
      { file, entries: [], unchecked: 'unsaved' },
    ])
    expect(diagnostics).not.toHaveBeenCalled()
  })

  it.each(['version', 'text', 'fingerprint', 'reportVersion'])(
    'refuses changed %s before reporting clean',
    async (changed) => {
      const { owner, diagnostics, file, signal, state, uri } = setup()
      diagnostics.mockImplementation(() => {
        if (changed === 'version') state.version += 1
        else if (changed === 'text') state.text = 'external save'
        return Promise.resolve({
          uri,
          version: changed === 'reportVersion' ? 2 : 1,
          diagnostics: [],
        })
      })
      const target =
        changed === 'fingerprint' ? { ...file, fingerprint: fingerprint('other bytes') } : file
      expect(await owner.verify.diagnosticsAfterEdit([target], signal)).toEqual([
        { file: target, entries: [], unchecked: 'changed' },
      ])
    },
  )

  it('refuses malformed reports and untrusted access without returning clean', async () => {
    const { owner, diagnostics, file, signal, state, requests } = setup()
    diagnostics.mockResolvedValue({ uri: 'file:///ws/file', diagnostics: [] })
    expect(await owner.verify.diagnosticsAfterEdit([file], signal)).toEqual([
      { file, entries: [], unchecked: 'notShown' },
    ])
    requests.length = 0
    state.isTrusted = false
    expect(await owner.verify.diagnosticsAfterEdit([file], signal)).toEqual([
      { file, entries: [], unchecked: 'notShown' },
    ])
    expect(requests).toEqual([])
  })

  it('runs no editor service after a batch changed executable configuration', async () => {
    const { owner, file, signal, requests, diagnostics } = setup()
    const config = {
      relative: String.raw`nested\eslint.config.js`,
      absolute: '/ws/nested/eslint.config.js',
    }
    expect(await owner.verify.diagnosticsAfterEdit([file, config], signal)).toEqual(
      [file, config].map((target) => ({ file: target, entries: [], unchecked: 'codeLoading' })),
    )
    expect(await owner.verify.formatAfterEdit(config.absolute, 'code')).toBeUndefined()
    expect(requests).toEqual([])
    expect(diagnostics).not.toHaveBeenCalled()
  })

  it('returns formatted CRLF text for the guarded writer and refuses stale formatting', async () => {
    const { owner, state, format, requests, file } = setup()
    const text = state.text
    format.mockReturnValue([
      {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
        newText: 'formatted',
      },
    ])
    expect(await owner.verify.formatAfterEdit(file.absolute, text)).toBe('before\r\nformatted\r\n')
    expect(requests).toEqual(['documents/read', 'codeIntel/format', 'documents/read'])
    format.mockImplementation(() => {
      state.version += 1
      return [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'unsafe',
        },
      ]
    })
    expect(await owner.verify.formatAfterEdit(file.absolute, text)).toBeUndefined()
  })

  it('drains a suspended report on cancellation and refuses later work', async () => {
    const { owner, diagnostics, file, signal } = setup()
    const held = Promise.withResolvers<unknown>()
    const reached = Promise.withResolvers<undefined>()
    diagnostics.mockImplementation(() => {
      reached.resolve(undefined)
      return held.promise
    })
    const reading = owner.verify.diagnosticsAfterEdit([file], signal)
    await reached.promise
    const closing = owner.dispose()
    expect(owner.dispose()).toBe(closing)
    held.resolve(undefined)
    expect(await reading).toEqual([{ file, entries: [], unchecked: 'stopped' }])
    await closing
    await expect(owner.verify.formatAfterEdit(file.absolute, '')).rejects.toThrow()
  })
})
