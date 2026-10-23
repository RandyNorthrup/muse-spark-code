// Shared conversation composition (D84, M104 A). Runtime and VS Code
// supply the same feature ports; only the adapter touches an editor API.
import { logRejection } from '../logger'
import { pathToFileURL } from 'node:url'
import { DEFAULT_MODEL_ID, HAS_APPROVAL_UI, UI_TEXT } from '../../shared/constants'
import type { HostServices } from '../../shared/hostApi/methods'
import { usablePaidFeatures } from '../../shared/paid'
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

export type ConversationFeaturePorts = Pick<
  ConversationDeps,
  | 'usageRecording'
  | 'runManualHook'
  | 'rewriteMessage'
  | 'surface'
  | 'questions'
  | 'showDeterministicReport'
  | 'tasksTab'
  | 'auth'
  | 'ensureHost'
  | 'workspaceRoot'
  | 'openSideChat'
  | 'mentions'
  | 'files'
  | 'mediaAttachments'
  | 'recordingCommandDeps'
  | 'isRemoteWindow'
  | 'confirmContributor'
  | 'runHostAction'
  | 'notifyAttention'
  | 'museCodeReviewer'
  | 'judge'
  | 'insertCode'
  | 'onSandboxUnavailable'
  | 'platform'
  | 'shellSandbox'
  | 'shellSandboxReadiness'
  | 'shouldWarnSandboxOff'
  | 'editorContext'
  | 'isAutosaveEnabled'
  | 'unsavedFiles'
  | 'applyCode'
  | 'editReview'
  | 'review'
  | 'estimator'
  | 'openDocument'
  | 'openFile'
  | 'ideMcpEndpoint'
  | 'ideMcpCaller'
  | 'noteIdeSessionSecret'
  | 'newAttachmentId'
  | 'sessions'
  | 'readServiceStatus'
  | 'accountFacts'
  | 'usageInsights'
  | 'readProviderKeyUsage'
  | 'uploadedFiles'
  | 'isRestorable'
  | 'dictation'
  | 'exports'
  | 'transferFiles'
  | 'reports'
  | 'plans'
  | 'isWorkspaceTrusted'
  | 'isWorktreeHeld'
  | 'createGit'
  | 'onForegroundTasksChanged'
  | 'schedulesBridge'
  | 'checkpoints'
  | 'unsavedPaths'
  | 'bundledSkillsOffer'
  | 'pendingPrompts'
  | 'legalScan'
  | 'legalExplanation'
  | 'legalMarkdown'
  | 'createLegalFixPreviews'
  | 'legalFixApplier'
  | 'createLegalHold'
  | 'bestOfNCoordinator'
  | 'runGit'
  | 'runBestOfNGit'
  | 'realPath'
  | 'now'
  | 'log'
>

export interface ConversationCompositionPorts {
  readonly features: ConversationFeaturePorts
  readonly settings: () => Pick<
    ExtensionSettings,
    | 'initialPermissionMode'
    | 'allowDangerouslySkipPermissions'
    | 'confidentialWorkspace'
    | 'dictationEngine'
    | 'modelApiSessionBudgetUsd'
    | 'diagnosticsAfterEdits'
    | 'checkCommands'
  >
  readonly paid: {
    readonly gate: Pick<PaidFeatureGate, 'isOn' | 'turnOn' | 'turnOff'>
    readonly consent: Pick<PaidUseConsent, 'allows' | 'forget'>
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
  /**
  Muse Voice is a Meta service: the stored Meta key's own digest, never
  the selected conversation provider's, and undefined when no Meta key
  exists (the press then says why).
  */
  readonly voiceAccountId: () => Promise<string | undefined>
  /** The window's background schedules as board rows, for the session board. */
  readonly backgroundSessions: () => Iterable<BoardSession>
  readonly museVoiceSetup: ConversationDeps['dictation']
  readonly controllers: () => Iterable<
    Pick<ConversationController, 'boardSession' | 'revealBoardSession'>
  >
  readonly isProjectTrusted: () => boolean
  readonly toolImageIo: ToolImageIo
}

async function isConfirmed(
  host: HostServices,
  title: string,
  message: string,
  action: string,
): Promise<boolean> {
  return (
    (await host.request('ui/confirm', { title, message, choices: [{ id: 1, title: action }] })) ===
    1
  )
}

/** Builds the full controller dependencies without loading a vscode module.
Synchronous editor, trust and document state belongs to features; async MHP
actions go through host. A runtime caller must keep those snapshots current.
*/
export function composeConversationDeps(
  host: HostServices,
  ports: ConversationCompositionPorts,
): ConversationDeps {
  const {
    features,
    settings: currentSettings,
    paid,
    modelApi,
    isKeyStored,
    voiceAccountId,
    backgroundSessions,
    museVoiceSetup,
    controllers,
    isProjectTrusted,
    toolImageIo,
  } = ports
  const { auth, workspaceRoot, platform, realPath: canonicalPath } = features
  return {
    ...features,
    modelId: DEFAULT_MODEL_ID,
    initialPermissionMode: currentSettings().initialPermissionMode,
    hasApprovalUi: HAS_APPROVAL_UI,
    openExternal: (url) => {
      void host
        .request('ui/openExternal', { uri: url })
        .catch(logRejection(features.log, 'open external'))
    },
    isBypassAllowed: () => currentSettings().allowDangerouslySkipPermissions,
    confirmRemoteBypass: async () =>
      await isConfirmed(
        host,
        UI_TEXT.bypassRemoteTitle,
        UI_TEXT.bypassRemoteDetail,
        UI_TEXT.bypassRemoteConfirm,
      ),
    isConfidentialWorkspace: () => currentSettings().confidentialWorkspace,
    copyText: async (text) => {
      await host.request('ui/clipboard', { text })
    },
    saveAll: async () => {
      await host.request('documents/saveAll', {})
    },
    readToolImage: async (imagePath) =>
      await loadToolImage(imagePath, workspaceRoot, platform, toolImageIo),
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
    voiceAccountId,
    ownedVoiceBudgetScope: async (sessionId) => {
      if (auth.current.backend !== 'modelApi') {
        throw new SpendLedgerError('integrity', { scope: 'session', file: 'extension' })
      }
      const host = await modelApi.ensureHost()
      return await host.getOwnedBudgetScope(sessionId)
    },
    setPaidFeature: async (feature, isOn) => {
      if (isOn) {
        await paid.gate.turnOn(feature)
      } else {
        await paid.gate.turnOff(feature)
      }
    },
    isScheduledPaidOn: () => paid.gate.isOn('scheduledPrompts'),
    confirmScheduledRun: async (job, modelId) =>
      await paid.consent.allows({ feature: 'scheduledPrompts', prompt: job.prompt, modelId }),
    allowsPaidUse: async (request) => await paid.consent.allows(request),
    forgetPaidUse: async () => {
      await paid.consent.forget()
    },
    confirmFileAction: async (title, detail, action) =>
      await isConfirmed(host, title, detail, action),
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
          const checked = await confineWorkspacePath(root, file, platform, {
            realPath: canonicalPath,
          })
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
    openBestOfNWorktree: async (absolutePath) => {
      await host.request('workspace/openFolder', {
        uri: pathToFileURL(absolutePath).href,
        newWindow: true,
      })
    },
    isPaidFeatureOn: (feature) => paid.gate.isOn(feature),
    notePaidUse: (feature, units, searchPriceUsd) => {
      paid.usage.add(feature, units, searchPriceUsd)
    },
    buildAttemptHost: (worktreeRoot, admitRequest, noteUsage, budgetScope) =>
      modelApi.buildAttemptHost(worktreeRoot, admitRequest, noteUsage, budgetScope),
  }
}
