// The paid-use modal's buttons in tests (M58): shared by the workspace and
// account consent suites, which answer the same VS Code popup.
import { vi } from 'vitest'
import type * as vscode from 'vscode'
import { confirmModal } from './vscodeViews'

/** A modal item's label: a plain string, or a `MessageItem`'s title. */
export function titleOf(item: unknown): string {
  return typeof item === 'string' ? item : (item as vscode.MessageItem).title
}

/** Answers the next modal with the button titled `title`, or closes it. */
export function answerWith(title: string | undefined): void {
  vi.mocked(confirmModal).mockImplementationOnce((_message, _options, ...items: unknown[]) =>
    Promise.resolve(items.find((item) => titleOf(item) === title) as never),
  )
}
