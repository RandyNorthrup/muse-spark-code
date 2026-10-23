import { fileURLToPath, pathToFileURL } from 'node:url'
import { isSamePath } from '../../core/paths'
import { isProtectedPath } from '../../core/protectedPaths'
import { confineWorkspacePath } from '../../core/workspacePath'
import { pathModule } from '../../core/workspaceRoot'
import type {
  CodeLocation,
  CodeSymbol,
  LanguageServiceHost,
} from '../../core/codeIntel/languageService'
import { MHP } from '../../shared/constants'
import type {
  HostServices,
  MhpParams,
  MhpRequestMethod,
  MhpResult,
} from '../../shared/hostApi/methods'
import { parseMhpResult } from '../../shared/hostApi/protocol'

export interface RuntimeCodeIntelDeps {
  readonly host: HostServices
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly realPath: (file: string) => Promise<string>
  readonly assertCurrent: () => void
  /** The selected catalog's tool capability and the negotiated native service, read live. */
  readonly canUseTools: () => boolean
  readonly libraryRoots: () => readonly string[]
}

/** Native language data feeds the existing core queries and guarded rename writer. */
export function createRuntimeCodeIntel(deps: RuntimeCodeIntelDeps) {
  const ending = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  const check = () => {
    ending.signal.throwIfAborted()
    deps.assertCurrent()
    if (!deps.canUseTools()) throw new Error('MHP_MODEL_TOOLS_UNAVAILABLE')
  }
  const filePath = (uri: string): string | undefined => {
    return uri.startsWith('file:')
      ? fileURLToPath(uri, { windows: deps.platform === 'win32' })
      : undefined
  }
  const location = (value: MhpResult<'codeIntel/definition'>[number]): CodeLocation => ({
    path: filePath(value.uri),
    range: value.range,
  })
  const symbol = (value: MhpResult<'codeIntel/documentSymbols'>[number]): CodeSymbol => ({
    name: value.name,
    kind: value.kind,
    container: value.container,
    detail: undefined,
    location: location(value.location),
    selection: value.selection,
    // The frozen host contract supplies a flat symbol inventory.
    children: [],
  })
  async function track<T>(work: () => Promise<T>): Promise<T> {
    check()
    const operation = work()
    pending.add(operation)
    try {
      const value = await operation
      check()
      return value
    } finally {
      pending.delete(operation)
    }
  }
  async function request<M extends MhpRequestMethod>(method: M, params: MhpParams<M>) {
    check()
    const result = await deps.host.request(method, params, ending.signal)
    check()
    return parseMhpResult(method, { jsonrpc: MHP.jsonRpcVersion, id: 1, result }).result
  }
  async function uriFor(file: string): Promise<string> {
    check()
    const paths = pathModule(deps.platform)
    const confined = await confineWorkspacePath(
      deps.workspaceRoot,
      paths.relative(deps.workspaceRoot, file),
      deps.platform,
      { realPath: deps.realPath },
    )
    check()
    if (
      !confined.ok ||
      !isSamePath(confined.checkedAbsolute, file, deps.platform) ||
      isProtectedPath(confined.canonical)
    )
      throw new Error('MHP_CODE_INTEL_PATH_REFUSED')
    return pathToFileURL(confined.checkedAbsolute, { windows: deps.platform === 'win32' }).href
  }
  async function document(uri: string) {
    const result = await request('documents/read', { uri })
    const expected = filePath(uri)
    const received = filePath(result.document.uri)
    if (
      expected === undefined ||
      received === undefined ||
      !isSamePath(expected, received, deps.platform)
    )
      throw new Error('MHP_CODE_INTEL_DOCUMENT_MISMATCH')
    return result
  }
  const service: LanguageServiceHost = {
    open: (file) =>
      track(async () => {
        const result = await document(await uriFor(file))
        return {
          languageId: result.document.languageId,
          text: result.text,
          isDirty: result.document.dirty,
        }
      }),
    definitions: (file, position) =>
      track(async () => {
        const answer = await request('codeIntel/definition', { uri: await uriFor(file), position })
        return answer.map((value) => location(value))
      }),
    references: (file, position) =>
      track(async () => {
        const answer = await request('codeIntel/references', {
          uri: await uriFor(file),
          position,
          includeDeclaration: true,
        })
        return answer.map((value) => location(value))
      }),
    hover: (file, position) =>
      track(async () => await request('codeIntel/hover', { uri: await uriFor(file), position })),
    documentSymbols: (file) =>
      track(async () => {
        const answer = await request('codeIntel/documentSymbols', { uri: await uriFor(file) })
        return answer.map((value) => symbol(value))
      }),
    workspaceSymbols: (query) =>
      track(async () => {
        const answer = await request('codeIntel/workspaceSymbols', { query })
        return answer.map((value) => symbol(value))
      }),
    callHierarchy: (file, position, direction) =>
      track(async () => {
        const answer = await request('codeIntel/callHierarchy', {
          uri: await uriFor(file),
          position,
          direction,
        })
        return answer === null
          ? undefined
          : {
              item: symbol(answer.item),
              calls: answer.calls.map((call) => ({
                symbol: symbol(call.symbol),
                ranges: call.ranges,
              })),
              otherItems: answer.otherItems,
            }
      }),
    rename: (file, position, newName) =>
      track(async () => {
        const answer = await request('codeIntel/rename', {
          uri: await uriFor(file),
          position,
          newName,
        })
        const files = []
        for (const edit of answer.files) {
          const target = filePath(edit.uri)
          if (target === undefined) throw new Error('MHP_CODE_INTEL_PATH_REFUSED')
          const opened = await document(await uriFor(target))
          if (opened.document.version !== edit.expectedVersion || opened.document.dirty)
            throw new Error('MHP_CODE_INTEL_STALE_RENAME')
          files.push({ path: target, edits: edit.edits })
        }
        return { files, fileOperations: answer.fileOperations }
      }),
    libraryRoots: () => {
      check()
      return deps.libraryRoots()
    },
  }
  return {
    service,
    dispose: (): Promise<void> => {
      ending.abort()
      closing ??= (async () => {
        await Promise.allSettled(pending)
      })()
      return closing
    },
  }
}
