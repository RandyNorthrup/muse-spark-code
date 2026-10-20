// What's New's editor tab (M99, PLAN.md D79): one webview panel per window,
// rendered by whatsNewHtml.ts from dist/whatsNew.json and loaded only with
// the What's New bundle. Its script sends indexes; this side opens its own
// copy of a link through `vscode.env.openExternal`, runs a Try it from the
// page's own list (only those the renderer allowed: what the extension
// contributes), and writes the toggle to `museSpark.showWhatsNewOnUpdate`.

import { readFileSync } from 'node:fs'
import * as vscode from 'vscode'
import {
  parseWhatsNewContent,
  type ReleaseNotes,
  type TryIt,
  type WhatsNewContent,
} from '../../core/whatsNew/whatsNewContent'
import { failureForLog } from '../../core/backends/musecode/logText'
import { releasesToShow } from '../../core/whatsNew/whatsNewVersions'
import {
  UI_TEXT,
  VSCODE_COMMANDS,
  WHATS_NEW_SCRIPT_FILE,
  WHATS_NEW_STYLE_FILE,
  WHATS_NEW_VIEW_TYPE,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { parseWhatsNewMessage, type WhatsNewMessage } from '../../shared/whatsNewMessages'
import {
  resolveWebviewBundleDir,
  webviewBundleErrorHtml,
  WebviewBundleError,
} from '../views/webviewBundleRoot'
import { createNonce } from '../html'
import type { Logger } from '../logger'
import { renderWhatsNewPage } from './whatsNewHtml'

export interface WhatsNewPagesDeps {
  readonly extensionUri: vscode.Uri
  /** The machine's storage for the verified webview copy (VSIXWEB A). */
  readonly globalStoragePath: string
  /** dist/whatsNew.json beside the bundle. */
  readonly contentPath: string
  /** The running extension's version. */
  readonly current: string
  readonly isShownOnUpdate: () => boolean
  readonly setShownOnUpdate: (isShown: boolean) => PromiseLike<void>
  readonly log: Logger
  /** How the content file is read: the file system unless a test hands in the text. */
  readonly readContent?: ((file: string) => string) | undefined
}

export interface WhatsNewPages {
  /** What an update from `from` brings, newest first (the palette's set when undefined). */
  readonly releases: (from: string | undefined) => readonly ReleaseNotes[]
  /**
  Opens the tab, or brings the open one up to date. In the background
  (after an update) it keeps the keyboard where it is.
  */
  readonly open: (from: string | undefined, isBackground: boolean) => void
  readonly dispose: () => void
}

interface Shown {
  readonly panel: vscode.WebviewPanel
  tries: readonly TryIt[]
  links: readonly string[]
}

/** The window's What's New tab and the content it is made from, read once. */
export function createWhatsNewPagesFor(deps: WhatsNewPagesDeps): WhatsNewPages {
  const readContent = deps.readContent ?? ((file: string) => readFileSync(file, 'utf8'))
  let content: WhatsNewContent | undefined
  const contentNow = (): WhatsNewContent => {
    content ??= parseWhatsNewContent(readContent(deps.contentPath))
    return content
  }
  const releases = (from: string | undefined) =>
    releasesToShow(contentNow().releases, from, deps.current)
  // The verified webview copy (VSIXWEB A): a packaged install extracts it
  // once per archive digest into global storage, the source tree serves its
  // loose files. A missing, damaged or unwritable extraction shows the
  // fixed sentence, never unverified files.
  let bundleRoot: vscode.Uri | undefined
  try {
    bundleRoot = vscode.Uri.file(
      resolveWebviewBundleDir({
        extensionPath: deps.extensionUri.fsPath,
        globalStoragePath: deps.globalStoragePath,
      }),
    )
  } catch (error: unknown) {
    if (!(error instanceof WebviewBundleError)) throw error
    deps.log.error(`What’s New webview bundle failed: ${failureForLog(error)}`)
  }
  let shown: Shown | undefined

  const act = async (target: Shown, message: WhatsNewMessage): Promise<void> => {
    switch (message.type) {
      case 'openLink': {
        const url = target.links[message.index]
        if (url === undefined) {
          deps.log.warn(`What’s New: no link ${String(message.index)} on the page`)
          return
        }
        await vscode.env.openExternal(vscode.Uri.parse(url, true))
        return
      }
      case 'tryIt': {
        // The page's list holds only the Try its the renderer allowed.
        const entry = target.tries[message.index]
        if (entry === undefined) {
          deps.log.warn(`What’s New: no Try it ${String(message.index)} on the page`)
          return
        }
        await (entry.kind === 'command'
          ? vscode.commands.executeCommand(entry.id)
          : vscode.commands.executeCommand(VSCODE_COMMANDS.openSettings, entry.id))
        return
      }
      case 'hideOnUpdate': {
        await deps.setShownOnUpdate(!message.isHidden)
        return
      }
    }
  }

  const actLogged = async (target: Shown, message: WhatsNewMessage): Promise<void> => {
    try {
      await act(target, message)
    } catch (error: unknown) {
      deps.log.error(`What’s New: ${message.type} failed: ${failureForLog(error)}`)
    }
  }

  const render = (target: Shown, from: string | undefined): void => {
    const { webview } = target.panel
    if (bundleRoot === undefined) {
      webview.html = webviewBundleErrorHtml(UI_TEXT.webviewBundleUnavailable, uiLocale())
      return
    }
    const page = renderWhatsNewPage({
      releases: releases(from),
      from,
      current: deps.current,
      isShortened: contentNow().shortened === true,
      isShownOnUpdate: deps.isShownOnUpdate(),
      cspSource: webview.cspSource,
      nonce: createNonce(),
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WHATS_NEW_SCRIPT_FILE))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WHATS_NEW_STYLE_FILE))
        .toString(),
      locale: uiLocale(),
    })
    target.tries = page.tries
    target.links = page.links
    webview.html = page.html
  }

  const create = (isBackground: boolean): Shown => {
    const panel = vscode.window.createWebviewPanel(
      WHATS_NEW_VIEW_TYPE,
      UI_TEXT.whatsNewTitle,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: isBackground },
      {
        enableScripts: true,
        enableFindWidget: true,
        localResourceRoots: bundleRoot === undefined ? [] : [bundleRoot],
      },
    )
    const target: Shown = { panel, tries: [], links: [] }
    const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWhatsNewMessage(raw)
      if (message === undefined) {
        deps.log.warn('What’s New: dropped a malformed message from its page')
        return
      }
      void actLogged(target, message)
    })
    panel.onDidDispose(() => {
      subscription.dispose()
      if (shown === target) {
        shown = undefined
      }
    })
    return target
  }

  return {
    releases,
    open: (from, isBackground) => {
      // Read first: an unreadable content file throws before a tab opens.
      contentNow()
      const target = shown ?? create(isBackground)
      shown = target
      render(target, from)
      target.panel.reveal(undefined, isBackground)
    },
    dispose: () => {
      shown?.panel.dispose()
    },
  }
}
