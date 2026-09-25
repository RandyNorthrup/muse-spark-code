// The warning and error popups the commands show (M39). Each goes to the log
// as well, so "Open log" and a support report hold what the user was told.

import * as vscode from 'vscode'
import type { Logger } from './logger'

const SHOWN_PREFIX = 'Shown to the user: '

export interface LoggedPopups {
  readonly showWarning: (message: string) => void
  readonly showError: (message: string) => void
}

export function loggedPopups(log: Logger): LoggedPopups {
  return {
    showWarning: (message) => {
      log.warn(`${SHOWN_PREFIX}${message}`)
      void vscode.window.showWarningMessage(message)
    },
    showError: (message) => {
      log.error(`${SHOWN_PREFIX}${message}`)
      void vscode.window.showErrorMessage(message)
    },
  }
}
