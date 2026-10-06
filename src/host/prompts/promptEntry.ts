import { PromptInsertion } from './promptInsertion'
import type { ChatSurface } from '../views/chatSurface'
import type { PromptDraft } from '../../core/prompts/promptTypes'
import { randomUUID } from 'node:crypto'
import { homedir, userInfo } from 'node:os'
import * as vscode from 'vscode'
import { PromptLibrary } from '../../core/prompts/promptLibrary'
import { PromptStore, readPromptFile } from '../../core/prompts/promptStore'
import { PromptImporter, PromptSharer } from '../../core/prompts/promptImport'
import { promptPrivacy } from '../../core/prompts/promptPrivacy'
import { agentDataFolder } from '../../runtime/dataFolder'
import {
  PROMPT_LIMITS,
  PROMPT_SYNC_KEY,
  PROMPT_SYNC_SETTING,
  SETTINGS_SECTION,
  UI_TEXT,
} from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { PromptCommands, type PromptUiPort } from './promptCommands'

export type PromptCommandName = 'save' | 'use' | 'library' | 'copyToUser' | 'sharePrompt'
export interface PromptHostDeps {
  readonly workspaceRoot: string | undefined
  readonly home?: string
  readonly user?: string
  readonly state: {
    get(key: string): unknown
    update(key: string, value: unknown): PromiseLike<void>
  }
  readonly chat: {
    active(): ChatSurface | undefined
    open(): Promise<void>
    isReady(surface: ChatSurface): boolean
    observe(events: { ready(surface: ChatSurface): void; closed(surface: ChatSurface): void }): void
  }
  readonly isConfidentialWorkspace: () => boolean | undefined
  readonly registeredSecrets: () => Promise<readonly string[]>
  /** M118-P-RAW-FETCH: exact bytes through the existing pinned transport/GitHub client. */
  readonly readRemote?: (url: string, maxBytes: number) => Promise<string>
}

const nativePreview: PromptUiPort['preview'] = async (title, text, accept) => {
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: text,
  })
  await vscode.window.showTextDocument(document, { preview: true })
  const result = await vscode.window.showInformationMessage(title, accept, UI_TEXT.goalEditCancel)
  if (result !== accept) return false
  if (document.getText() !== text) throw new Error(UI_TEXT.promptFileInvalid)
  return true
}

function nativeUi(hasWorkspace: boolean): PromptUiPort {
  return {
    pick: async (title, items) => {
      const selected = await vscode.window.showQuickPick([...items], {
        title,
        matchOnDetail: true,
        placeHolder: UI_TEXT.promptSearch,
      })
      return selected?.id
    },
    input: (title, value) =>
      Promise.resolve(vscode.window.showInputBox({ title, ...(value !== undefined && { value }) })),
    confirm: async (title) =>
      (await vscode.window.showWarningMessage(title, { modal: true }, UI_TEXT.promptDelete)) ===
      UI_TEXT.promptDelete,
    preview: nativePreview,
    edit: async (draft, isNew): Promise<PromptDraft | undefined> => {
      const title = await vscode.window.showInputBox({
        title: UI_TEXT.promptTitle,
        value: draft.title,
        validateInput: (value) =>
          value.trim() === '' || value.length > PROMPT_LIMITS.title
            ? UI_TEXT.promptLimits
            : undefined,
      })
      if (title === undefined) return undefined
      const tags = await vscode.window.showInputBox({
        title: UI_TEXT.promptTags,
        value: draft.tags.join(', '),
      })
      if (tags === undefined) return undefined
      let scope = draft.scope
      if (isNew && hasWorkspace) {
        const choice = await vscode.window.showQuickPick([
          { id: 'user' as const, label: UI_TEXT.promptScopeUser },
          { id: 'workspace' as const, label: UI_TEXT.promptScopeWorkspace },
        ])
        if (choice === undefined) return undefined
        scope = choice.id
      }
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: draft.body,
      })
      await vscode.window.showTextDocument(document, { preview: false })
      if (
        (await vscode.window.showInformationMessage(
          UI_TEXT.promptSecretsNote,
          UI_TEXT.promptSave,
          UI_TEXT.goalEditCancel,
        )) !== UI_TEXT.promptSave
      )
        return undefined
      return {
        title,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        scope,
        body: document.getText(),
      }
    },
  }
}

/** Cached per host window, never by workspace for user-scope files. */
const hosts = new WeakMap<PromptHostDeps, Promise<PromptCommands>>()
async function commandsFor(deps: PromptHostDeps): Promise<PromptCommands> {
  const home = deps.home ?? homedir()
  const store = new PromptStore(
    agentDataFolder({ platform: process.platform, env: process.env, homeDir: home }),
    deps.workspaceRoot,
  )
  const library = new PromptLibrary(
    store,
    { id: randomUUID, now: () => new Date().toISOString() },
    {
      isOn: () =>
        vscode.workspace.getConfiguration(SETTINGS_SECTION).get<boolean>(PROMPT_SYNC_SETTING) ===
        true,
      read: () => deps.state.get(PROMPT_SYNC_KEY) ?? [],
      write: (prompts) => Promise.resolve(deps.state.update(PROMPT_SYNC_KEY, [...prompts])),
    },
  )
  await library.synchronise()
  const ui = nativeUi(deps.workspaceRoot !== undefined)
  const insertion = new PromptInsertion(deps.chat)
  const active = deps.chat.active()
  if (active !== undefined && deps.chat.isReady(active)) insertion.surfaceReady(active)
  deps.chat.observe({
    ready: (surface) => {
      insertion.surfaceReady(surface)
    },
    closed: (surface) => {
      insertion.surfaceClosed(surface)
    },
  })
  let registered: readonly string[] = []
  const privacy = promptPrivacy({
    workspaceRoots: deps.workspaceRoot === undefined ? [] : [deps.workspaceRoot],
    home,
    user: deps.user ?? userInfo().username,
    registeredSecrets: () => registered,
  })
  const sharer = new PromptSharer({
    ...privacy,
    isConfidentialWorkspace: deps.isConfidentialWorkspace,
    release: async (destination, text, title) => {
      if (deps.isConfidentialWorkspace() !== false) throw new Error(UI_TEXT.shareConfidential)
      if (destination === 'copy') {
        await vscode.env.clipboard.writeText(text)
        return
      }
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${title.replaceAll(/[^\p{L}\p{N}_-]/gu, '-')}.muse-prompt.md`),
        filters: { Markdown: ['muse-prompt.md'] },
      })
      if (uri === undefined) return
      if (deps.isConfidentialWorkspace() !== false) throw new Error(UI_TEXT.shareConfidential)
      registered = await deps.registeredSecrets()
      if (privacy.redactRegisteredSecrets(text) !== text) throw new Error(UI_TEXT.promptFileInvalid)
      await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'))
    },
  })
  const importer = new PromptImporter({
    isConfidentialWorkspace: deps.isConfidentialWorkspace,
    read: async (source) => {
      if (source.kind !== 'file') {
        if (deps.readRemote === undefined) throw new Error(UI_TEXT.promptFileInvalid)
        return await deps.readRemote(source.location, PROMPT_LIMITS.fileBytes)
      }
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { Markdown: ['muse-prompt.md'] },
        openLabel: UI_TEXT.promptImport,
      })
      const uri = uris?.[0]
      if (uri?.scheme !== 'file') throw new Error(UI_TEXT.shareCancelled)
      return await readPromptFile(uri.fsPath)
    },
  })
  return new PromptCommands({
    library,
    importer,
    sharer,
    ui,
    hasWorkspace: () => deps.workspaceRoot !== undefined,
    editorSelection: () => {
      const editor = vscode.window.activeTextEditor
      return editor === undefined || editor.selection.isEmpty
        ? undefined
        : editor.document.getText(editor.selection)
    },
    canImportLinks: deps.readRemote !== undefined,
    afterShare: () => {
      registered = []
    },
    beforeShare: async () => {
      registered = await deps.registeredSecrets()
    },
    variables: {
      valueFor: async (variable) => {
        const editor = vscode.window.activeTextEditor
        let value: string | undefined
        switch (variable.source) {
          case 'selection': {
            value = editor?.document.getText(editor.selection)
            break
          }
          case 'file': {
            value = editor?.document.uri.fsPath
            break
          }
          case 'clipboard': {
            {
              value = await vscode.env.clipboard.readText()
              // No default
            }
            break
          }
        }
        return await ui.input(`${UI_TEXT.promptVariables}: ${variable.name}`, value)
      },
      review: (text, prompt) =>
        ui.preview(
          prompt.untrusted ? UI_TEXT.promptUntrusted : UI_TEXT.promptVariables,
          text,
          UI_TEXT.promptInsert,
        ),
      insert: (text) => insertion.insert(text),
    },
  })
}

function safePromptFailure(error: unknown): Error {
  const safeMessages = [
    UI_TEXT.promptFileInvalid,
    UI_TEXT.promptLimits,
    UI_TEXT.promptStoreDamaged,
    UI_TEXT.promptStoreBusy,
    UI_TEXT.promptWorkspaceRequired,
    UI_TEXT.shareConfidential,
    UI_TEXT.shareCancelled,
  ]
  // The boundary discards the original cause: it may contain private paths or prompt text.
  return new Error(
    error instanceof Error && safeMessages.includes(error.message)
      ? error.message
      : UI_TEXT.promptFileInvalid,
  )
}

/** The lazy factory installs the caller's language before every command. */
export async function runPromptCommand(
  command: PromptCommandName,
  input: unknown,
  deps: PromptHostDeps,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  let pending = hosts.get(deps)
  if (pending === undefined) {
    pending = commandsFor(deps)
    hosts.set(deps, pending)
  }
  let hasStarted = false
  try {
    const commands = await pending
    hasStarted = true
    switch (command) {
      case 'save': {
        await commands.save(
          input instanceof vscode.Uri &&
            vscode.window.activeTextEditor?.document.uri.toString() === input.toString()
            ? undefined
            : input,
        )
        break
      }
      case 'use': {
        await commands.use()
        break
      }
      case 'library': {
        await commands.library()
        break
      }
      case 'copyToUser': {
        await commands.copyToUser()
        break
      }
      case 'sharePrompt': {
        await commands.share(input)
        break
      }
    }
  } catch (error: unknown) {
    if (!hasStarted) hosts.delete(deps)
    throw safePromptFailure(error)
  }
}
