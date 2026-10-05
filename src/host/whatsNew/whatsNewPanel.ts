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
import { releasesToShow } from '../../core/whatsNew/whatsNewVersions'
import {
  UI_TEXT,
  VSCODE_COMMANDS,
  WEBVIEW_DIST_SEGMENTS,
  WHATS_NEW_SCRIPT_FILE,
  WHATS_NEW_STYLE_FILE,
  WHATS_NEW_VIEW_TYPE,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { parseWhatsNewMessage, type WhatsNewMessage } from '../../shared/whatsNewMessages'
import { createNonce } from '../html'
import type { Logger } from '../logger'
import { renderWhatsNewPage } from './whatsNewHtml'

export interface WhatsNewPagesDeps {
  readonly extensionUri: vscode.Uri
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
   * Opens the tab, or brings the open one up to date. In the background
   * (after an update) it keeps the keyboard where it is.
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
  const bundleRoot = vscode.Uri.joinPath(deps.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
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
      deps.log.error(
        `What’s New: ${message.type} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const render = (target: Shown, from: string | undefined): void => {
    const { webview } = target.panel
    const page = renderWhatsNewPage({
      releases: releases(from),
      from,
      current: deps.current,
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
      { enableScripts: true, enableFindWidget: true, localResourceRoots: [bundleRoot] },
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
