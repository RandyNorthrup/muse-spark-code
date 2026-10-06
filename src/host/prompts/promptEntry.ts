import type { WebFetchBundle } from '../web/webFetchBundle'
import { pageConverter } from '../web/pageConverter'
import type { Logger } from '../logger'
import { uiLocale } from '../../shared/l10n/text'
import { PromptInsertion } from './promptInsertion'
import { createChatSharing } from './chatSharing'
import { createChatSharePrivacy } from '../../core/sharing/privacy'
import type { ChatShareSource } from '../../core/sharing/chatShare'
import type { ConversationController } from '../conversation/conversationController'
import type { ConversationMessage } from '../views/chatSurface'
import path from 'node:path'
import type { SurfaceRegistry } from '../views/surfaceRegistry'
import type { CredentialStore } from '../auth/credentialStore'
import * as z from 'zod/mini'
import type { ChatSurface } from '../views/chatSurface'
import type { PromptDraft } from '../../core/prompts/promptTypes'
import { randomUUID } from 'node:crypto'
import { writeFileAtomically } from '../fsAtomic'
import { confineWorkspacePath } from '../../core/workspacePath'
import { canonicalPath } from '../canonicalPath'
import { homedir, userInfo } from 'node:os'
import * as vscode from 'vscode'
import { PromptLibrary } from '../../core/prompts/promptLibrary'
import { PromptStore, readPromptFile } from '../../core/prompts/promptStore'
import { PromptImporter, PromptSharer } from '../../core/prompts/promptImport'
import { promptPrivacy } from '../../core/prompts/promptPrivacy'
import { agentDataFolder } from '../../runtime/dataFolder'
import {
  GLOBAL_STATE_KEYS,
  PROMPT_LIMITS,
  PROMPT_COMMAND_IDS,
  PAGE_WORKER_FILE,
  PROMPT_FILE_MODE,
  PROMPT_SYNC_KEY,
  PROMPT_SYNC_SETTING,
  SETTINGS_SECTION,
  UI_TEXT,
} from '../../shared/constants'
import { fill, setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { PromptCommands, type PromptUiPort } from './promptCommands'

export type PromptCommandName =
  'save' | 'use' | 'library' | 'copyToUser' | 'sharePrompt' | 'synchronise'
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
    open(): Promise<string>
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

function nativeUi(
  hasWorkspace: boolean,
  isConfidentialWorkspace: () => boolean | undefined,
): PromptUiPort {
  const chooseScope: PromptUiPort['chooseScope'] = async () => {
    if (!hasWorkspace) return 'user'
    const user = { id: 'user' as const, label: UI_TEXT.promptScopeUser }
    const workspace = { id: 'workspace' as const, label: UI_TEXT.promptScopeWorkspace }
    const choice = await vscode.window.showQuickPick(
      isConfidentialWorkspace() === false ? [user, workspace] : [workspace, user],
      { title: UI_TEXT.promptScopeWorkspace },
    )
    return choice?.id
  }
  return {
    chooseScope,
    report: async (message) => {
      await vscode.window.showWarningMessage(message)
    },
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
        const choice = await chooseScope()
        if (choice === undefined) return undefined
        scope = choice
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
        vscode.workspace.getConfiguration(SETTINGS_SECTION).inspect<boolean>(PROMPT_SYNC_SETTING)
          ?.globalValue === true,
      read: () => deps.state.get(PROMPT_SYNC_KEY) ?? [],
      write: (prompts) => Promise.resolve(deps.state.update(PROMPT_SYNC_KEY, [...prompts])),
    },
  )
  const ui = nativeUi(deps.workspaceRoot !== undefined, deps.isConfidentialWorkspace)
  try {
    await library.synchronise()
  } catch (error: unknown) {
    if (!(error instanceof Error && error.message === UI_TEXT.promptStoreDamaged)) throw error
    await ui.report(fill(UI_TEXT.promptScopeDamaged, { scope: UI_TEXT.promptScopeUser }))
  }
  const insertion = new PromptInsertion(deps.chat)
  const active = deps.chat.active()
  if (active !== undefined && deps.chat.isReady(active)) insertion.surfaceReady(active)
  deps.chat.observe({
    ready: (surface) => {
      insertion.surfaceReady(surface)
      if (pendingLibraries.delete(surface))
        surface.post({ type: 'openSharing', surface: 'prompts' })
    },
    closed: (surface) => {
      insertion.surfaceClosed(surface)
      pendingLibraries.delete(surface)
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
    release: async (destination, text, title, admitRelease) => {
      const originatingSurface = deps.chat.active()
      const isCurrentSurface = () => originatingSurface === deps.chat.active()
      admitRelease()
      if (deps.isConfidentialWorkspace() !== false) throw new Error(UI_TEXT.shareConfidential)
      if (destination === 'copy') {
        await vscode.env.clipboard.writeText(text)
        return
      }
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(
            deps.workspaceRoot ?? home,
            `${title.replaceAll(/[^\p{L}\p{N}_-]/gu, '-')}.muse-prompt.md`,
          ),
        ),
        filters: { Markdown: ['muse-prompt.md'] },
      })
      admitRelease()
      if (uri === undefined) return
      if (deps.isConfidentialWorkspace() !== false) throw new Error(UI_TEXT.shareConfidential)
      registered = await deps.registeredSecrets()
      if (privacy.redactRegisteredSecrets(text) !== text) throw new Error(UI_TEXT.promptFileInvalid)
      const checked = await confineWorkspacePath(
        deps.workspaceRoot ?? home,
        uri.fsPath,
        process.platform,
        { realPath: (file) => canonicalPath(file, { followsBrokenLinks: true }) },
      )
      if (!checked.ok) throw new Error(UI_TEXT.shareCancelled)
      const admit = () => {
        admitRelease()
        if (!isCurrentSurface()) throw new Error(UI_TEXT.sharePreviewExpired)
        if (deps.isConfidentialWorkspace() !== false) throw new Error(UI_TEXT.shareConfidential)
        if (privacy.redactRegisteredSecrets(text) !== text)
          throw new Error(UI_TEXT.promptFileInvalid)
      }
      admit()
      await writeFileAtomically(checked.checkedAbsolute, text, {
        mode: PROMPT_FILE_MODE,
        expectedCanonicalPath: checked.checkedAbsolute,
        beforeCommit: admit,
        assertCanWrite: admit,
        sleep: (ms) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms)
          }),
      })
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
    UI_TEXT.shareRangeInvalid,
    UI_TEXT.shareTooLarge,
    UI_TEXT.shareAttachmentUnavailable,
    UI_TEXT.sharePreviewExpired,
    UI_TEXT.exportNothing,
    UI_TEXT.exportHistoryUnavailable,
    UI_TEXT.exportWaitForTurn,
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
      case 'synchronise': {
        await commands.synchronise()
        break
      }
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

/** Raw host ports keep credential, policy and chat adapters out of activation. */
export interface PromptActivationPorts {
  readonly context: Pick<
    vscode.ExtensionContext,
    'subscriptions' | 'extensionUri' | 'globalStorageUri' | 'globalState' | 'workspaceState'
  >
  readonly workspaceRoot: string | undefined
  readonly credentials: Pick<CredentialStore, 'getApiKey'>
  readonly settings: () => { confidentialWorkspace: boolean }
  readonly registry: SurfaceRegistry
  readonly openConversation: () => Promise<void>
  readonly ready: WeakSet<ChatSurface>
  readonly controllers: ReadonlyMap<string, ConversationController>
  readonly webFetch: () => WebFetchBundle
  readonly log: Logger
}
const nativeHosts = new WeakMap<PromptActivationPorts, PromptHostDeps>()
const promptEvents = new WeakMap<
  PromptActivationPorts,
  Parameters<PromptHostDeps['chat']['observe']>[0]
>()
function nativeDeps(ports: PromptActivationPorts): PromptHostDeps {
  let deps = nativeHosts.get(ports)
  if (deps !== undefined) return deps
  const convertHtml = pageConverter(
    vscode.Uri.joinPath(ports.context.extensionUri, 'dist', PAGE_WORKER_FILE).fsPath,
    ports.log,
  )
  deps = {
    workspaceRoot: ports.workspaceRoot,
    state: ports.context.globalState,
    isConfidentialWorkspace: () => ports.settings().confidentialWorkspace,
    registeredSecrets: async () => {
      const key = await ports.credentials.getApiKey()
      return key === undefined ? [] : [key]
    },
    readRemote: (url, maxBytes) =>
      ports
        .webFetch()
        .readRawPromptWith(url, maxBytes, () => !ports.settings().confidentialWorkspace, {
          log: ports.log,
          convertHtml,
          table: UI_TEXT,
          locale: uiLocale(),
        }),
    chat: {
      active: () => ports.registry.active,
      open: async () => {
        await ports.openConversation()
        const surface = ports.registry.active
        if (surface === undefined) throw new Error(UI_TEXT.promptFileInvalid)
        return surface.id
      },
      isReady: (surface) => ports.ready.has(surface),
      observe: (events) => {
        promptEvents.set(ports, events)
      },
    },
  }
  nativeHosts.set(ports, deps)
  return deps
}

function registerPromptSync(state: vscode.ExtensionContext['globalState']): void {
  const isOn =
    vscode.workspace.getConfiguration(SETTINGS_SECTION).inspect<boolean>(PROMPT_SYNC_SETTING)
      ?.globalValue === true
  state.setKeysForSync([
    GLOBAL_STATE_KEYS.whatsNewLastSeenVersion,
    ...(isOn ? [PROMPT_SYNC_KEY] : []),
  ])
}

export async function runHostPromptCommand(
  command: PromptCommandName,
  input: unknown,
  ports: PromptActivationPorts,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  registerPromptSync(ports.context.globalState)
  if (command === 'library') {
    const deps = nativeDeps(ports)
    let pending = hosts.get(deps)
    if (pending === undefined) {
      pending = commandsFor(deps)
      hosts.set(deps, pending)
    }
    await pending
    if (ports.registry.active === undefined) await ports.openConversation()
    const surface = ports.registry.active
    if (surface !== undefined) {
      if (ports.ready.has(surface)) surface.post({ type: 'openSharing', surface: 'prompts' })
      else pendingLibraries.add(surface)
    }
    return
  }
  await runPromptCommand(command, input, nativeDeps(ports), table, locale)
}

const chatServices = new WeakMap<ChatSurface, ReturnType<typeof createChatSharing>>()
const pendingLibraries = new WeakSet<ChatSurface>()
/** Both envelopes are parsed before use; action payload schemas live only in this lazy bundle. */
export async function handleSharingAction(
  surface: ChatSurface,
  action: string,
  input: unknown,
  ports: PromptActivationPorts,
  table: UiText,
  locale: string,
): Promise<unknown> {
  setUiText(table, locale)
  const deps = nativeDeps(ports)
  try {
    if (action === 'remember' || action === 'invalidate' || action.startsWith('chat')) {
      let sharing = chatServices.get(surface)
      if (sharing === undefined) {
        let registered: readonly string[] = []
        sharing = createChatSharing({
          workspaceRoot: ports.workspaceRoot,
          storageRoot: path.join(ports.context.globalStorageUri.fsPath, 'shares'),
          state: ports.context.workspaceState,
          currentSessionId: () => ports.controllers.get(surface.id)?.shareSessionId(),
          read: (sessionId, exportedAt) => readSurface(ports, surface, sessionId, exportedAt),
          isConfidentialWorkspace: deps.isConfidentialWorkspace,
          refreshSecrets: async () => {
            registered = await deps.registeredSecrets()
          },
          privacy: createChatSharePrivacy({
            workspaceRoots: ports.workspaceRoot === undefined ? [] : [ports.workspaceRoot],
            home: homedir(),
            userName: userInfo().username,
            redactRegisteredSecrets: (text) => {
              let result = text
              for (const value of registered)
                if (value !== '') result = result.replaceAll(value, '[redacted]')
              return result
            },
          }),
        })
        chatServices.set(surface, sharing)
      }
      const result = await sharing.handle(action, input)
      if (action !== 'invalidate') return result
    }
    let pending = hosts.get(deps)
    if (pending === undefined) {
      pending = commandsFor(deps)
      hosts.set(deps, pending)
    }
    const commands = await pending
    switch (action) {
      case 'saveText': {
        const { text } = z.strictObject({ text: z.string() }).parse(input)
        await commands.save({ 'museSpark.promptSource': 'composer', 'museSpark.promptText': text })
        return undefined
      }
      case 'saveHistory': {
        const { sessionId } = z.strictObject({ sessionId: z.string() }).parse(input)
        const source = await readSurface(ports, surface, sessionId, new Date().toISOString())
        const messages = source.items.filter(
          (item) => item.kind === 'userMessage' && item.text !== undefined,
        )
        const chosen = await vscode.window.showQuickPick(
          messages.map((item) => ({ id: item.itemId, label: item.text ?? '' })),
          { title: UI_TEXT.promptSave },
        )
        const item = messages.find((message) => message.itemId === chosen?.id)
        if (item !== undefined)
          await commands.save({
            'museSpark.promptSource': 'userMessage',
            'museSpark.promptText': item.text,
            'museSpark.transcriptRole': 'user',
            'museSpark.messageIsOwn': true,
          })
        return undefined
      }
      case 'shareText': {
        const { text } = z.strictObject({ text: z.string() }).parse(input)
        await commands.share({ 'museSpark.promptSource': 'composer', 'museSpark.promptText': text })
        return undefined
      }
      case 'use': {
        await commands.use()
        return undefined
      }
      case 'shareSaved': {
        await commands.share()
        return undefined
      }
      default: {
        return await commands.panel(action, input)
      }
    }
  } catch (error: unknown) {
    throw safePromptFailure(error)
  }
}

export function closeSharingSurface(surface: ChatSurface): void {
  pendingLibraries.delete(surface)
  chatServices.get(surface)?.invalidate()
  chatServices.delete(surface)
}

function readSurface(
  ports: PromptActivationPorts,
  surface: ChatSurface,
  sessionId: string | undefined,
  exportedAt: string,
): Promise<ChatShareSource> {
  const controller = ports.controllers.get(surface.id)
  if (controller === undefined) throw new Error(UI_TEXT.exportHistoryUnavailable)
  return controller.readShareSource(sessionId, exportedAt)
}

/** Factory exports one callable boundary; policy and credentials are adapted only after first use. */
export function createPromptHost(ports: PromptActivationPorts, table: UiText, locale: string) {
  setUiText(table, locale)
  return {
    run: async (command: string, input?: unknown) => {
      if (command === 'synchronise') {
        try {
          await runHostPromptCommand(command, input, ports, table, locale)
          return
        } catch (error_: unknown) {
          ports.log.warn(safePromptFailure(error_).message)
          return
        }
      }
      if (command === PROMPT_COMMAND_IDS.shareChat) {
        const surface = ports.registry.active
        if (surface === undefined) throw new Error(UI_TEXT.exportNothing)
        surface.post({ type: 'openSharing', surface: 'chat' })
        return
      }
      for (const name of ['save', 'use', 'library', 'copyToUser', 'sharePrompt'] as const) {
        if (PROMPT_COMMAND_IDS[name] !== command) continue
        await runHostPromptCommand(name, input, ports, table, locale)
        return
      }
      throw new Error(UI_TEXT.promptFileInvalid)
    },
    ready: (surface: ChatSurface) => {
      promptEvents.get(ports)?.ready(surface)
    },
    close: (surface: ChatSurface) => {
      promptEvents.get(ports)?.closed(surface)
      closeSharingSurface(surface)
      const pending = hosts.get(nativeDeps(ports))
      if (pending !== undefined)
        void pending
          .then((commands) => commands.panel('invalidate', {}))
          .catch((error_: unknown) => {
            ports.log.warn(safePromptFailure(error_).message)
          })
    },
    handle: async (
      surface: ChatSurface,
      message: Extract<ConversationMessage, { type: 'sharingAction' }>,
    ) => {
      if (!ports.registry.has(surface)) return
      try {
        const value = await handleSharingAction(
          surface,
          message.action,
          message.payload,
          ports,
          table,
          locale,
        )
        if (ports.registry.has(surface))
          surface.post({ type: 'sharingResult', id: message.id, value })
      } catch (error: unknown) {
        if (ports.registry.has(surface))
          surface.post({
            type: 'sharingResult',
            id: message.id,
            value: undefined,
            error: safePromptFailure(error).message,
          })
      }
    },
  }
}
