// Logging adapter over VS Code's LogOutputChannel that redacts secrets before
// anything is written. Every host module logs through this interface, never
// through the channel or `console` directly.

import type * as vscode from 'vscode'
import { redactSecrets } from '../core/redact'

export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export function createLogger(channel: vscode.LogOutputChannel): Logger {
  return {
    info(message) {
      channel.info(redactSecrets(message))
    },
    warn(message) {
      channel.warn(redactSecrets(message))
    },
    error(message) {
      channel.error(redactSecrets(message))
    },
  }
}
