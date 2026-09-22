// One conversation per surface: owns the MSP session for that surface, turns
// webview requests into backend calls, and streams AgentEvents back. Also the
// source of truth for the composer settings that outlive a webview reload
// (permission mode, effort, thinking) and for the images waiting to be sent.

import path from 'node:path'
import { Buffer } from 'node:buffer'
import { AttachmentStore } from '../../core/attachments'
import type { MuseCodeHost, MuseSession, TurnPart } from '../../core/backends/musecode/MuseCodeHost'
import {
  ALLOWED_LINK_SCHEMES,
  DEFAULT_EFFORT,
  type EffortLevel,
  IMAGE_EXTENSIONS,
  MENTION_RESULT_LIMIT,
  OUTPUT_PAGE_BYTES,
  type PermissionMode,
  SANDBOX_FAILURE_MARKER,
  UI_TEXT,
} from '../../shared/constants'
import { effortForThinking, effortLevelsFor, isEffortLevel } from '../../shared/effort'
import type { AgentEvent } from '../../shared/agentEvents'
import { parseSkillInvocation } from '../../shared/mentions'
import { approvalModeFor } from '../../shared/permissionModes'
import type {
  HostAction,
  HostToWebviewMessage,
  MentionItem,
  ModelOption,
  SkillOption,
} from '../../shared/protocol'
import type { AuthService } from '../auth/authService'
import type { Logger } from '../logger'
import type { ChatSurface, ConversationMessage } from '../views/webviewSetup'

export interface PickedFile {
  readonly name: string
  readonly fsPath: string
  /** Workspace-relative with forward slashes; undefined outside the workspace. */
  readonly relativePath: string | undefined
}

export interface FileAccess {
  /** Native open dialog; resolves to [] when cancelled. */
  showOpenDialog(): Promise<readonly PickedFile[]>
  readFile(fsPath: string): Promise<Uint8Array>
  /** QuickPick over the mention index; resolves to the chosen relative path. */
  pickMentionFile(): Promise<string | undefined>
  /** Relative path for a dropped `file:` URI; undefined outside the workspace. */
  toRelativePath(uri: string): string | undefined
}

export interface MentionSearch {
  search(query: string, limit: number): Promise<readonly MentionItem[]>
}

export interface ConversationDeps {
  readonly surface: ChatSurface
  readonly auth: AuthService
  readonly ensureHost: () => Promise<MuseCodeHost>
  readonly workspaceRoot: string | undefined
  readonly modelId: string
  readonly initialPermissionMode: PermissionMode
  /** False until the approval cards ship (M4); see shared/permissionModes.ts. */
  readonly hasApprovalUi: boolean
  readonly openExternal: (url: string) => void
  readonly mentions: MentionSearch
  readonly files: FileAccess
  /** The `allowDangerouslySkipPermissions` setting: whether Bypass is offered. */
  readonly isBypassAllowed: () => boolean
  readonly runHostAction: (action: HostAction) => Promise<void>
  /** Code block "Copy": the system clipboard. */
  readonly copyText: (text: string) => Promise<void>
  /** Code block "Insert at cursor"; false when no text editor is active. */
  readonly insertCode: (text: string) => Promise<boolean>
  readonly newAttachmentId: () => string
  readonly log: Logger
}

export const NO_WORKSPACE_REASON = 'Open a folder first; Muse works inside a workspace.'
export const NOT_SIGNED_IN_REASON = 'Sign in before sending a message.'
export const NOTHING_TO_SEND_REASON = 'Type a message or attach an image first.'
export const AUTH_REQUIRED_ERROR_KIND = 'authRequired'
const IDLE_STATUS = 'idle'
const NOOP_STATUS = 'noop'
// `session/compact` rejects with this reason before the first turn has run
// (verified live 2026-09-21); it is "nothing to do", not a failure.
const MISSING_RUN_REASON = 'missing_run'
const NOTHING_TO_COMPACT = 'Nothing to compact yet.'
const BYPASS_MODE: PermissionMode = 'bypassPermissions'
const FALLBACK_MODE: PermissionMode = 'manual'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ConversationController {
  private session: MuseSession | undefined
  private unsubscribe: (() => void) | undefined
  private models: readonly ModelOption[] | undefined
  private skills: readonly SkillOption[] | undefined
  private skillsRefresh: Promise<void> | undefined
  private readonly attachments: AttachmentStore
  private modelId: string
  private permissionMode: PermissionMode
  private effort: EffortLevel = DEFAULT_EFFORT
  private isThinkingEnabled = true
  private activeTurnId: string | undefined
  private hasWarnedSandbox = false

  public constructor(private readonly deps: ConversationDeps) {
    this.modelId = deps.modelId
    this.permissionMode = deps.initialPermissionMode
    if (this.permissionMode === BYPASS_MODE && !deps.isBypassAllowed()) {
      // The initial-mode setting alone cannot switch approvals off; the
      // explicit allow setting must be on too, as in Claude Code.
      deps.log.warn(
        'museSpark.initialPermissionMode is bypassPermissions but allowDangerouslySkipPermissions is off; starting in Manual',
      )
      this.permissionMode = FALLBACK_MODE
    }
    this.attachments = new AttachmentStore(deps.newAttachmentId)
  }

  private post(message: HostToWebviewMessage): void {
    this.deps.surface.post(message)
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.post({ type: 'notice', level, text })
  }

  private contextLimitFor(modelId: string): number | undefined {
    return this.models?.find((model) => model.modelId === modelId)?.contextLimit
  }

  private postSessionInfo(modelId: string): void {
    const contextLimit = this.contextLimitFor(modelId)
    this.post({
      type: 'sessionInfo',
      modelId,
      ...(contextLimit !== undefined && { contextLimit }),
    })
  }

  private postComposerState(): void {
    this.post({
      type: 'composerState',
      effort: this.effort,
      isThinkingEnabled: this.isThinkingEnabled,
      permissionMode: this.permissionMode,
    })
  }

  private postSkills(): void {
    if (this.skills !== undefined) {
      this.post({ type: 'skillList', skills: [...this.skills] })
    }
  }

  private dropSession(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.session?.dispose()
    this.session = undefined
    this.activeTurnId = undefined
  }

  private onEvent(event: AgentEvent): void {
    this.post({ type: 'agentEvent', event })
    switch (event.type) {
      case 'turnStarted': {
        this.activeTurnId = event.turnId
        break
      }
      case 'turnCompleted': {
        this.activeTurnId = undefined
        if (event.terminal === 'failed' && event.errorKind === AUTH_REQUIRED_ERROR_KIND) {
          this.deps.auth.markAuthRequired(event.reason ?? AUTH_REQUIRED_ERROR_KIND)
        }
        break
      }
      case 'sessionStatus': {
        if (event.status === IDLE_STATUS) {
          this.activeTurnId = undefined
        }
        break
      }
      case 'effortChanged': {
        if (isEffortLevel(event.effort) && event.effort !== this.effort) {
          this.effort = event.effort
          this.postComposerState()
        }
        break
      }
      case 'skillsChanged': {
        if (this.session !== undefined) {
          void this.refreshSkills(this.session)
        }
        break
      }
      case 'itemUpdated':
      case 'itemCompleted': {
        this.noteSandboxFailure(event.item.failureReason)
        break
      }
      default: {
        break
      }
    }
  }

  /** The shell tool's "sandbox not set up" failure gets one actionable notice. */
  private noteSandboxFailure(failureReason: string | undefined): void {
    if (this.hasWarnedSandbox || failureReason?.includes(SANDBOX_FAILURE_MARKER) !== true) {
      return
    }
    this.hasWarnedSandbox = true
    this.notice('warning', UI_TEXT.sandboxNotice)
  }

  private openLink(url: string): void {
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      this.notice('warning', UI_TEXT.linkSchemeRefused)
      return
    }
    if (!ALLOWED_LINK_SCHEMES.has(scheme)) {
      this.notice('warning', UI_TEXT.linkSchemeRefused)
      return
    }
    this.deps.openExternal(url)
  }

  private async decideApproval(
    message: Extract<ConversationMessage, { type: 'decideApproval' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.decideApproval({
        approvalId: message.approvalId,
        choiceId: message.choiceId,
        requirementId: message.requirementId,
        ...(message.feedback !== undefined && { feedback: message.feedback }),
      })
    } catch (error: unknown) {
      this.notice('error', `The decision was not accepted: ${describe(error)}`)
    }
  }

  private async answerQuestion(
    message: Extract<ConversationMessage, { type: 'answerQuestion' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.answerQuestions(message.userInputId, message.answers)
    } catch (error: unknown) {
      this.notice('error', `The answer was not accepted: ${describe(error)}`)
    }
  }

  private async readOutput(
    message: Extract<ConversationMessage, { type: 'readOutput' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      const page = await this.session.readOutput({
        itemId: message.itemId,
        outputRef: message.outputRef,
        offsetBytes: message.offsetBytes,
        lengthBytes: OUTPUT_PAGE_BYTES,
      })
      this.post({
        type: 'outputPage',
        itemId: message.itemId,
        outputRef: message.outputRef,
        offsetBytes: page.offsetBytes,
        byteLen: page.byteLen,
        content: page.content,
        eof: page.eof,
      })
    } catch (error: unknown) {
      this.notice('error', `Could not load the output: ${describe(error)}`)
    }
  }

  private async insertCode(text: string): Promise<void> {
    if (!(await this.deps.insertCode(text))) {
      this.notice('info', UI_TEXT.noEditorForInsert)
    }
  }

  private async ensureModels(host: MuseCodeHost): Promise<void> {
    if (this.models !== undefined) {
      return
    }
    const models = await host.listModels()
    this.models = models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      ...(model.contextLimit !== undefined && { contextLimit: model.contextLimit }),
      isDefault: model.isDefault,
    }))
    this.post({ type: 'modelList', models: [...this.models] })
  }

  private async applyEffort(session: MuseSession): Promise<void> {
    try {
      await session.setReasoningEffort(effortForThinking(this.effort, this.isThinkingEnabled))
    } catch (error: unknown) {
      this.deps.log.warn(`session/setReasoningEffort failed: ${describe(error)}`)
      this.notice('warning', `Reasoning effort could not be applied: ${describe(error)}`)
    }
  }

  private async loadSkills(session: MuseSession): Promise<void> {
    try {
      const skills = await session.listSkills()
      this.skills = skills.map((skill) => ({
        selector: skill.selector,
        displayName: skill.displayName,
        description: skill.description,
        ...(skill.argumentHint !== undefined && { argumentHint: skill.argumentHint }),
      }))
    } catch (error: unknown) {
      this.deps.log.warn(`skill/list failed: ${describe(error)}`)
      this.skills = []
    } finally {
      this.skillsRefresh = undefined
    }
    this.postSkills()
  }

  /** Re-list the skills; concurrent callers share the in-flight request. */
  private refreshSkills(session: MuseSession): Promise<void> {
    this.skillsRefresh ??= this.loadSkills(session)
    return this.skillsRefresh
  }

  private async ensureSession(workspaceRoot: string): Promise<MuseSession> {
    if (this.session !== undefined) {
      return this.session
    }
    const host = await this.deps.ensureHost()
    await this.ensureModels(host)
    const session = await host.startSession({
      workspaceRoot,
      modelId: this.modelId,
      approvalMode: approvalModeFor(this.permissionMode, this.deps.hasApprovalUi),
    })
    this.session = session
    this.unsubscribe = session.onEvent((event) => {
      this.onEvent(event)
    })
    this.postSessionInfo(session.modelId)
    await this.applyEffort(session)
    void this.refreshSkills(session)
    return session
  }

  /** The session for a user action, or undefined (with the reason posted). */
  private async sessionForAction(localId?: string): Promise<MuseSession | undefined> {
    const isSignedIn = this.deps.auth.current.status === 'signedIn'
    const reason = isSignedIn ? undefined : NOT_SIGNED_IN_REASON
    if (reason !== undefined || this.deps.workspaceRoot === undefined) {
      if (localId === undefined) {
        this.notice('warning', reason ?? NO_WORKSPACE_REASON)
      } else {
        this.post({ type: 'sendFailed', localId, reason: reason ?? NO_WORKSPACE_REASON })
      }
      return undefined
    }
    return await this.ensureSession(this.deps.workspaceRoot)
  }

  private buildParts(text: string, attachmentIds: readonly string[]): readonly TurnPart[] {
    const images = this.attachments.take(attachmentIds)
    const trimmed = text.trim()
    const skill = parseSkillInvocation(
      trimmed,
      new Set((this.skills ?? []).map((entry) => entry.selector)),
    )
    if (skill !== undefined) {
      return [
        {
          type: 'skill',
          selector: skill.selector,
          ...(skill.arguments !== undefined && { arguments: skill.arguments }),
        },
        ...images,
      ]
    }
    return trimmed === '' ? images : [{ type: 'text', text }, ...images]
  }

  private async submit(session: MuseSession, parts: readonly TurnPart[]): Promise<string> {
    if (this.activeTurnId !== undefined) {
      try {
        return await session.steer(this.activeTurnId, parts)
      } catch (error: unknown) {
        this.deps.log.warn(`turn/steer failed (${describe(error)}); submitting as a new turn`)
      }
    }
    const submission = await session.sendTurn(parts)
    return submission.turnId
  }

  private async send(
    localId: string,
    text: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    try {
      const session = await this.sessionForAction(localId)
      if (session === undefined) {
        return
      }
      const parts = this.buildParts(text, attachmentIds)
      if (parts.length === 0) {
        this.post({ type: 'sendFailed', localId, reason: NOTHING_TO_SEND_REASON })
        return
      }
      const turnId = await this.submit(session, parts)
      this.activeTurnId = turnId
      this.post({ type: 'turnAccepted', localId, turnId })
    } catch (error: unknown) {
      const reason = describe(error)
      this.deps.log.error(`sendMessage failed: ${reason}`)
      this.post({ type: 'sendFailed', localId, reason })
    }
  }

  private async cancel(): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`turn/cancel failed: ${describe(error)}`)
    }
  }

  private async setModel(modelId: string): Promise<void> {
    const previous = this.modelId
    this.modelId = modelId
    if (this.session !== undefined) {
      try {
        await this.session.setModel(modelId)
      } catch (error: unknown) {
        this.modelId = previous
        this.notice('error', `Could not switch model: ${describe(error)}`)
        return
      }
    }
    this.postSessionInfo(modelId)
    // A tier the new model does not serve would fail its turns with a 400
    // (muse-spark-1.2 has no `max`); drop to the highest tier it does serve.
    const levels = effortLevelsFor(modelId)
    if (!levels.includes(this.effort)) {
      await this.updateEffort(levels.at(-1) ?? DEFAULT_EFFORT, this.isThinkingEnabled)
    }
  }

  private async updateEffort(effort: EffortLevel, isThinkingEnabled: boolean): Promise<void> {
    this.effort = effort
    this.isThinkingEnabled = isThinkingEnabled
    if (this.session !== undefined) {
      await this.applyEffort(this.session)
    }
    this.postComposerState()
  }

  private async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (mode === BYPASS_MODE && !this.deps.isBypassAllowed()) {
      this.notice('warning', UI_TEXT.bypassNotAllowed)
      this.postComposerState()
      return
    }
    const previous = this.permissionMode
    this.permissionMode = mode
    const target = approvalModeFor(mode, this.deps.hasApprovalUi)
    if (
      this.session !== undefined &&
      target !== approvalModeFor(previous, this.deps.hasApprovalUi)
    ) {
      try {
        await this.session.setApprovalMode(target)
      } catch (error: unknown) {
        this.permissionMode = previous
        this.notice('error', `Could not change the permission mode: ${describe(error)}`)
      }
    }
    this.postComposerState()
  }

  private clear(): void {
    this.dropSession()
    this.attachments.clear()
    this.post({ type: 'attachmentsCleared' })
  }

  private async compact(): Promise<void> {
    const session = await this.sessionForAction()
    if (session === undefined) {
      return
    }
    try {
      const outcome = await session.compact()
      if (outcome.status === NOOP_STATUS) {
        this.notice('info', `Nothing to compact (${outcome.reason ?? NOOP_STATUS}).`)
      }
    } catch (error: unknown) {
      const reason = describe(error)
      if (reason.includes(MISSING_RUN_REASON)) {
        this.notice('info', NOTHING_TO_COMPACT)
      } else {
        this.notice('error', `Compaction failed: ${reason}`)
      }
    }
  }

  private async listSkills(): Promise<void> {
    if (this.skills !== undefined) {
      this.postSkills()
      return
    }
    const session = await this.sessionForAction()
    if (session !== undefined) {
      await this.refreshSkills(session)
    }
  }

  private async searchMentions(requestId: number, query: string): Promise<void> {
    try {
      const items = await this.deps.mentions.search(query, MENTION_RESULT_LIMIT)
      this.post({ type: 'mentionResults', requestId, items: [...items] })
    } catch (error: unknown) {
      this.deps.log.warn(`mention search failed: ${describe(error)}`)
      this.post({ type: 'mentionResults', requestId, items: [] })
    }
  }

  private addImage(name: string, bytes: Uint8Array): void {
    const result = this.attachments.add(name, bytes)
    if (result.ok) {
      this.post({ type: 'attachmentAdded', attachment: result.attachment })
    } else {
      this.post({ type: 'attachmentRejected', name, reason: result.reason })
    }
  }

  private insertMention(relativePath: string): void {
    this.post({ type: 'insertText', text: `@${relativePath} ` })
  }

  private async pickFile(): Promise<void> {
    const picked = await this.deps.files.showOpenDialog()
    for (const file of picked) {
      const extension = path.extname(file.name).toLowerCase()
      if (Object.hasOwn(IMAGE_EXTENSIONS, extension)) {
        this.addImage(file.name, await this.deps.files.readFile(file.fsPath))
      } else {
        this.insertMention(file.relativePath ?? file.fsPath.replaceAll('\\', '/'))
      }
    }
  }

  private async pickMentionFile(): Promise<void> {
    const relativePath = await this.deps.files.pickMentionFile()
    if (relativePath !== undefined) {
      this.insertMention(relativePath)
    }
  }

  private droppedUris(uris: readonly string[]): void {
    const mentions = uris
      .map((uri) => this.deps.files.toRelativePath(uri))
      .filter((relativePath) => relativePath !== undefined)
      .map((relativePath) => `@${relativePath} `)
    if (mentions.length > 0) {
      this.post({ type: 'insertText', text: mentions.join('') })
    }
  }

  private async runHostAction(action: HostAction): Promise<void> {
    try {
      await this.deps.runHostAction(action)
    } catch (error: unknown) {
      this.notice('error', `${action} failed: ${describe(error)}`)
    }
  }

  /** Called when the webview has mounted: replay the state it needs. */
  public surfaceReady(): void {
    this.post(this.deps.auth.toMessage())
    this.postComposerState()
    if (this.models !== undefined) {
      this.post({ type: 'modelList', models: [...this.models] })
    }
    if (this.session !== undefined) {
      this.postSessionInfo(this.session.modelId)
    }
    this.postSkills()
    for (const attachment of this.attachments.list()) {
      this.post({ type: 'attachmentAdded', attachment })
    }
  }

  public async handle(message: ConversationMessage): Promise<void> {
    switch (message.type) {
      case 'sendMessage': {
        await this.send(message.localId, message.text, message.attachmentIds)
        break
      }
      case 'cancelTurn': {
        await this.cancel()
        break
      }
      case 'signIn': {
        await this.deps.auth.signIn(message.method)
        break
      }
      case 'signOut': {
        this.dropSession()
        await this.deps.auth.signOut()
        break
      }
      case 'retryBackend': {
        this.dropSession()
        await this.deps.auth.refresh()
        break
      }
      case 'openExternal': {
        this.openLink(message.url)
        break
      }
      case 'decideApproval': {
        await this.decideApproval(message)
        break
      }
      case 'answerQuestion': {
        await this.answerQuestion(message)
        break
      }
      case 'readOutput': {
        await this.readOutput(message)
        break
      }
      case 'copyText': {
        await this.deps.copyText(message.text)
        break
      }
      case 'insertCode': {
        await this.insertCode(message.text)
        break
      }
      case 'setModel': {
        await this.setModel(message.modelId)
        break
      }
      case 'setEffort': {
        await this.updateEffort(message.effort, this.isThinkingEnabled)
        break
      }
      case 'setThinking': {
        await this.updateEffort(this.effort, message.enabled)
        break
      }
      case 'setPermissionMode': {
        await this.setPermissionMode(message.mode)
        break
      }
      case 'clearConversation': {
        this.clear()
        break
      }
      case 'compact': {
        await this.compact()
        break
      }
      case 'listSkills': {
        await this.listSkills()
        break
      }
      case 'searchMentions': {
        await this.searchMentions(message.requestId, message.query)
        break
      }
      case 'pickFile': {
        await this.pickFile()
        break
      }
      case 'pickMentionFile': {
        await this.pickMentionFile()
        break
      }
      case 'attachImageData': {
        this.addImage(message.name, new Uint8Array(Buffer.from(message.base64, 'base64')))
        break
      }
      case 'removeAttachment': {
        this.attachments.remove(message.id)
        break
      }
      case 'droppedUris': {
        this.droppedUris(message.uris)
        break
      }
      case 'hostAction': {
        await this.runHostAction(message.action)
        break
      }
    }
  }

  /** Alt+T: flip the Thinking toggle for this conversation. */
  public async toggleThinking(): Promise<void> {
    await this.updateEffort(this.effort, !this.isThinkingEnabled)
  }

  /** The host process died: forget the session and tell the user. */
  public hostExited(description: string): void {
    this.dropSession()
    this.deps.auth.markBackendError(`${UI_TEXT.hostExited} (${description})`)
  }

  public dispose(): void {
    this.dropSession()
  }
}
