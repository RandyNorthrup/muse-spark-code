import reportThemes from '../../../design/tokens/generated/report-themes.json'
import type { ReportingContext } from '../../runtime/reporting/engine'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  GITHUB_AUTH_PROVIDER,
  GITHUB_AUTH_SCOPES,
  GITHUB_API_BASE_URL,
  GITHUB_MEDIA_TYPE,
  GITHUB_API_VERSION,
  UI_TEXT,
} from '../../shared/constants'
import { reportWorkspaceKey } from '../../core/reporting/sources/local'
import { readSettings } from '../settings'
import * as vscode from 'vscode'
import { ReportPanel, type ReportPanelDeps } from './reportPanel'
import { reportEngineLoader } from './reportEngineBundle'

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
