import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeCodeIntel } from '../../../src/runtime/features/codeIntel'
import { parseMhpResult } from '../../../src/shared/hostApi/protocol'
import type { HostServices, MhpRequestMethod } from '../../../src/shared/hostApi/methods'
import { MHP } from '../../../src/shared/constants'

const owners: ReturnType<typeof createRuntimeCodeIntel>[] = []
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()))
})
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
function setup(platform: 'linux' | 'win32' = 'linux') {
  const file = platform === 'win32' ? String.raw`C:\ws\src\file.ts` : '/ws/src/file.ts'
  const uri = platform === 'win32' ? 'file:///C:/ws/src/file.ts' : 'file:///ws/src/file.ts'
  const state = { version: 1, dirty: false, isCurrent: true, supportsTools: true, uri }
  const symbol = {
    name: 'a',
    kind: 1,
    location: { uri, range },
    selection: range,
    container: 'module',
  }
  const results = new Map<MhpRequestMethod, unknown>([
    [
      'codeIntel/definition',
      [
        { uri, range },
        { uri: 'untitled:virtual', range },
      ],
    ],
    ['codeIntel/references', [{ uri, range }]],
    ['codeIntel/hover', ['`a`']],
    ['codeIntel/documentSymbols', [symbol]],
    ['codeIntel/workspaceSymbols', [symbol]],
    [
      'codeIntel/callHierarchy',
      { item: symbol, calls: [{ symbol, ranges: [range] }], otherItems: 0 },
    ],
    [
      'codeIntel/rename',
      {
        files: [{ uri, expectedVersion: 1, edits: [{ range, newText: 'b' }] }],
        fileOperations: 'none',
      },
    ],
  ])
  const before = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const requests: { method: string; params: unknown; signal?: AbortSignal }[] = []
  const host: HostServices = {
    request: async (method, params, signal) => {
      requests.push({ method, params, ...(signal !== undefined && { signal }) })
      await before()
      const result =
        method === 'documents/read'
          ? {
              document: {
                uri: state.uri,
                version: state.version,
                dirty: state.dirty,
                languageId: 'typescript',
              },
              text: 'a\r\n',
            }
          : results.get(method)
      return parseMhpResult(method, { jsonrpc: MHP.jsonRpcVersion, id: 1, result }).result
    },
    notify: () => undefined,
  }
  const canonical = vi.fn((path: string) => Promise.resolve(path))
  const owner = createRuntimeCodeIntel({
    host,
    platform,
    workspaceRoot: platform === 'win32' ? String.raw`C:\ws` : '/ws',
    realPath: canonical,
    assertCurrent: () => {
      if (!state.isCurrent) throw new Error('replaced')
    },
    canUseTools: () => state.supportsTools,
    libraryRoots: () => [platform === 'win32' ? String.raw`C:\editor\lib` : '/editor/lib'],
  })
  owners.push(owner)
  return { owner, state, uri, file, requests, before, results, canonical }
}

describe('portable native language services', () => {
  it.each(['linux', 'win32'] as const)(
    'maps the validated native query inventory on %s',
    async (platform) => {
      const { owner, file, requests } = setup(platform)
      expect(await owner.service.open(file)).toEqual({
        text: 'a\r\n',
        languageId: 'typescript',
        isDirty: false,
      })
      expect(await owner.service.definitions(file, range.start)).toEqual([
        { path: file, range },
        { path: undefined, range },
      ])
      expect(await owner.service.references(file, range.start)).toEqual([{ path: file, range }])
      expect(requests.at(-1)?.params).toMatchObject({ includeDeclaration: true })
      expect(await owner.service.hover(file, range.start)).toEqual(['`a`'])
      expect(await owner.service.documentSymbols(file)).toContainEqual(
        expect.objectContaining({ name: 'a', children: [], location: { path: file, range } }),
      )
      expect(await owner.service.workspaceSymbols('a')).toHaveLength(1)
      expect(await owner.service.callHierarchy(file, range.start, 'incoming')).toMatchObject({
        item: { name: 'a' },
        calls: [{ ranges: [range] }],
        otherItems: 0,
      })
      expect(await owner.service.rename(file, range.start, 'b')).toEqual({
        files: [{ path: file, edits: [{ range, newText: 'b' }] }],
        fileOperations: 'none',
      })
      expect(owner.service.libraryRoots()).toHaveLength(1)
    },
  )
  it('distinguishes an absent call hierarchy from a provider failure', async () => {
    const { owner, file, results, before } = setup()
    results.set('codeIntel/callHierarchy', null)
    expect(await owner.service.callHierarchy(file, range.start, 'outgoing')).toBeUndefined()
    before.mockRejectedValue(new Error('native provider failed'))
    await expect(owner.service.hover(file, range.start)).rejects.toThrow('native provider failed')
  })
  it.each(['version', 'dirty'] as const)(
    'refuses %s rename data without publishing edits',
    async (change) => {
      const { owner, file, state } = setup()
      if (change === 'version') state.version = 2
      else state.dirty = true
      await expect(owner.service.rename(file, range.start, 'b')).rejects.toThrow(
        'MHP_CODE_INTEL_STALE_RENAME',
      )
    },
  )
  it('refuses a document reply naming a different resource', async () => {
    const { owner, file, state } = setup()
    state.uri = 'file:///ws/src/other.ts'
    await expect(owner.service.open(file)).rejects.toThrow('MHP_CODE_INTEL_DOCUMENT_MISMATCH')
  })
  it('confines queries and rename targets and refuses protected files before native reads', async () => {
    const { owner, file, requests, results } = setup()
    await expect(owner.service.open('/outside/file.ts')).rejects.toThrow(
      'MHP_CODE_INTEL_PATH_REFUSED',
    )
    await expect(owner.service.open('/ws/.git/config')).rejects.toThrow(
      'MHP_CODE_INTEL_PATH_REFUSED',
    )
    expect(requests).toEqual([])
    results.set('codeIntel/rename', {
      files: [
        { uri: 'file:///outside/file.ts', expectedVersion: 1, edits: [{ range, newText: 'b' }] },
      ],
      fileOperations: 'none',
    })
    await expect(owner.service.rename(file, range.start, 'b')).rejects.toThrow(
      'MHP_CODE_INTEL_PATH_REFUSED',
    )
    expect(requests.map((request) => request.method)).toEqual(['codeIntel/rename'])
  })
  it('rejects a canonical target that changed while confinement waited', async () => {
    const { owner, file, canonical, requests } = setup()
    canonical.mockImplementation((path) =>
      Promise.resolve(path === file ? '/outside/file.ts' : path),
    )
    await expect(owner.service.open(file)).rejects.toThrow('MHP_CODE_INTEL_PATH_REFUSED')
    expect(requests).toEqual([])
  })
  it('reads live selected-model capability and owner admission', async () => {
    const { owner, file, state, requests } = setup()
    state.supportsTools = false
    await expect(owner.service.hover(file, range.start)).rejects.toThrow(
      'MHP_MODEL_TOOLS_UNAVAILABLE',
    )
    expect(requests).toEqual([])
    state.supportsTools = true
    expect(await owner.service.hover(file, range.start)).toEqual(['`a`'])
    state.isCurrent = false
    await expect(owner.service.hover(file, range.start)).rejects.toThrow('replaced')
    expect(requests).toHaveLength(1)
  })
  it('withdraws a late native answer and awaits its cancellation on release', async () => {
    const { owner, file, before, requests } = setup()
    const held = Promise.withResolvers<undefined>()
    before.mockReturnValue(held.promise)
    const reading = owner.service.hover(file, range.start)
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1)
    })
    let isReleased = false
    const closing = (async () => {
      await owner.dispose()
      isReleased = true
    })()
    expect(requests[0]?.signal?.aborted).toBe(true)
    expect(isReleased).toBe(false)
    held.resolve(undefined)
    await expect(reading).rejects.toThrow()
    await closing
    expect(isReleased).toBe(true)
    await expect(owner.service.open(file)).rejects.toThrow()
  })
})
