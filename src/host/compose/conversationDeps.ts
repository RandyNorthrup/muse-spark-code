// The conversation controller's dependencies that are the same in every
// editor (M104 lane B, D84): what a setting, the paid gate or the model API
// manager answers, mapped onto the controller's ports. VS Code and the
// runtime panel both build their dependencies from this one mapping; only
// what needs an editor's own API (a modal, the clipboard, the save-all
// command, a new window) comes in through `ConversationEditorPorts`, which
// VS Code answers with its API and the runtime with MHP requests.
import { DEFAULT_MODEL_ID, HAS_APPROVAL_UI, UI_TEXT } from '../../shared/constants'
import { usablePaidFeatures, type PaidUseDecision, type PaidUseRequest } from '../../shared/paid'
import { loadToolImage, type ToolImageIo } from '../../core/toolImages'
import { confineWorkspacePath } from '../../core/workspacePath'
import { isProtectedPath } from '../../core/protectedPaths'
import { verifyGuidance } from '../../core/verify/checkCommands'
import type { EditedFile } from '../../core/verify/diagnosticsReport'
import { SpendLedgerError } from '../../core/paid/spendLedgerError'
import type { PaidFeatureGate, PaidUsage } from '../../core/paid/paidFeatures'
import type { PaidUseConsent } from '../../core/paid/paidConsent'
import type { BoardSession } from '../../core/sessionBoard'
import type { ModelApiBackendManager } from '../backend/modelApiBackendManager'
import type {
  ConversationController,
  ConversationDeps,
} from '../conversation/conversationController'
import type { ExtensionSettings } from '../settings'

/** What the shared mapping asks of an editor: its own modals, clipboard, save-all and windows. */
export interface ConversationEditorPorts {
  readonly openExternal: (url: string) => void
  readonly copyText: (text: string) => Promise<void>
  readonly saveAll: () => Promise<void>
  /** A modal with a title, a detail and one action; true when the person took it. */
  readonly confirm: (title: string, detail: string, action: string) => Promise<boolean>
  /** A folder in a new window of the editor. */
  readonly openFolderInNewWindow: (absolutePath: string) => Promise<void>
}

/** Every member of the controller's dependencies this mapping fills. */
export type SharedConversationDeps = Pick<
  ConversationDeps,
  | 'modelId'
  | 'initialPermissionMode'
  | 'hasApprovalUi'
  | 'openExternal'
  | 'isBypassAllowed'
  | 'confirmRemoteBypass'
  | 'isConfidentialWorkspace'
  | 'copyText'
  | 'saveAll'
  | 'readToolImage'
  | 'museVoice'
  | 'modelApiSessionBudgetUsd'
  | 'museCodeMaxRetries'
  | 'museCodeQuotaContinue'
  | 'ownedVoiceBudgetScope'
  | 'setPaidFeature'
  | 'isScheduledPaidOn'
  | 'confirmScheduledRun'
  | 'allowsPaidUse'
  | 'forgetPaidUse'
  | 'confirmFileAction'
  | 'verifyGuidance'
  | 'boardSessions'
  | 'focusBoardSession'
  | 'bestOfNWorkspaceEdits'
  | 'modelApiAccountId'
  | 'noteBestOfNRequest'
  | 'noteBestOfNUsage'
  | 'bestOfNBudgetScope'
  | 'openBestOfNWorktree'
  | 'isPaidFeatureOn'
  | 'notePaidUse'
  | 'buildAttemptHost'
>

export interface ConversationCompositionPorts {
  readonly editor: ConversationEditorPorts
  readonly settings: () => Pick<
    ExtensionSettings,
    | 'initialPermissionMode'
    | 'allowDangerouslySkipPermissions'
    | 'confidentialWorkspace'
    | 'dictationEngine'
    | 'modelApiSessionBudgetUsd'
    | 'museCodeMaxRetries'
    | 'museCodeQuotaContinue'
    | 'diagnosticsAfterEdits'
    | 'checkCommands'
  >
  readonly auth: Pick<ConversationDeps['auth'], 'current'>
  readonly workspaceRoot: string | undefined
  readonly platform: NodeJS.Platform
  readonly realPath: (absolutePath: string) => Promise<string>
  readonly paid: {
    readonly gate: Pick<PaidFeatureGate, 'isOn' | 'turnOn' | 'turnOff'>
    readonly consent: {
      readonly allows: (request: PaidUseRequest) => Promise<PaidUseDecision>
      readonly forget: PaidUseConsent['forget']
    }
    readonly usage: Pick<PaidUsage, 'addBestOfNRequest' | 'addBestOfNUsage' | 'add'>
  }
  readonly modelApi: Pick<
    ModelApiBackendManager,
    | 'accountId'
    | 'ensureHost'
    | 'captureExternalEditOwner'
    | 'beginExternalEdit'
    | 'bestOfNBudgetScope'
    | 'buildAttemptHost'
  >
  readonly isKeyStored: () => boolean
  /** Muse Voice's setup while it is the microphone's engine. */
  readonly museVoiceSetup: ConversationDeps['dictation']
  /** The window's background schedules as board rows, for the session board. */
  readonly backgroundSessions: () => Iterable<BoardSession>
  /** Every conversation of the window, for the session board. */
  readonly controllers: () => Iterable<
    Pick<ConversationController, 'boardSession' | 'revealBoardSession'>
  >
  readonly isProjectTrusted: () => boolean
  readonly toolImageIo: ToolImageIo
}

/** Builds the dependencies that need no editor type; the caller adds the rest. */
export function composeConversationDeps(
  ports: ConversationCompositionPorts,
): SharedConversationDeps {
  const {
    editor,
    settings: currentSettings,
    auth,
    workspaceRoot,
    platform,
    realPath,
    paid,
    modelApi,
    isKeyStored,
    museVoiceSetup,
    backgroundSessions,
    controllers,
    isProjectTrusted,
    toolImageIo,
  } = ports
  return {
    modelId: DEFAULT_MODEL_ID,
    initialPermissionMode: currentSettings().initialPermissionMode,
    hasApprovalUi: HAS_APPROVAL_UI,
    openExternal: editor.openExternal,
    isBypassAllowed: () => currentSettings().allowDangerouslySkipPermissions,
    confirmRemoteBypass: async () =>
      await editor.confirm(
        UI_TEXT.bypassRemoteTitle,
        UI_TEXT.bypassRemoteDetail,
        UI_TEXT.bypassRemoteConfirm,
      ),
    isConfidentialWorkspace: () => currentSettings().confidentialWorkspace,
    copyText: editor.copyText,
    saveAll: editor.saveAll,
    readToolImage: async (imagePath) =>
      await loadToolImage(imagePath, workspaceRoot, platform, toolImageIo),
    // Muse Voice on the Model API backend, and on Muse Code with a stored key (M44).
    museVoice: () => {
      if (
        !paid.gate.isOn('voice') ||
        !usablePaidFeatures(auth.current.backend, isKeyStored()).includes('voice')
      )
        return
      if (auth.current.backend === 'modelApi' && currentSettings().dictationEngine === 'system')
        return
      return museVoiceSetup
    },
    modelApiSessionBudgetUsd: () => currentSettings().modelApiSessionBudgetUsd,
    // D228: the person's Muse Code resend limit, read per resend decision;
    // unset leaves the industry default in force.
    museCodeMaxRetries: () => currentSettings().museCodeMaxRetries ?? undefined,
    // D252: the person's quota-continue opt-in, read per continue decision.
    museCodeQuotaContinue: () => currentSettings().museCodeQuotaContinue,
    ownedVoiceBudgetScope: async (sessionId) => {
      if (auth.current.backend !== 'modelApi') {
        throw new SpendLedgerError('integrity', { scope: 'session', file: 'extension' })
      }
      const host = await modelApi.ensureHost()
      return await host.getOwnedBudgetScope(sessionId)
    },
    // The palette's paid-feature toggles (M33): on goes through the price confirmation.
    setPaidFeature: async (feature, isOn) => {
      if (isOn) {
        await paid.gate.turnOn(feature)
      } else {
        await paid.gate.turnOff(feature)
      }
    },
    isScheduledPaidOn: () => paid.gate.isOn('scheduledPrompts'),
    confirmScheduledRun: async (job, modelId) =>
      (await paid.consent.allows({
        feature: 'scheduledPrompts',
        prompt: job.prompt,
        modelId,
      })) === true,
    allowsPaidUse: async (request) => await paid.consent.allows(request),
    forgetPaidUse: async () => {
      await paid.consent.forget()
    },
    confirmFileAction: editor.confirm,
    // Muse Code checks its own edits (M68): its checks run through its own
    // shell, so none are named while Restricted Mode runs no shell (D13).
    // The diagnostics sentence only for a session that has the ide server.
    verifyGuidance: (hasIdeServer) => {
      const settings = currentSettings()
      return verifyGuidance(
        settings.diagnosticsAfterEdits && hasIdeServer,
        isProjectTrusted() ? settings.checkCommands : [],
      )
    },
    boardSessions: () => {
      const sessions: BoardSession[] = []
      for (const active of controllers()) {
        const session = active.boardSession()
        if (session !== undefined) sessions.push(session)
      }
      for (const background of backgroundSessions())
        if (sessions.every((session) => session.sessionId !== background.sessionId))
          sessions.push(background)
      return sessions
    },
    focusBoardSession: (sessionId, backendKind) => {
      for (const active of controllers()) {
        if (active.revealBoardSession(sessionId, backendKind)) return true
      }
      return false
    },
    bestOfNWorkspaceEdits: (session) => {
      const owner = session === undefined ? undefined : modelApi.captureExternalEditOwner(session)
      return async (root, paths) => {
        const files: EditedFile[] = []
        for (const file of paths) {
          const checked = await confineWorkspacePath(root, file, platform, { realPath })
          if (
            !checked.ok ||
            isProtectedPath(checked.relative) ||
            isProtectedPath(checked.canonical) ||
            checked.relative !== checked.canonical
          ) {
            throw new Error(UI_TEXT.bestOfNTargetChanged)
          }
          files.push({ relative: checked.canonical, absolute: checked.checkedAbsolute })
        }
        return modelApi.beginExternalEdit(owner, files)
      }
    },
    modelApiAccountId: () => modelApi.accountId(),
    noteBestOfNRequest: () => {
      paid.usage.addBestOfNRequest()
    },
    noteBestOfNUsage: (modelId, usage) => {
      paid.usage.addBestOfNUsage(modelId, usage)
    },
    bestOfNBudgetScope: (sessionId) => modelApi.bestOfNBudgetScope(sessionId),
    openBestOfNWorktree: editor.openFolderInNewWindow,
    isPaidFeatureOn: (feature) => paid.gate.isOn(feature),
    notePaidUse: (feature, units, searchPriceUsd) => {
      paid.usage.add(feature, units, searchPriceUsd)
    },
    buildAttemptHost: (worktreeRoot, admitRequest, noteUsage, budgetScope) =>
      modelApi.buildAttemptHost(worktreeRoot, admitRequest, noteUsage, budgetScope),
  }
}
