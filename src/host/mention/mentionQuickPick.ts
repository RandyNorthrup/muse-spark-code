// "Mention file from this project…": a QuickPick whose items are refreshed
// from the mention index as the user types. The QuickPick factory is injected
// so the flow is unit-tested with a fake; `vscode.window.createQuickPick`
// satisfies it directly.

import type * as vscode from 'vscode'
import type { MentionSearch } from '../conversation/conversationController'

export interface MentionPickItem extends vscode.QuickPickItem {
  readonly path: string
}

export type MentionQuickPick = Pick<
  vscode.QuickPick<MentionPickItem>,
  | 'items'
  | 'placeholder'
  | 'matchOnDescription'
  | 'value'
  | 'selectedItems'
  | 'onDidChangeValue'
  | 'onDidAccept'
  | 'onDidHide'
  | 'show'
  | 'hide'
  | 'dispose'
>

export interface MentionQuickPickDeps {
  readonly createQuickPick: () => MentionQuickPick
  readonly mentions: Pick<MentionSearch, 'search'>
  readonly limit: number
  readonly placeholder: string
}

function toItems(paths: readonly { path: string; isFolder: boolean }[]): MentionPickItem[] {
  return paths.map((entry) => ({ label: entry.path, path: entry.path }))
}

/** Resolves with the chosen relative path, or undefined when dismissed. */
export async function pickMentionFile(deps: MentionQuickPickDeps): Promise<string | undefined> {
  const picker = deps.createQuickPick()
  picker.placeholder = deps.placeholder
  // The index already fuzzy-ranked the rows; VS Code's own filter would hide
  // results whose match is spread across path segments.
  picker.matchOnDescription = false
  let latestQuery = ''
  const refresh = async (query: string) => {
    latestQuery = query
    const results = await deps.mentions.search(query, deps.limit)
    if (query === latestQuery) {
      picker.items = toItems(results)
    }
  }
  // Not `Promise.withResolvers`: VS Code 1.99 and 1.100 run Node 20 (PLAN.md M62).
  const settled = new Promise<string | undefined>((resolve) => {
    picker.onDidAccept(() => {
      resolve(picker.selectedItems[0]?.path)
      picker.hide()
    })
    picker.onDidHide(() => {
      resolve(undefined)
      picker.dispose()
    })
  })
  picker.onDidChangeValue((value) => {
    void refresh(value)
  })
  picker.show()
  await refresh('')
  return await settled
}
