import type { ReportingContext } from '../../runtime/reporting/engine'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
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
  let engine: ReturnType<ReturnType<typeof loadEngine>['createReportingEngine']> | undefined
  return createReportPanel(
    {
      ...deps,
      workspaceKey,
      engine: () =>
        (engine ??= loadEngine().createReportingEngine({
          ...deps,
          workspaceKey,
          l10n: deps.context.l10n,
          generatorVersion: deps.generatorVersion,
          keepHistory: readSettings(
            vscode.workspace.getConfiguration('museSpark'),
            deps.context.log,
          )['reports.keepHistory'],
          enabledAgents: readSettings(
            vscode.workspace.getConfiguration('museSpark'),
            deps.context.log,
          )['reports.agentSources'],
        })),
      now: () => new Date().toISOString(),
      theme: () => {
        switch (vscode.window.activeColorTheme.kind) {
          case vscode.ColorThemeKind.Dark: {
            return {
              background: '#1f1f1f',
              foreground: '#cccccc',
              muted: '#a6a6a6',
              border: '#848484',
              accent: '#4daafc',
            }
          }
          case vscode.ColorThemeKind.HighContrast: {
            return {
              background: '#000000',
              foreground: '#ffffff',
              muted: '#ffffff',
              border: '#ffffff',
              accent: '#ffff00',
            }
          }
          case vscode.ColorThemeKind.HighContrastLight: {
            return {
              background: '#ffffff',
              foreground: '#000000',
              muted: '#000000',
              border: '#000000',
              accent: '#000080',
            }
          }
          default: {
            return {
              background: '#ffffff',
              foreground: '#1f1f1f',
              muted: '#404040',
              border: '#707070',
              accent: '#005fb8',
            }
          }
        }
      },
    },
    table,
    locale,
  )
}
