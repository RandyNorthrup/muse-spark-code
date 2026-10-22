// Activation keeps the feature detection and loader; the provider and parsing
// remain in editorChat.js until a model is exposed.
import * as vscode from 'vscode'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { createEditorChat, EditorChatDeps, EditorChatProvider } from './lmProvider'
import type { UiTable } from '../l10n'
import type { Logger } from '../logger'
import {
  EDITOR_CHAT_BUNDLE_FILE,
  EDITOR_CHAT_VENDOR,
  SETTINGS_SECTION,
  GLOBAL_STATE_KEYS,
  UI_TEXT,
} from '../../shared/constants'

interface Bundle {
  createEditorChat(deps: EditorChatDeps): ReturnType<typeof createEditorChat>
  setUiText(table: UiTable['table'], locale: string): void
}
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createEditorChat' in value &&
    typeof value.createEditorChat === 'function' &&
    'setUiText' in value &&
    typeof value.setUiText === 'function'
  )
}
interface NativeApi {
  registerLanguageModelChatProvider(vendor: string, provider: EditorChatProvider): unknown
}
function isApi(value: unknown): value is NativeApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'registerLanguageModelChatProvider' in value &&
    typeof value.registerLanguageModelChatProvider === 'function'
  )
}
function isDisposable(value: unknown): value is vscode.Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dispose' in value &&
    typeof value.dispose === 'function'
  )
}
function hasEditorChatApi(): boolean {
  return isApi(vscode.lm)
}
export function registerEditorChat(deps: {
  readonly extensionPath: string
  readonly table: UiTable
  readonly log: Logger
  readonly models: () => Promise<EditorChatDeps['models']>
  readonly recording: EditorChatDeps['recording']
  readonly allowed: () => boolean
  readonly loadBundle?: (file: string) => unknown
  readonly globalState: {
    get(key: string): unknown
    update(key: string, value: unknown): Thenable<void>
  }
}) {
  let isDisposed = false
  let registration: vscode.Disposable | undefined
  let engine: Promise<ReturnType<typeof createEditorChat>> | undefined
  let loaded: ReturnType<typeof createEditorChat> | undefined
  const config = () => vscode.workspace.getConfiguration(SETTINGS_SECTION)
  const selected = () => config().get<unknown>('editorChatModels', [])
  const stored = deps.globalState.get(GLOBAL_STATE_KEYS.editorChatConfirmations)
  const confirmations: Record<string, string> = {}
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored))
    for (const [ref, value] of Object.entries(stored))
      if (typeof value === 'string') confirmations[ref] = value
  let saving = Promise.resolve()
  const generations = new Map<string, number>()
  const saveConfirmation = async (ref: string, evidence: string | undefined) => {
    const generation = (generations.get(ref) ?? 0) + 1
    generations.set(ref, generation)
    if (evidence === undefined) Reflect.deleteProperty(confirmations, ref)
    const previous = saving
    const write = (async () => {
      try {
        await previous
      } catch {
        // The earlier caller owns its failure; this update still runs in order.
      }
      const next = { ...confirmations }
      if (evidence === undefined) Reflect.deleteProperty(next, ref)
      else next[ref] = evidence
      await deps.globalState.update(GLOBAL_STATE_KEYS.editorChatConfirmations, next)
      if (generations.get(ref) !== generation) return
      if (evidence === undefined) Reflect.deleteProperty(confirmations, ref)
      else confirmations[ref] = evidence
    })()
    saving = write
    await write
  }
  const withdraw = () => {
    const refs = selected()
    const refsToCheck = new Set([...Object.keys(confirmations), ...generations.keys()])
    for (const ref of refsToCheck)
      if (!Array.isArray(refs) || !refs.includes(ref))
        void saveConfirmation(ref, undefined).catch(() => {
          deps.log.warn('Editor chat confirmation could not be withdrawn')
        })
  }
  withdraw()
  const load = () => {
    if (engine !== undefined) return engine
    const pending = (async () => {
      const bundle: unknown = (deps.loadBundle ?? createRequire(__filename))(
        path.join(deps.extensionPath, 'dist', EDITOR_CHAT_BUNDLE_FILE),
      )
      if (!isBundle(bundle)) throw new Error(UI_TEXT.editorChatRefused)
      bundle.setUiText(deps.table.table, deps.table.locale)
      loaded = bundle.createEditorChat({
        models: await deps.models(),
        recording: deps.recording,
        selected,
        confirmations: () => confirmations,
        saveConfirmation,
        allowed: () => !isDisposed && deps.allowed() && vscode.workspace.isTrusted,
        now: Date.now,
        saveSelected: async (refs) => {
          await config().update('editorChatModels', refs, vscode.ConfigurationTarget.Global)
        },
      })
      if (isDisposed) loaded.cancelAll()
      return loaded
    })()
    engine = pending
    void pending.catch(() => {
      if (engine === pending) engine = undefined
    })
    return pending
  }
  const getProvider = async () => {
    const service = await load()
    return service.provider
  }
  const refresh = () => {
    loaded?.cancelAll()
    registration?.dispose()
    registration = undefined
    const refs = selected()
    const api: unknown = vscode.lm
    if (isDisposed || !Array.isArray(refs) || refs.length === 0 || !isApi(api)) return
    const provider: EditorChatProvider = {
      provideLanguageModelChatInformation: async (options, token) => {
        const provider = await getProvider()
        return await provider.provideLanguageModelChatInformation(options, token)
      },
      provideLanguageModelChatResponse: async (model, messages, options, progress, token) => {
        const provider = await getProvider()
        await provider.provideLanguageModelChatResponse(model, messages, options, progress, token)
      },
      provideTokenCount: async (model, input, token) => {
        const provider = await getProvider()
        return await provider.provideTokenCount(model, input, token)
      },
    }
    const result: unknown = api.registerLanguageModelChatProvider(EDITOR_CHAT_VENDOR, provider)
    if (!isDisposable(result)) throw new Error(UI_TEXT.editorChatRefused)
    registration = {
      dispose: () => {
        result.dispose()
      },
    }
  }
  refresh()
  const listener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(`${SETTINGS_SECTION}.editorChatModels`)) {
      return
    }

    withdraw()
    refresh()
  })
  return {
    available: hasEditorChatApi,
    selected: (ref: string) => {
      const refs = selected()
      return Array.isArray(refs) && refs.includes(ref)
    },
    toggle: async (ref: string) => {
      if (isDisposed || !hasEditorChatApi()) throw new Error(UI_TEXT.editorChatRefused)
      const service = await load()
      await service.toggle(ref)
    },
    dispose: () => {
      isDisposed = true
      loaded?.cancelAll()
      listener.dispose()
      registration?.dispose()
    },
  }
}
