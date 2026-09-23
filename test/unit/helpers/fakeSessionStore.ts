// An in-memory SessionStore for the Model API host tests: what was saved,
// by id, and a switch that makes the next save fail.

import type { SessionStore, StoredSession } from '../../../src/core/backends/modelapi/sessionStore'

export interface MemorySessionStore extends SessionStore {
  readonly saved: Map<string, StoredSession>
  failNextSave: boolean
}

export function memorySessionStore(): MemorySessionStore {
  const saved = new Map<string, StoredSession>()
  const store: MemorySessionStore = {
    saved,
    failNextSave: false,
    list: () => Promise.resolve(Array.from(saved.values(), (session) => structuredClone(session))),
    save(session) {
      if (store.failNextSave) {
        store.failNextSave = false
        return Promise.reject(new Error('disk full'))
      }
      saved.set(session.sessionId, structuredClone(session))
      return Promise.resolve()
    },
    remove(sessionId) {
      saved.delete(sessionId)
      return Promise.resolve()
    },
  }
  return store
}
