// The single-choice quick pick behind the host's lists (M31's MCP servers and
// hooks, M49's memory): each row filtered by its label, description and
// detail, the pick answered with the chosen row's id.

import * as vscode from 'vscode'
import type { PickOne } from './commands/pickItem'

export const showPickOne: PickOne = async (items, title, placeholder) => {
  const choice = await vscode.window.showQuickPick(
    items.map((item) => ({ ...item })),
    { title, placeHolder: placeholder, matchOnDescription: true, matchOnDetail: true },
  )
  return choice?.id
}
