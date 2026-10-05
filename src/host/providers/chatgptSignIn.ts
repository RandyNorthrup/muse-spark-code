// VS Code ports for the shared subscription core. The global-storage files
// contain only an opaque installation id and an exclusive lock, never tokens.
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import * as vscode from 'vscode'
import {
  HTTP_STATUS,
  MILLISECONDS_PER_SECOND,
  OAUTH_CODE_TTL_MS,
  OAUTH_LOOPBACK_HOST,
  PKCE_STATE_BYTES,
  PROVIDER_SECRET_PREFIX,
  UI_TEXT,
} from '../../shared/constants'
import { isPkceState, pkceRandom } from '../../core/providers/pkce'
import {
  ChatGptSignIn,
  ChatGptSignInError,
  parseChatGptCallback,
  type ChatGptHostPort,
} from '../../core/providers/subscriptions/chatgpt'
import type { RecordStore } from './credentialRecords'

type ChatGptCallback = Awaited<ReturnType<ChatGptHostPort['startCallback']>> & {
  readonly bindHost: string
}

/** Bound before the browser opens; the promise also retains an early callback. */
export async function startChatGptCallback(
  state: string,
  timeoutMs: number,
): Promise<ChatGptCallback> {
  const server = createServer()
  const completion: { resolve?: (url: string) => void; reject?: (error: Error) => void } = {}
  const waiting = new Promise<string>((resolve, reject) => {
    completion.resolve = resolve
    completion.reject = reject
  })
  void waiting.catch(() => null)
  let isSettled = false
  const finish = (value: string | Error): void => {
    if (isSettled) return
    isSettled = true
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
    if (typeof value === 'string') completion.resolve?.(value)
    else completion.reject?.(value)
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, OAUTH_LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new ChatGptSignInError('invalid-callback')
  }
  let isClaimed = false
  const redirectUri = `http://${OAUTH_LOOPBACK_HOST}:${String(address.port)}/auth/callback`
  server.on('error', () => {
    finish(new ChatGptSignInError('invalid-callback'))
  })
  server.on('request', (request, response) => {
    const answer = (status: number): void => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(UI_TEXT.oauthCallbackDone)
    }
    if (request.method !== 'GET') {
      answer(HTTP_STATUS.methodNotAllowed)
      return
    }
    if (isClaimed || isSettled) {
      answer(HTTP_STATUS.badRequest)
      return
    }
    try {
      const url = new URL(request.url ?? '/', redirectUri)
      if (url.pathname !== '/auth/callback') {
        answer(HTTP_STATUS.notFound)
        return
      }
      parseChatGptCallback(url.href, redirectUri, state)
      isClaimed = true
      // Let the response finish before forcibly closing idle sockets.
      response.on('finish', () => {
        finish(url.href)
      })
      answer(HTTP_STATUS.ok)
    } catch {
      isClaimed = true
      response.on('finish', () => {
        finish(new ChatGptSignInError('invalid-callback'))
      })
      answer(HTTP_STATUS.badRequest)
    }
  })
  const timer = setTimeout(() => {
    finish(new ChatGptSignInError('invalid-callback'))
  }, timeoutMs)
  timer.unref()
  return {
    bindHost: address.address,
    redirectUri,
    waitForCallback: () => waiting,
    close: () => {
      finish(new ChatGptSignInError('invalid-callback'))
    },
  }
}

/** Atomic exclusive creation works across extension-host processes/windows. */
async function withFileLock<T>(
  directory: string,
  timeoutMs: number,
  pollMs: number,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true })
  const lockPath = path.join(directory, 'chatgpt.refresh.lock')
  const deadline = Date.now() + timeoutMs
  let handle
  while (handle === undefined) {
    try {
      handle = await open(lockPath, 'wx')
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
      // Never steal a lock on age: a slow browser flow or refresh still owns it.
      if (Date.now() >= deadline) throw new ChatGptSignInError('request-failed')
      await pause(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    }
  }
  try {
    return await work()
  } finally {
    await handle.close()
    await unlink(lockPath)
  }
}

export interface ChatGptVsCodeDeps {
  readonly secrets: RecordStore
  readonly globalStorageUri: vscode.Uri
  /** Captured remote forwarding is not available; remote sign-in refuses. */
  readonly isRemote: boolean
  readonly fetch: typeof fetch
  readonly openExternal?: (uri: vscode.Uri) => Thenable<boolean>
  readonly lockTimeoutMs?: number
  readonly lockPollMs?: number
}

/** W composes this factory into the lazy Models panel; X implements the same core port. */
export async function createChatGptSignIn(deps: ChatGptVsCodeDeps): Promise<ChatGptSignIn> {
  try {
    const directory = deps.globalStorageUri.fsPath
    const withRefreshLock: ChatGptHostPort['withRefreshLock'] = (work) =>
      withFileLock(
        directory,
        deps.lockTimeoutMs ?? OAUTH_CODE_TTL_MS,
        deps.lockPollMs ?? MILLISECONDS_PER_SECOND,
        work,
      )
    const hostId = await withRefreshLock(async () => {
      const hostIdPath = path.join(directory, 'chatgpt.host-id')
      try {
        const stored = await readFile(hostIdPath, 'utf8')
        if (!isPkceState(stored)) throw new ChatGptSignInError('invalid-token')
        return stored
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      const id = pkceRandom(PKCE_STATE_BYTES)
      await writeFile(hostIdPath, id, { flag: 'wx' })
      return id
    })
    const key = `${PROVIDER_SECRET_PREFIX}chatgpt`
    return new ChatGptSignIn({
      hostId,
      fetch: deps.fetch,
      now: Date.now,
      withRefreshLock,
      openBrowser: async (url) => {
        const isOpened = await (deps.openExternal ?? vscode.env.openExternal)(vscode.Uri.parse(url))
        if (!isOpened) throw new ChatGptSignInError('request-failed')
      },
      startCallback: async (state, timeoutMs) => {
        if (deps.isRemote) throw new ChatGptSignInError('invalid-callback')
        return await startChatGptCallback(state, timeoutMs)
      },
      readRecord: async () => {
        const stored = await deps.secrets.get(key)
        if (stored === undefined) return
        const parsed: unknown = JSON.parse(stored)
        return parsed
      },
      writeRecord: async (record) => {
        await deps.secrets.store(key, JSON.stringify(record))
      },
      deleteRecord: async () => {
        await deps.secrets.delete(key)
      },
    })
  } catch {
    throw new ChatGptSignInError('request-failed')
  }
}
