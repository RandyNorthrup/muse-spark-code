import { vi } from 'vitest'
import type { ChatSurface } from '../../../src/host/views/chatSurface'
import type { HostToWebviewMessage } from '../../../src/shared/protocol'

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
