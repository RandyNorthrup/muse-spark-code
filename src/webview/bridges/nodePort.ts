import type * as z from 'zod/mini'
import { NODE_HTTP_BODY_BYTES, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import {
  nodeMethodErrorSchema,
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodPort,
  type NodeMethodResult,
} from '../../shared/hostApi/nodeMethods'
import { nodeTokenSchema } from '../../shared/nodeAuth'

/** A node refusal the page can name: the code, never a matched message. */
export type NodePageErrorCode = keyof UiText['nodeErrors']
export class NodePageError extends Error {
  constructor(
    readonly code: NodePageErrorCode,
    options?: { cause?: unknown },
  ) {
    super(UI_TEXT.nodeErrors[code], options)
  }
}
export function isNodePageError(error: unknown): error is NodePageError {
  return error instanceof NodePageError
}

type Catalog = {
  [M in NodeMethodName]: {
    params: z.ZodMiniType<NodeMethodParams<M>>
    result: z.ZodMiniType<NodeMethodResult<M>>
  }
}
const catalog: Catalog = nodeMethods

/** Frozen MHP binding: transport envelopes stay M104's responsibility. */
export function validatedNodePort(transport: {
  request(method: NodeMethodName, params: unknown, signal: AbortSignal): Promise<unknown>
}): NodeMethodPort {
  return {
    async request<M extends NodeMethodName>(
      method: M,
      params: NodeMethodParams<M>,
      signal: AbortSignal,
    ): Promise<NodeMethodResult<M>> {
      signal.throwIfAborted()
      const entry = catalog[method]
      let input: unknown
      try {
        input = entry.params.parse(params)
      } catch (error: unknown) {
        // Person-typed input (the path box) can fail validation: typed
        // `invalidRequest`, never the raw schema failure.
        throw new NodePageError('invalidRequest', { cause: error })
      }
      let result: unknown
      try {
        result = await transport.request(method, input, signal)
      } catch (error: unknown) {
        if (signal.aborted) throw error
        if (isNodePageError(error)) throw error
        // A transport can fail untyped (a network TypeError, a harness
        // shortcut): typed `unavailable` with the failure attached.
        throw new NodePageError('unavailable', { cause: error })
      }
      signal.throwIfAborted()
      try {
        return entry.result.parse(result)
      } catch (error: unknown) {
        // A response that fails validation is a server fault: typed
        // `unavailable` with the parse failure attached.
        throw new NodePageError('unavailable', { cause: error })
      }
    },
  }
}

/** N's captured local catalog route, not a guessed MHP envelope. A1 owns
the memory-only bearer; reload/sign-out clears that caller-owned state. */
export function nodeHttpsPort(options: {
  origin: string
  bearer(): string | undefined
  fetch: typeof fetch
}): NodeMethodPort {
  const origin = new URL(options.origin)
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== options.origin ||
    origin.username !== '' ||
    origin.password !== ''
  )
    throw new NodePageError('forbidden')
  return validatedNodePort({
    request: async (method, params, signal) => {
      const bearer = nodeTokenSchema.safeParse(options.bearer())
      if (!bearer.success) throw new NodePageError('unauthenticated')
      const body = JSON.stringify(params)
      if (new TextEncoder().encode(body).byteLength > NODE_HTTP_BODY_BYTES)
        throw new NodePageError('tooLarge')
      const response = await options.fetch(new URL(`/${method}`, origin), {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer.data}`, 'Content-Type': 'application/json' },
        body,
        signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        mode: 'same-origin',
      })
      if (
        !['application/json', 'application/json; charset=utf-8'].includes(
          response.headers.get('content-type') ?? '',
        )
      )
        throw new NodePageError('invalidRequest')
      const reader = response.body?.getReader()
      if (reader === undefined) throw new NodePageError('invalidRequest')
      const parts: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          signal.throwIfAborted()
          const part = await reader.read()
          if (part.done) break
          length += part.value.byteLength
          if (length > NODE_HTTP_BODY_BYTES) throw new NodePageError('tooLarge')
          parts.push(part.value)
        }
      } finally {
        await reader.cancel()
        reader.releaseLock()
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const part of parts) {
        bytes.set(part, offset)
        offset += part.length
      }
      const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (!response.ok) {
        const error = nodeMethodErrorSchema.safeParse(result)
        throw new NodePageError(error.success ? error.data.code : 'unavailable')
      }
      return result
    },
  })
}
