// Single-overload views of the `vscode` mock's window functions (M30–M32).
// `vi.mocked` on an overloaded function types the fake against its last
// overload; assigning the mock to one of its own signatures is checked by
// the compiler and gives `vi.mocked` the signature the code under test
// actually calls. Each view is the same mock function.

import type * as vscode from 'vscode'
import { window } from 'vscode'

type PickManyView = (
  items: readonly vscode.QuickPickItem[],
  options: vscode.QuickPickOptions & { canPickMany: true },
) => Thenable<vscode.QuickPickItem[] | undefined>
type PickOneView = (
  items: readonly vscode.QuickPickItem[],
  options?: vscode.QuickPickOptions,
) => Thenable<vscode.QuickPickItem | undefined>
type InformView = (message: string, ...items: string[]) => Thenable<string | undefined>
type ConfirmView = (
  message: string,
  options: vscode.MessageOptions,
  ...items: string[]
) => Thenable<string | undefined>

export const pickMany: PickManyView = window.showQuickPick
export const pickOne: PickOneView = window.showQuickPick
export const inform: InformView = window.showInformationMessage
export const confirmModal: ConfirmView = window.showWarningMessage
