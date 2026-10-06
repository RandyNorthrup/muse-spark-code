// Usage is a handler and page on M104 C's server; it owns no second listener.
import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { startCompanionServer, type CompanionAsset } from '../companion/server'
import { usageCompanionEventSchema, usageCompanionRequestSchema } from '../../shared/usageCompanion'
import type { UsageCompanionEvent } from '../../shared/usageCompanion'
import type { UsageAccess, UsagePageConnection } from './usageAdapter'
import type { UsageServiceToPageMessage } from '../../shared/usagePage'
import { USAGE_TEXT, loadUsageTable, setUsageText } from '../../shared/l10n/usageTable'
import { plural, setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import type { CoreLogger } from '../../core/logging'
import {
  USAGE_COMPANION_IDLE_MS,
  USAGE_RECORD_MAX_BYTES,
  USAGE_COMPANION_EVENT_BYTES,
  USAGE_COMPANION_REQUEST_MS,
  USAGE_COMPANION_MAX_WINDOWS,
  USAGE_STALE_MS,
} from '../../shared/constants'

interface WindowConnection {
  readonly connection: UsagePageConnection
  readonly emit: (message: UsageCompanionEvent) => void
  replies: UsageServiceToPageMessage[]
  download?: { name: string; mimeType: 'text/csv' | 'application/json'; content: string }
  queue: Promise<void>
}
function unsupported(): never {
  throw new Error(USAGE_TEXT.unsupported)
}
function emitReply(current: WindowConnection, id: string): void {
  current.emit({
    type: 'reply',
    id,
    messages: current.replies,
    ...(current.download !== undefined && { download: current.download }),
  })
}
export async function openUsageCompanion(deps: {
  readonly usage: UsageAccess
  readonly assetsFolder: string
  readonly locale: string
  readonly uiText: UiText
  readonly log: CoreLogger
}) {
  setUiText(deps.uiText, deps.locale)
  const table = await loadUsageTable({
    language: deps.locale,
    readTableFile: (segments) =>
      readFile(path.join(deps.assetsFolder, '..', '..', ...segments), 'utf8'),
    warn: (message) => {
      deps.log.warn(message)
    },
  })
  setUsageText(table.table)
  const embeddedTable = JSON.stringify({ type: 'usage/table', ...table }).replaceAll(
    '<',
    String.raw`\u003c`,
  )
  const assets = new Map<string, CompanionAsset>()
  const root = await realpath(deps.assetsFolder)
  for (const name of ['usage.js', 'usage.css']) {
    const source = path.join(root, name)
    if ((await realpath(source)) !== source) throw new Error('EPANEL_ASSET')
    assets.set(`/${name}`, {
      content: await readFile(source),
      contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript',
    })
  }
  const connections = new Map<string, WindowConnection>()
  const approvals = new Map<
    string,
    { session: string; count: number; resolve(isApproved: boolean): void }
  >()
  return await startCompanionServer({
    limits: {
      maxBodyBytes: USAGE_RECORD_MAX_BYTES,
      maxEventBytes: USAGE_COMPANION_EVENT_BYTES,
      requestTimeoutMs: USAGE_COMPANION_REQUEST_MS,
      idleTimeoutMs: USAGE_COMPANION_IDLE_MS,
      launchCodeTtlMs: USAGE_STALE_MS,
      sessionTtlMs: USAGE_COMPANION_IDLE_MS,
      maxSessions: USAGE_COMPANION_MAX_WINDOWS,
    },
    assets,
    renderPage: (nonce) =>
      `<!doctype html><html lang="${table.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/usage.css"><script nonce="${nonce}" id="muse-usage-l10n" type="application/json">${embeddedTable}</script></head><body data-host-bridge="http"><div id="root"></div><script nonce="${nonce}" src="/usage.js"></script></body></html>`,
    handler: {
      inputSchema: usageCompanionRequestSchema,
      outputSchema: usageCompanionEventSchema,
      subscribe: (session, emit) => {
        const state: WindowConnection = {
          emit,
          replies: [],
          queue: Promise.resolve(),
          connection: deps.usage.connect({
            post: (message) => {
              connections.get(session)?.replies.push(message)
            },
            saveFile: (content, format) => {
              const current = connections.get(session)
              if (current === undefined) return Promise.resolve(false)
              current.download = {
                name: `usage.${format}`,
                mimeType: format === 'json' ? 'application/json' : 'text/csv',
                content,
              }
              return Promise.resolve(true)
            },
            confirmDelete: (count) =>
              new Promise<boolean>((resolve) => {
                const id = randomUUID()
                approvals.set(id, { session, count, resolve })
                emit({
                  type: 'confirm',
                  id,
                  count,
                  detail: plural(USAGE_TEXT.deleteConfirm, count),
                })
              }),
            openSettings: unsupported,
            revealFolder: unsupported,
            openModels: unsupported,
            openExternal: unsupported,
            setHistory: deps.usage.setHistory ?? unsupported,
          }),
        }
        connections.set(session, state)
        return () => {
          state.connection.dispose()
          connections.delete(session)
          for (const [id, approval] of approvals)
            if (approval.session === session) {
              approval.resolve(false)
              approvals.delete(id)
            }
        }
      },
      post: async (request, session, signal) => {
        if (request.type === 'confirm') {
          const approval = approvals.get(request.id)
          if (approval?.session !== session || approval.count !== request.count)
            throw new Error('EPANEL_CONFIRM')
          approvals.delete(request.id)
          approval.resolve(request.approved)
          return
        }
        const current = connections.get(session)
        if (current === undefined) throw new Error('EPANEL_STREAM')
        const previous = current.queue
        const next = (async () => {
          await previous
          signal.throwIfAborted()
          current.replies = []
          delete current.download
          const abort = () => {
            for (const [id, approval] of approvals)
              if (approval.session === session) {
                approval.resolve(false)
                approvals.delete(id)
              }
          }
          signal.addEventListener('abort', abort, { once: true })
          try {
            await current.connection.receive(request.message)
            signal.throwIfAborted()
            emitReply(current, request.id)
          } finally {
            signal.removeEventListener('abort', abort)
          }
        })()
        current.queue = (async () => {
          try {
            await next
          } catch {
            /* The request reports its error; later requests may still run. */
          }
        })()
        await next
      },
    },
  })
}
