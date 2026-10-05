// Tab's completion engine (M94, PLAN.md D73): lane C's pure pieces composed
// for one window. The typing-through cache answers first; otherwise the
// scheduler debounces an Automatic trigger (Invoke goes at once), caps the
// open and per-minute requests, and the request body goes to the injected
// key-client stream. The suggestion is published as soon as the closing
// tag arrives, while the request runs on to its end so its usage settles
// the reservation (the probe: text at 2.9 s, usage at 15 s). A sent request
// is never aborted by the editor; only the provider-side timeout ends it,
// and then it reports no usage and its reservation stands (M82).
// Pure: no `vscode` import. The stream is the activation bundle's key
// client, handed across the bundle boundary (PLAN.md D6).

import { MODEL_API_MAX_RETRIES, TAB_REQUEST_TIMEOUT_MS } from '../../shared/constants'
import type { RetryBudget } from '../backends/modelapi/client'
import type { CreateResponseBody, StreamEvent, Usage } from '../backends/modelapi/schemas'
import { TabCache } from './tabCache'
import type { TabMode } from './tabContext'
import { extractCompletion, suggestFromReply } from './tabReply'
import { buildTabRequest } from './tabRequest'
import { TabScheduler } from './tabScheduler'

/** Tokens one request reported; a request never sent reports zero. */
export interface TabEngineUsage {
  readonly inputTokens: number
  readonly cachedTokens: number
  readonly outputTokens: number
}

/** One trigger: the redacted window and what the filters compare it with. */
export interface TabEngineRequest {
  readonly model: string
  readonly absolutePath: string
  /** Workspace-relative: the only file identity the model sees. */
  readonly relativePath: string
  readonly languageId: string
  /** The anchored window before the cursor, redacted. */
  readonly prefix: string
  /** The window after the cursor, redacted. */
  readonly suffix: string
  readonly mode: TabMode
  readonly isInvoke: boolean
  /** The cursor line's text before the cursor (whitespace normalization). */
  readonly cursorLineBefore: string
  /** The line above the cursor's line (`''` when none). */
  readonly lineAbove: string
  /** The lines below the cursor's line. */
  readonly linesBelow: readonly string[]
  /** Read when the debounce ends: a cancelled trigger sends nothing. */
  readonly isCancelled: () => boolean
}

export interface TabEngineAnswer {
  /** The filtered suggestion; undefined means none. */
  readonly completion: string | undefined
  /**
   * The request's reported usage, when it ends. Zero when nothing was sent
   * (a cache hit, or a trigger replaced or cancelled while it waited).
   * Rejects when a sent request ends without usage: its reservation stands.
   */
  readonly usage: Promise<TabEngineUsage>
}

/** The key client's stream, with the retry budget the engine hands it. */
export type TabStream = (
  body: CreateResponseBody,
  signal: AbortSignal,
  budget: RetryBudget,
) => AsyncIterable<StreamEvent>

export interface TabEngineDeps {
  readonly stream: TabStream
  /** A request is about to be sent (PaidUsage counts it). */
  readonly onSent: (model: string) => void
  /** A request reported its usage (PaidUsage prices it). */
  readonly onUsage: (model: string, usage: TabEngineUsage) => void
  readonly now?: () => number
}

export interface TabEngine {
  complete(request: TabEngineRequest): Promise<TabEngineAnswer>
}

const NOT_SENT: TabEngineUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }

function notSent(completion: string | undefined): TabEngineAnswer {
  return { completion, usage: Promise.resolve(NOT_SENT) }
}

function usageOf(usage: Usage | null | undefined): TabEngineUsage | undefined {
  if (usage === undefined || usage === null) {
    return undefined
  }
  return {
    inputTokens: usage.input_tokens,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens,
  }
}

/** A failure as an Error, whatever was thrown. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function createTabEngine(deps: TabEngineDeps): TabEngine {
  const cache = new TabCache()
  const scheduler = new TabScheduler(deps.now === undefined ? {} : { now: deps.now })
  // The trigger the scheduler holds unsent: a newer one replaces it there,
  // and this answers it with no suggestion and zero usage.
  let dropWaiting: (() => void) | undefined

  /** Sends one request; publishes at the closing tag, settles usage at the end. */
  async function send(
    request: TabEngineRequest,
    publishTo: (answer: TabEngineAnswer) => void,
    failTo: (error: Error) => void,
  ): Promise<void> {
    const body = buildTabRequest({
      model: request.model,
      path: request.relativePath,
      languageId: request.languageId,
      prefix: request.prefix,
      suffix: request.suffix,
      snippets: '',
      mode: request.mode,
    })
    const filter = {
      mode: request.mode,
      suffix: request.suffix,
      cursorLineBefore: request.cursorLineBefore,
      lineAbove: request.lineAbove,
      linesBelow: request.linesBelow,
      secretLiterals: [],
    }
    // Mutated from `publish` and the stream's events alike.
    const progress: {
      reply: string
      isPublished: boolean
      reported: TabEngineUsage | undefined
      failure: Error | undefined
    } = { reply: '', isPublished: false, reported: undefined, failure: undefined }
    // Assigned below, before any event can publish: the request's usage.
    let usage: Promise<TabEngineUsage> = Promise.resolve(NOT_SENT)
    const publish = (): void => {
      if (progress.isPublished) {
        return
      }
      progress.isPublished = true
      const suggestion = suggestFromReply(progress.reply, filter)
      const completion = 'completion' in suggestion ? suggestion.completion : undefined
      if (completion !== undefined) {
        cache.store(request.absolutePath, request.prefix, request.suffix, completion)
      }
      publishTo({ completion, usage })
    }
    /** One stream event; true ends the read. */
    const shouldStopAt = (event: StreamEvent): boolean => {
      switch (event.type) {
        case 'response.output_text.delta': {
          progress.reply += event.delta
          if (extractCompletion(progress.reply) !== undefined) {
            publish()
          }
          return false
        }
        case 'response.completed':
        case 'response.incomplete':
        case 'response.failed': {
          progress.reported = usageOf(event.response.usage) ?? progress.reported
          return false
        }
        case 'error': {
          progress.failure = new Error('The Tab stream reported an error')
          return true
        }
        default: {
          return false
        }
      }
    }
    /** Reads the stream to its end; resolves its usage, rejects without one. */
    const drain = async (): Promise<TabEngineUsage> => {
      // A backstop only (D73): the editor never aborts a sent request.
      const timeout = new AbortController()
      const timer = setTimeout(() => {
        timeout.abort()
      }, TAB_REQUEST_TIMEOUT_MS)
      try {
        // One HTTP attempt: the reservation prices one, so the client's
        // retries are spent before the first try (RVM94LC).
        const budget: RetryBudget = { retriesUsed: MODEL_API_MAX_RETRIES }
        for await (const event of deps.stream(body, timeout.signal, budget)) {
          if (shouldStopAt(event)) {
            break
          }
        }
      } catch (error: unknown) {
        progress.failure = asError(error)
      } finally {
        clearTimeout(timer)
      }
      if (!progress.isPublished) {
        if (progress.failure !== undefined && progress.reported === undefined) {
          throw progress.failure
        }
        // The whole reply: no complete tag pair means no suggestion.
        publish()
      }
      if (progress.reported === undefined) {
        throw new Error('The Tab request reported no usage')
      }
      deps.onUsage(request.model, progress.reported)
      return progress.reported
    }
    deps.onSent(request.model)
    usage = drain()
    try {
      await usage
    } catch (error: unknown) {
      // Published: the provider hears the missing usage through `usage`.
      // Not published: the trigger fails, and its reservation stands.
      if (!progress.isPublished) {
        failTo(asError(error))
      }
    }
  }

  return {
    complete: (request) => {
      const cached = cache.lookup(request.absolutePath, request.prefix, request.suffix)
      if (cached !== undefined) {
        // Typing through: the rest of an answered completion, no request.
        return Promise.resolve(notSent(cached === '' ? undefined : cached))
      }
      return new Promise<TabEngineAnswer>((resolve, reject) => {
        dropWaiting?.()
        const state = { isStarted: false }
        const drop = (): void => {
          if (state.isStarted) {
            return
          }
          state.isStarted = true
          resolve(notSent(undefined))
        }
        dropWaiting = drop
        scheduler.trigger(
          {
            token: {
              get cancelled(): boolean {
                const isCancelled = request.isCancelled()
                if (isCancelled) {
                  drop()
                }
                return isCancelled
              },
            },
            run: async () => {
              if (state.isStarted) {
                return
              }
              state.isStarted = true
              if (dropWaiting === drop) {
                dropWaiting = undefined
              }
              try {
                await send(request, resolve, reject)
              } catch (error: unknown) {
                reject(asError(error))
              }
            },
          },
          { immediate: request.isInvoke },
        )
      })
    },
  }
}
