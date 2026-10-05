// An exclusive loopback listener serializes OS-store grant mutations across
// processes. The OS releases it on exit, including a crash: no stale lease
// can authorize a second refresh. Port contention fails closed at the deadline.
import { createServer, type Server } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHATGPT_REFRESH_LOCK_PORT,
  CHATGPT_REFRESH_LOCK_RETRY_MS,
  OAUTH_CODE_TTL_MS,
  OAUTH_LOOPBACK_HOST,
} from '../shared/constants'
import { ChatGptSignInError } from '../core/providers/subscriptions/chatgpt'

export interface ChatGptLockOptions {
  readonly port?: number
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

async function listen(port: number): Promise<Server | undefined> {
  const server = createServer((socket) => socket.destroy())
  return await new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      server.close()
      if (error.code === 'EADDRINUSE') resolve(undefined)
      else reject(new ChatGptSignInError('request-failed'))
    })
    server.listen({ port, host: OAUTH_LOOPBACK_HOST, exclusive: true }, () => {
      resolve(server)
    })
  })
}

/** One machine-wide grant lock; no token, identity, file or child is involved. */
export async function withChatGptRefreshLock<T>(
  work: () => Promise<T>,
  options: ChatGptLockOptions = {},
): Promise<T> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? OAUTH_CODE_TTL_MS)
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([deadline, options.signal])
  try {
    for (;;) {
      signal.throwIfAborted()
      const server = await listen(options.port ?? CHATGPT_REFRESH_LOCK_PORT)
      if (server !== undefined) {
        try {
          signal.throwIfAborted()
          return await work()
        } finally {
          await new Promise<void>((resolve) =>
            server.close(() => {
              resolve()
            }),
          )
        }
      }
      await delay(CHATGPT_REFRESH_LOCK_RETRY_MS, undefined, { signal })
    }
  } catch (error) {
    if (error instanceof ChatGptSignInError) throw error
    throw new ChatGptSignInError('request-failed')
  }
}
