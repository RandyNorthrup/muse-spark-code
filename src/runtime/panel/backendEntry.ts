import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { createRuntimeCheckpoints } from '../features/checkpoints'
import { createRuntimeVerify } from '../features/verify'
import { createRuntimeCodeIntel } from '../features/codeIntel'
import { createRuntimeWebFetch } from '../features/webFetch'
import { createFileScheduleStore } from '../../host/backend/fileScheduleStore'
import type { RuntimeBackendDeps } from '../backends'
import type { HostServices } from '../../shared/hostApi/methods'
import type { ExtensionSettings } from '../../host/settings'
import type { Logger } from '../../host/logger'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { MODEL_API_SCHEDULES_DIR } from '../../shared/constants'
import { workspaceSessionsFolder } from '../dataFolder'
import type { RuntimeSelectedModel } from './runtimeFeatures'

export { createRuntimeHooks } from '../features/hooks'
export { createRuntimeMcp } from '../features/mcp'
export { createRuntimeBrowser } from '../features/browser'
export { createRuntimeAutoReviewer } from '../features/autoReviewer'
export { createRuntimePaidBudget } from '../features/paidBudget'
export { RuntimePaidUse } from '../features/paidUse'
export { runtimePaidRequestAdmission } from '../features/paidRequest'
export { createRuntimeTab } from '../features/tab'

export type RuntimeBackendExtensions = Pick<
  RuntimeBackendDeps,
  | 'checkpoints'
  | 'unsavedPaths'
  | 'verify'
  | 'hooks'
  | 'codeIntel'
  | 'webFetch'
  | 'browser'
  | 'mcp'
  | 'schedules'
  | 'hookSettings'
  | 'isWorkspaceTrusted'
  | 'interactivePaid'
  | 'reservePaidRequest'
  | 'paidResponseCost'
  | 'paidUsage'
  | 'autoReviewer'
>
export interface RuntimePanelBackendContext {
  readonly host: HostServices
  readonly dataRoot: string
  readonly distDir: string
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly settings: (root: string) => ExtensionSettings
  readonly trusted: (root: string) => boolean
  readonly documents: () => readonly { uri: string; dirty: boolean }[]
  readonly selectedModel: (root: string) => RuntimeSelectedModel | undefined
  readonly assertCurrent: () => void
  readonly onCheckpointAvailabilityChanged: () => void
  readonly log: Logger
}

/** Actual tool recording and fresh editor services; unverified selected capabilities deny tool offers. */
export function createPanelBackendOptions(
  context: RuntimePanelBackendContext,
  table: UiText,
  locale: string,
): RuntimeBackendExtensions {
  setUiText(table, locale)
  const check = (root: string) => {
    context.assertCurrent()
    if (!context.trusted(root)) throw new Error('MHP_WORKSPACE_UNTRUSTED')
  }
  const canUseTools = (root: string) =>
    context.selectedModel(root)?.capabilities.has('tools') === true
  const unsavedFor = (document: { readonly uri: string }): readonly string[] => {
    let display: string
    try {
      display = fileURLToPath(document.uri, { windows: context.platform === 'win32' })
    } catch {
      return []
    }
    try {
      const resolved = realpathSync.native(display)
      return display === resolved ? [display] : [display, resolved]
    } catch {
      return [display]
    }
  }
  return {
    isWorkspaceTrusted: context.trusted,
    unsavedPaths: () =>
      context
        .documents()
        .filter((document) => document.dirty)
        .flatMap((document) => unsavedFor(document)),
    checkpoints: (workspaceRoot) =>
      createRuntimeCheckpoints(
        {
          workspaceRoot,
          dataRoot: context.dataRoot,
          distDir: context.distDir,
          platform: context.platform,
          env: context.env,
          log: context.log,
          isTrusted: () => context.trusted(workspaceRoot),
          isEnabled: () => context.settings(workspaceRoot).turnCheckpoints,
          retentionDays: () => context.settings(workspaceRoot).cleanupPeriodDays,
          onAvailabilityChanged: context.onCheckpointAvailabilityChanged,
        },
        table,
        locale,
      ),
    verify: (workspaceRoot) =>
      createRuntimeVerify({
        workspaceRoot,
        platform: context.platform,
        host: context.host,
        realPath: realpath,
        settings: () => context.settings(workspaceRoot),
        assertCurrent: () => {
          check(workspaceRoot)
        },
        settledDiagnostics: (uri, version, signal) =>
          context.host.request('diagnostics/settled', { uri, expectedVersion: version }, signal),
      }),
    codeIntel: (workspaceRoot) =>
      createRuntimeCodeIntel({
        host: context.host,
        workspaceRoot,
        platform: context.platform,
        realPath: realpath,
        assertCurrent: () => {
          check(workspaceRoot)
        },
        canUseTools: () => canUseTools(workspaceRoot),
        libraryRoots: () => [],
      }),
    webFetch: (workspaceRoot, fetchPage) =>
      createRuntimeWebFetch({
        fetchPage,
        assertCurrent: () => {
          check(workspaceRoot)
        },
        isOffered: () =>
          context.trusted(workspaceRoot) &&
          canUseTools(workspaceRoot) &&
          context.settings(workspaceRoot).sandboxNetwork !== 'restricted',
      }),
    schedules: (root) =>
      createFileScheduleStore({
        directory: workspaceSessionsFolder(
          { platform: context.platform, env: context.env, homeDir: context.homeDir },
          root,
        ).replace(/modelapi-sessions$/u, () => MODEL_API_SCHEDULES_DIR),
        now: Date.now,
        log: context.log,
      }),
  }
}

export {
  createConfiguredPanelBackend,
  type RuntimeBackendConfiguration,
  type RuntimeConfiguredBackend,
} from './backendConfiguration'

export { createRuntimeCheckpoints } from '../features/checkpoints'
export { createRuntimeVerify } from '../features/verify'
export { createRuntimeCodeIntel } from '../features/codeIntel'
export { createRuntimeWebFetch } from '../features/webFetch'
export { createFileScheduleStore } from '../../host/backend/fileScheduleStore'
export { createNativeGitHub, createNativeKeySignIn } from './nativeGitHub'
