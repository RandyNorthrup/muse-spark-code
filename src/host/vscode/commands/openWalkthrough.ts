// Hosts without VS Code's walkthrough contribution point get a local,
// script-free page with the same sign-in routes, shortcuts and actions.
import * as vscode from 'vscode'
import {
  COMMAND_IDS,
  ACP_AGENT_TITLE,
  UI_TEXT,
  VSCODE_COMMANDS,
  WALKTHROUGH_QUALIFIED_ID,
} from '../../../shared/constants'
import { uiLocale } from '../../../shared/l10n/text'

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}
const HTML_UNSAFE = /[&<>"]/g

function escape(text: string): string {
  return text.replaceAll(HTML_UNSAFE, (character) => HTML_ESCAPES[character] ?? character)
}

export async function openWalkthrough(): Promise<vscode.WebviewPanel | undefined> {
  const commands = await vscode.commands.getCommands(true)
  if (commands.includes(VSCODE_COMMANDS.openWalkthrough)) {
    await vscode.commands.executeCommand(
      VSCODE_COMMANDS.openWalkthrough,
      WALKTHROUGH_QUALIFIED_ID,
      false,
    )
    return undefined
  }
  const title = `${ACP_AGENT_TITLE}: ${UI_TEXT.onboardingTitle}`
  const panel = vscode.window.createWebviewPanel(
    WALKTHROUGH_QUALIFIED_ID,
    title,
    vscode.ViewColumn.Active,
    {
      enableCommandUris: [COMMAND_IDS.openInNewTab, COMMAND_IDS.createRulesFile],
    },
  )
  const tips = Object.entries(UI_TEXT.onboardingShortcuts)
    .map(([key, shortcut]) => {
      const tip: unknown = Reflect.get(UI_TEXT.onboardingTips, key)
      return typeof tip === 'string'
        ? `<li><kbd>${escape(shortcut)}</kbd>: ${escape(tip)}</li>`
        : ''
    })
    .join('')
  panel.webview.html = `<!doctype html>
<html lang="${escape(uiLocale())}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<title>${escape(title)}</title></head><body><main>
<h1>${escape(title)}</h1>
<p><a href="command:${COMMAND_IDS.openInNewTab}">${escape(UI_TEXT.onboardingTips.newTab)}</a></p>
<h2>${escape(UI_TEXT.signInTitle)}</h2>
<h3>${escape(UI_TEXT.signInBrowser)}</h3><p>${escape(UI_TEXT.signInBrowserDetail)}</p>
<h3>${escape(UI_TEXT.signInApiKey)}</h3><p>${escape(UI_TEXT.signInApiKeyDetail)}</p>
<ul>${tips}</ul>
<p><a href="command:${COMMAND_IDS.createRulesFile}">AGENTS.md</a></p>
</main></body></html>`
  return panel
}
