// Complete fakes for the VS Code interfaces src/host consumes. Complete means
// every member of the real interface is implemented, so no cast is needed and
// the compiler reports when the API changes.

import type * as vscode from 'vscode'
import { vi } from 'vitest'
import type { HostToWebviewMessage } from '../../../src/shared/protocol'
import type { ChatSurface } from '../../../src/host/views/chatSurface'
import { EventEmitter } from '../mocks/vscode'

export class FakeLogOutputChannel implements vscode.LogOutputChannel {
  public readonly name = 'fake'
  public logLevel = 0 as vscode.LogLevel
  public readonly logLevelChanges = new EventEmitter<vscode.LogLevel>()
  public readonly onDidChangeLogLevel = this.logLevelChanges.event
  public readonly trace = vi.fn()
  public readonly debug = vi.fn()
  public readonly info = vi.fn()
  public readonly warn = vi.fn()
  public readonly error = vi.fn()
  public readonly append = vi.fn()
  public readonly appendLine = vi.fn()
  public readonly replace = vi.fn()
  public readonly clear = vi.fn()
  public readonly show = vi.fn()
  public readonly hide = vi.fn()
  public readonly dispose = vi.fn()
}

export interface FakeSurface extends ChatSurface {
  readonly posted: HostToWebviewMessage[]
  readonly reveal: ReturnType<typeof vi.fn<() => void>>
  readonly markUnread: ReturnType<typeof vi.fn<() => void>>
  readonly setTitle: ReturnType<typeof vi.fn<(title: string) => void>>
  readonly reload: ReturnType<typeof vi.fn<() => void>>
  readonly takeRestoredSessionId: ReturnType<typeof vi.fn<() => string | undefined>>
}

export function fakeSurface(id: string, isSideChat = false): FakeSurface {
  const posted: HostToWebviewMessage[] = []
  return {
    id,
    isSideChat,
    documentId: `${id}-document`,
    posted,
    post(message) {
      posted.push(message)
    },
    reveal: vi.fn<() => void>(),
    markUnread: vi.fn<() => void>(),
    setTitle: vi.fn<(title: string) => void>(),
    reload: vi.fn<() => void>(),
    takeRestoredSessionId: vi.fn<() => string | undefined>(),
    dispose() {
      // nothing to release in the fake
    },
  }
}
