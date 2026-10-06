import type * as z from 'zod/mini'
import { NODE_HTTP_BODY_BYTES, UI_TEXT } from '../../shared/constants'
import {
  nodeMethodErrorSchema,
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodPort,
  type NodeMethodResult,
} from '../../shared/hostApi/nodeMethods'
import { nodeTokenSchema } from '../../shared/nodeAuth'

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
      const input = entry.params.parse(params)
      const result = await transport.request(method, input, signal)
      signal.throwIfAborted()
      return entry.result.parse(result)
    },
  }
}

/** N's captured local catalog route, not a guessed MHP envelope. A1 owns
 * the memory-only bearer; reload/sign-out clears that caller-owned state. */
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
    throw new Error(UI_TEXT.nodeErrors.forbidden)
  return validatedNodePort({
    request: async (method, params, signal) => {
      const bearer = nodeTokenSchema.safeParse(options.bearer())
      if (!bearer.success) throw new Error(UI_TEXT.nodeErrors.unauthenticated)
      const body = JSON.stringify(params)
      if (new TextEncoder().encode(body).byteLength > NODE_HTTP_BODY_BYTES)
        throw new Error(UI_TEXT.nodeErrors.tooLarge)
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
        throw new Error(UI_TEXT.nodeErrors.invalidRequest)
      const reader = response.body?.getReader()
      if (reader === undefined) throw new Error(UI_TEXT.nodeErrors.invalidRequest)
      const parts: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          signal.throwIfAborted()
          const part = await reader.read()
          if (part.done) break
          length += part.value.byteLength
          if (length > NODE_HTTP_BODY_BYTES) throw new Error(UI_TEXT.nodeErrors.tooLarge)
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
        throw new Error(
          error.success ? UI_TEXT.nodeErrors[error.data.code] : UI_TEXT.nodeErrors.unavailable,
        )
      }
      return result
    },
  })
}
