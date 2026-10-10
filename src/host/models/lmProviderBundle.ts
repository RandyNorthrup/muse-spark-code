// Activation keeps the feature detection and loader; the provider, parsing and
// durable ledger remain in editorChat.js until a model is exposed.
import * as vscode from 'vscode'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { createEditorChat, EditorChatDeps, EditorChatProvider } from './lmProvider'
import type { TabLedgerDeps } from '../tab/tabLedger'
import type { UiTable } from '../l10n'
import {
  EDITOR_CHAT_BUNDLE_FILE,
  EDITOR_CHAT_VENDOR,
  SETTINGS_SECTION,
  UI_TEXT,
} from '../../shared/constants'

interface Bundle {
  createEditorChat(deps: EditorChatDeps): ReturnType<typeof createEditorChat>
  createTabLedger(deps: TabLedgerDeps): EditorChatDeps['ledger']
  setUiText(table: UiTable['table'], locale: string): void
}
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createEditorChat' in value &&
    typeof value.createEditorChat === 'function' &&
    'createTabLedger' in value &&
    typeof value.createTabLedger === 'function' &&
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
  readonly storagePath: string
  readonly windowId: string
  readonly table: UiTable
  readonly log: TabLedgerDeps['log']
  readonly models: () => Promise<EditorChatDeps['models']>
  readonly recording: EditorChatDeps['recording']
  readonly allowed: () => boolean
  readonly loadBundle?: (file: string) => unknown
}) {
  let isDisposed = false
  let registration: vscode.Disposable | undefined
  let engine: Promise<ReturnType<typeof createEditorChat>> | undefined
  let loaded: ReturnType<typeof createEditorChat> | undefined
  const config = () => vscode.workspace.getConfiguration(SETTINGS_SECTION)
  const selected = () => config().get<unknown>('editorChatModels', [])
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
        ledger: bundle.createTabLedger({
          directory: path.join(deps.storagePath, 'editor-chat-spend'),
          windowId: deps.windowId,
          now: Date.now,
          sleep: (ms) =>
            new Promise((resolve) => {
              setTimeout(resolve, ms)
            }),
          log: deps.log,
        }),
        recording: deps.recording,
        selected,
        cap: () => config().get<unknown>('editorChatDailyBudgetUsd', 0),
        allowed: () => !isDisposed && deps.allowed() && vscode.workspace.isTrusted,
        now: Date.now,
        saveSelected: async (refs) => {
          await config().update('editorChatModels', refs, vscode.ConfigurationTarget.Global)
        },
        saveCap: async (amount) => {
          await config().update(
            'editorChatDailyBudgetUsd',
            Number(amount),
            vscode.ConfigurationTarget.Global,
          )
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
    const budget = config().get<unknown>('editorChatDailyBudgetUsd', 0)
    const api: unknown = vscode.lm
    if (
      isDisposed ||
      typeof budget !== 'number' ||
      budget <= 0 ||
      !Number.isFinite(budget) ||
      !Array.isArray(refs) ||
      refs.length === 0 ||
      !isApi(api)
    )
      return
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
    if (
      event.affectsConfiguration(`${SETTINGS_SECTION}.editorChatModels`) ||
      event.affectsConfiguration(`${SETTINGS_SECTION}.editorChatDailyBudgetUsd`)
    )
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
