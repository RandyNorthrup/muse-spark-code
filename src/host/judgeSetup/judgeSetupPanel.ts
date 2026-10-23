// D107 (M125 lane W): the Set Up Local Judge panel's host side. One
// panel per window over a lazily loaded driver: the webview posts
// each validated command, the driver answers with snapshots, and a
// close disposes the panel after honouring the hosted leave. Beside
// it, the light setup readers the Settings section, the status item
// and the remove flow use without loading the driver.
import * as vscode from 'vscode'
import path from 'node:path'
import type { JudgeSetupPaths } from '../../core/judge/setup/ports'
import { wireWordForLog } from '../../core/logging'
import {
  COMMAND_IDS,
  JUDGE_SETUP_DRIVER_BUNDLE_FILE,
  JUDGE_SETUP_PANEL_VIEW_TYPE,
  JUDGE_SETUP_WEBVIEW_SCRIPT_FILE,
  JUDGE_SETUP_WEBVIEW_STYLE_FILE,
  UI_TEXT,
} from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { uiLocale } from '../../shared/l10n/text'
import type { JudgeSetupCommand, JudgeSetupSnapshot } from '../../shared/judgeSetupSchema'
import {
  parseJudgeSetupPanelToHost,
  type JudgeSetupHostToPanel,
} from '../../shared/judgeSetupPanel'
import { buildWebviewHtml, createNonce } from '../html'
import type { UiTable } from '../l10n'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { WebviewBundleResolution } from '../views/webviewBundle'
import type * as Driver from './judgeSetupDriver'
import type { JudgeSetupPanelPaths, JudgeSetupState } from './judgeSetupState'

function isDriver(value: unknown): value is typeof Driver {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createJudgeSetupDriver' in value &&
    typeof value.createJudgeSetupDriver === 'function'
  )
}

/** What the Models & Agents Judge section drives: read, open, change, remove. */
export interface JudgeSetupSectionPort {
  readonly read: () => JudgeSetupState
  readonly open: () => void
  readonly change: () => void
  /** True when an install was removed (the section refreshes from `read`). */
  readonly remove: () => Promise<boolean>
}

export interface JudgeSetupPanelDeps {
  readonly extensionUri: vscode.Uri
  /** The verified webview copy (VSIXWEB A), resolved in the activation bundle. */
  readonly resolveWebviewBundle: () => WebviewBundleResolution
  readonly l10n: UiTable
  readonly log: Logger
  readonly paths: JudgeSetupPanelPaths
  /** How the driver bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
  /** The window refreshes its setup state (section, status item) after a close. */
  readonly onClosed: (isDeferred: boolean) => void
  /** The person chose hosted instead: leave to the Judge settings. */
  readonly openHosted: () => Promise<void>
}

export interface JudgeSetupPanel {
  readonly reveal: () => void
  readonly dispose: () => void
}

const DEFER_COMMANDS: ReadonlySet<JudgeSetupCommand> = new Set([
  'setUpLater',
  'chooseSkip',
  'chooseHosted',
])

/**
Open the wizard, revealed if it already lives. `shouldAutoScan`
runs the scan on a fresh open so Change Model lands on the
recommendation; an already open wizard is only revealed, never
disturbed.
*/
export function openJudgeSetupPanel(
  deps: JudgeSetupPanelDeps,
  existing: JudgeSetupPanel | undefined,
  shouldAutoScan: boolean,
): JudgeSetupPanel | undefined {
  if (existing !== undefined) {
    existing.reveal()
    return existing
  }
  const text = UI_TEXT.judgeSetupWizard
  const load = lazyBundleLoader({
    bundlePath: path.join(deps.extensionUri.fsPath, 'dist', JUDGE_SETUP_DRIVER_BUNDLE_FILE),
    log: deps.log,
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    isBundle: isDriver,
    label: 'Judge setup driver',
    unavailable: () => text.unavailable,
  })
  let driver: Driver.JudgeSetupDriver
  try {
    const language: { uiText: UiText; uiLocale: string; paths: JudgeSetupPaths } = {
      uiText: deps.l10n.table,
      uiLocale: uiLocale(),
      paths: deps.paths,
    }
    driver = load().createJudgeSetupDriver(language)
  } catch {
    deps.log.warn('Judge setup driver unavailable; wizard stays closed')
    void vscode.window.showErrorMessage(text.unavailable)
    return undefined
  }
  const panel = vscode.window.createWebviewPanel(
    JUDGE_SETUP_PANEL_VIEW_TYPE,
    text.title,
    vscode.ViewColumn.One,
    { retainContextWhenHidden: true },
  )
  const resolved = deps.resolveWebviewBundle()
  if (!resolved.ok) {
    deps.log.error(`Judge setup webview bundle failed: ${resolved.detail}`)
    panel.webview.options = { enableScripts: true, localResourceRoots: [] }
    panel.webview.html = resolved.html
    return {
      reveal: () => {
        panel.reveal(vscode.ViewColumn.One)
      },
      dispose: () => {
        panel.dispose()
      },
    }
  }
  const root = vscode.Uri.file(resolved.dir)
  panel.webview.options = { enableScripts: true, localResourceRoots: [root] }
  panel.webview.html = buildWebviewHtml({
    scriptUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(root, JUDGE_SETUP_WEBVIEW_SCRIPT_FILE))
      .toString(),
    styleUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(root, JUDGE_SETUP_WEBVIEW_STYLE_FILE))
      .toString(),
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    l10n: deps.l10n,
  })
  let isDisposed = false
  let operations = Promise.resolve()
  let closingCommand: JudgeSetupCommand | undefined
  const post = (message: JudgeSetupHostToPanel): void => {
    if (isDisposed) return
    void panel.webview.postMessage(message)
  }
  const postSnapshot = (snapshot: JudgeSetupSnapshot): void => {
    post({ type: 'judgeSetup/snapshot', snapshot })
  }
  const close = (shouldOpenHosted: boolean): void => {
    post({ type: 'judgeSetup/closed' })
    if (shouldOpenHosted) {
      void deps.openHosted().catch(() => {
        deps.log.warn('Judge setup hosted leave failed')
      })
    }
    panel.dispose()
  }
  const enqueue = (run: () => Promise<void>): void => {
    const previous = operations
    const current = (async () => {
      await previous
      if (isDisposed) return
      try {
        await run()
      } catch (error: unknown) {
        if (!(error instanceof Error)) throw error
        deps.log.warn(`Judge setup message failed (${wireWordForLog(error.name)})`)
      }
    })()
    // The chain itself never rejects: the report owns every failure,
    // so a later command always runs after an earlier one.
    operations = (async () => {
      try {
        await current
      } catch {
        deps.log.warn('Judge setup message failed')
      }
    })()
  }
  const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
    const parsed = parseJudgeSetupPanelToHost(raw)
    if (!parsed.ok) {
      deps.log.warn('Dropped malformed judge setup message')
      return
    }
    const message = parsed.message
    if (message.type === 'judgeSetup/openExternal') {
      enqueue(async () => {
        const url = new URL(message.url)
        if (
          (url.protocol !== 'https:' && url.protocol !== 'http:') ||
          url.username !== '' ||
          url.password !== ''
        ) {
          throw new Error(UI_TEXT.actionFailed)
        }
        await vscode.env.openExternal(vscode.Uri.parse(url.href))
      })
      return
    }
    if (message.type === 'judgeSetup/ready') {
      enqueue(async () => {
        postSnapshot(driver.current())
        if (!shouldAutoScan) return
        const directive = await driver.command({ command: 'startScan' }, postSnapshot)
        if (directive.to === 'close') close(directive.openHosted)
        else postSnapshot(directive.snapshot)
      })
      return
    }
    enqueue(async () => {
      const action = message.message.command
      const directive = await driver.command(message.message, postSnapshot)
      if (directive.to === 'close') {
        closingCommand = action
        close(directive.openHosted)
      } else {
        postSnapshot(directive.snapshot)
      }
    })
  })
  panel.onDidDispose(() => {
    isDisposed = true
    subscription.dispose()
    driver.abort()
    deps.onClosed(closingCommand !== undefined && DEFER_COMMANDS.has(closingCommand))
  })
  return {
    reveal: () => {
      panel.reveal(vscode.ViewColumn.One)
    },
    dispose: () => {
      panel.dispose()
    },
  }
}

export interface JudgeSetupStatusDeps {
  readonly readState: () => JudgeSetupState
  readonly isDeferred: () => boolean
}

/**
The status item: the wizard's entry while no local judge is
installed and the person has not deferred it. The window refreshes
it after every wizard close, install and removal.
*/
export function createJudgeSetupStatusItem(deps: JudgeSetupStatusDeps): {
  readonly item: vscode.StatusBarItem
  readonly refresh: () => void
} {
  const text = UI_TEXT.judgeSetupWizard
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
  item.text = `$(sparkle) ${text.statusText}`
  item.tooltip = text.statusTooltip
  item.command = COMMAND_IDS.setUpLocalJudge
  const refresh = (): void => {
    if (deps.readState().isInstalled || deps.isDeferred()) item.hide()
    else item.show()
  }
  refresh()
  return { item, refresh }
}
