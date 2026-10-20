import reportThemes from '../../../design/tokens/generated/report-themes.json'
import path from 'node:path'
import type { ReportingContext } from '../../runtime/reporting/engine'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { workspaceKey as scheduleWorkspaceKey } from '../../runtime/dataFolder'
import {
  GITHUB_AUTH_PROVIDER,
  GITHUB_AUTH_SCOPES,
  GITHUB_API_BASE_URL,
  GITHUB_MEDIA_TYPE,
  GITHUB_API_VERSION,
  SCHEDULE_STORE_SUBFOLDER,
  UI_TEXT,
} from '../../shared/constants'
import { reportWorkspaceKey } from '../../core/reporting/sources/local'
import type { AccountsFacts, SourceReadContext } from '../../core/reporting/sources/types'
import type { UsageReportJournal } from '../../core/usage/reportUsage'
import type { UsageBudgetRead } from '../../core/usage/usageService'
import type {
  SecurityVaultSnapshot,
  SessionHistoryInput,
} from '../../runtime/reporting/reportInputs'
import type { EstimateRequest } from '../../shared/estimate'
import { readSettings } from '../settings'
import * as vscode from 'vscode'
import { ReportPanel, type ReportPanelDeps } from './reportPanel'
import { reportEngineLoader } from './reportEngineBundle'
import { reportInputsLoader } from '../../runtime/reporting/reportInputsLoader'
import { playbookSchedulesInputsLoader } from '../../runtime/reporting/playbookSchedulesInputsLoader'

export function createReportPanel(
  deps: ReportPanelDeps,
  table: UiText,
  locale: string,
): ReportPanel {
  setUiText(table, locale)
  return new ReportPanel(deps)
}

export interface ReportingWindowDeps extends Pick<
  ReportPanelDeps,
  'context' | 'attachMarkdown' | 'openProblem'
> {
  readonly workspaceRoot: string | undefined
  readonly storageRoot: string
  readonly generatorVersion: string
  readonly questions?: ReportingContext['questions']
  /**
  M113 C-M113-2: this surface's live conversation (null when it has none)
  and the stored-session fallback directory for --session ids from other
  surfaces (undefined when nothing is persisted). The usage journal folder
  is always available: it is the shared agent data folder, not storage.
  */
  readonly reportSessionHistory?: () => Promise<SessionHistoryInput | null>
  readonly reportStoredSessionDir?: string | undefined
  /**
  M113 C-M113-4: M117's run for the estimate kind, through the extension's
  lazy estimator bundle. Absent until the estimator binds it; the kind
  then reports unavailable, never a guess.
  */
  readonly reportEstimateRun?: (request: EstimateRequest, signal: AbortSignal) => Promise<unknown>
  readonly reportBeforeRead: () => Promise<void>
  readonly reportReadBudgets: () => Promise<readonly UsageBudgetRead[]>
  readonly reportUsageDataFolder: string
  /**
  C-M113-3: M108's use and swaps adapters. Unbound until the owning lane
  binds them here; until then those accounts facets stay empty and named.
  */
  readonly reportAccountsUsage?: (
    context: SourceReadContext,
  ) => Promise<AccountsFacts['usage'] | null>
  readonly reportAccountsEvents?: (
    context: SourceReadContext,
  ) => Promise<Pick<AccountsFacts, 'events' | 'confirmations'> | null>
  /**
  C-M113-3: an unlock-capable vault view for the security kind. Unbound
  until the vault lane binds it here; until then the vault facets stay
  empty and named, and the developer audit still reports.
  */
  readonly reportVaultSnapshot?: (
    context: SourceReadContext,
  ) => Promise<SecurityVaultSnapshot | null>
}

/** Window adapters and engine acquisition live entirely inside the lazy panel bundle. */
export function createReportingWindow(
  deps: ReportingWindowDeps,
  table: UiText,
  locale: string,
): ReportPanel {
  const workspaceKey = reportWorkspaceKey(deps.workspaceRoot ?? process.cwd(), process.platform)
  const loadEngine = reportEngineLoader({
    bundlePath: vscode.Uri.joinPath(deps.context.extensionUri, 'dist', 'reporting.js').fsPath,
    log: deps.context.log,
  })
  let isSignedIn = false
  let authenticationRevision = 0
  const authenticationChanges = vscode.authentication.onDidChangeSessions((event) => {
    if (event.provider.id !== GITHUB_AUTH_PROVIDER) return
    isSignedIn = false
    authenticationRevision += 1
  })
  let engine: ReturnType<ReturnType<typeof loadEngine>['createReportingEngine']> | undefined
  // M113 C-M113-2: the session and usage inputs load with their own bundle on
  // first use, so neither activation nor the reporting engine carries them.
  const loadInputs = reportInputsLoader({
    bundlePath: vscode.Uri.joinPath(deps.context.extensionUri, 'dist', 'reportInputs.js').fsPath,
    log: deps.context.log,
  })
  // M113 C-M113-4: the playbook and schedules inputs ride a second bundle
  // beside it; the journal replay and schedule store would overflow the
  // session/usage chunk's budget.
  const loadPlaybookSchedules = playbookSchedulesInputsLoader({
    bundlePath: vscode.Uri.joinPath(deps.context.extensionUri, 'dist', 'playbookSchedulesInputs.js')
      .fsPath,
    log: deps.context.log,
  })
  let journalReader:
    ReturnType<ReturnType<typeof loadInputs>['createReportJournalReader']> | undefined
  const readJournal: (context: SourceReadContext) => Promise<UsageReportJournal> = (context) => {
    journalReader ??= loadInputs().createReportJournalReader({
      dataFolder: deps.reportUsageDataFolder,
      beforeRead: deps.reportBeforeRead,
      readBudgets: deps.reportReadBudgets,
      // One offset per report: the budget stamp shares the usage period's
      // sample through the run, like M102's page (RVCM1132B finding 2,
      // RVCM1132C finding 3). The cached reader no longer freezes one offset
      // for the window's life.
      timezoneOffsetMins: loadInputs().reportTimezoneOffset,
    })
    return journalReader(context)
  }
  const sessionInput = () => ({
    resolveSession: async (sessionId: string | undefined) => {
      if (sessionId === undefined) return (await deps.reportSessionHistory?.()) ?? null
      if (deps.reportStoredSessionDir !== undefined) {
        const stored = await loadInputs().readStoredReportSession(
          deps.reportStoredSessionDir,
          sessionId,
        )
        if (stored !== null) return stored
      }
      const current = await deps.reportSessionHistory?.()
      return current?.sessionId === sessionId ? current : null
    },
    readJournal,
  })
  return createReportPanel(
    {
      ...deps,
      workspaceKey,
      disposeWindow: () => {
        authenticationChanges.dispose()
      },
      engine: () =>
        (engine ??= loadEngine().createReportingEngine({
          ...deps,
          session: {
            read: (context) =>
              loadInputs().createSessionReportReader(sessionInput(), table, locale).read(context),
          },
          usage: (context) =>
            loadInputs().createUsageReportReader(
              {
                dataFolder: deps.reportUsageDataFolder,
                readJournal,
                // The machine-local day, like M102's page and the journal's
                // own day stamps; the contract carries it explicitly (D93).
                // The shared per-run sample keeps the period on the budget
                // stamp's day (RVCM1132C finding 3).
                timezoneOffsetMins: loadInputs().reportTimezoneOffset,
              },
              table,
              locale,
            )(context),
          // M113 C-M113-5: this install's manifest, read at generation time
          // through the inputs bundle, so the panel reports the bindings it
          // actually ships; the lazy call stays inside the read, like usage.
          keybindings: () =>
            loadInputs().keybindingsManifestReader(
              vscode.Uri.joinPath(deps.context.extensionUri, 'package.json').fsPath,
            )(),

          accounts: {
            read: (context) =>
              loadInputs()
                .createAccountsReportReader(
                  {
                    dataDir: deps.reportUsageDataFolder,
                    ...(deps.reportAccountsUsage !== undefined && {
                      readUsage: deps.reportAccountsUsage,
                    }),
                    ...(deps.reportAccountsEvents !== undefined && {
                      readEvents: deps.reportAccountsEvents,
                    }),
                  },
                  table,
                  locale,
                )
                .read(context),
          },
          security: {
            read: (context) =>
              loadInputs()
                .createSecurityReportReader(
                  {
                    dataDir: deps.reportUsageDataFolder,
                    ...(deps.reportVaultSnapshot !== undefined && {
                      readVault: deps.reportVaultSnapshot,
                    }),
                  },
                  table,
                  locale,
                )
                .read(context),
          },
          // M113 C-M113-4: the playbook journal and the schedules store
          // live under the same agent data folder as the usage journal.
          playbook: {
            read: (context) =>
              loadPlaybookSchedules()
                .createPlaybookReportReader(
                  {
                    agentDataFolder: deps.reportUsageDataFolder,
                    workspaceRoot: deps.workspaceRoot ?? process.cwd(),
                  },
                  table,
                  locale,
                )
                .read(context),
          },
          schedules: {
            read: (context) =>
              loadPlaybookSchedules()
                .createSchedulesReportReader(
                  {
                    storeRoot: path.join(deps.reportUsageDataFolder, SCHEDULE_STORE_SUBFOLDER),
                    workspaceKey: scheduleWorkspaceKey(
                      path.resolve(deps.workspaceRoot ?? process.cwd()),
                    ),
                  },
                  table,
                  locale,
                )
                .read(context),
          },
          // M113 C-M113-4: the estimate kind runs M117's engine through the
          // extension's lazy estimator bundle. Only estimate reports load
          // it; every other kind leaves the reader untouched.
          ...(deps.reportEstimateRun !== undefined && {
            estimate: {
              read: (request, context) =>
                loadInputs()
                  .createEstimateReportReader(
                    {
                      run: (runRequest, signal) =>
                        deps.reportEstimateRun?.(runRequest, signal) ??
                        Promise.reject(new Error(UI_TEXT.reportUi.generationFailed)),
                    },
                    table,
                    locale,
                  )
                  .read(request, context),
            },
          }),
          workspaceKey,
          l10n: deps.context.l10n,
          log: deps.context.log,
          generatorVersion: deps.generatorVersion,
          network: async () => {
            const mode = readSettings(
              vscode.workspace.getConfiguration('museSpark'),
              deps.context.log,
            )['reports.network']
            const revision = authenticationRevision
            const session =
              mode === 'off'
                ? undefined
                : await vscode.authentication.getSession(
                    GITHUB_AUTH_PROVIDER,
                    [...GITHUB_AUTH_SCOPES],
                    { silent: true },
                  )
            isSignedIn = revision === authenticationRevision && session !== undefined
            return {
              policy: {
                surface: 'editor' as const,
                get mode() {
                  return readSettings(
                    vscode.workspace.getConfiguration('museSpark'),
                    deps.context.log,
                  )['reports.network']
                },
                get githubSignedIn() {
                  return isSignedIn
                },
                allowEgress: () => Promise.resolve(vscode.workspace.isTrusted),
              },
              transport: (request, etag, signal) => {
                if (
                  new URL(request.url).origin !== GITHUB_API_BASE_URL ||
                  (request.method ?? 'GET') !== 'GET' ||
                  request.body !== undefined
                )
                  return Promise.reject(new Error(UI_TEXT.reportSourceReasons.refused))
                const headers = new Headers({
                  Accept: GITHUB_MEDIA_TYPE,
                  'X-GitHub-Api-Version': GITHUB_API_VERSION,
                })
                if (etag !== null) headers.set('If-None-Match', etag)
                if (session !== undefined && revision === authenticationRevision)
                  headers.set('Authorization', `Bearer ${session.accessToken}`)
                return fetch(request.url, {
                  headers,
                  signal,
                  redirect: 'manual',
                  credentials: 'omit',
                })
              },
            }
          },
          get keepHistory() {
            return readSettings(vscode.workspace.getConfiguration('museSpark'), deps.context.log)[
              'reports.keepHistory'
            ]
          },
          get enabledAgents() {
            return readSettings(vscode.workspace.getConfiguration('museSpark'), deps.context.log)[
              'reports.agentSources'
            ]
          },
        })),
      now: () => new Date().toISOString(),
      theme: () => {
        switch (vscode.window.activeColorTheme.kind) {
          case vscode.ColorThemeKind.Dark: {
            return reportThemes.dark
          }
          case vscode.ColorThemeKind.HighContrast: {
            return reportThemes['hc-dark']
          }
          case vscode.ColorThemeKind.HighContrastLight: {
            return reportThemes['hc-light']
          }
          default: {
            return reportThemes.light
          }
        }
      },
    },
    table,
    locale,
  )
}
