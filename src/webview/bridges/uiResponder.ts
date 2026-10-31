import { MHP, MHP_ERROR_CODES } from '../../shared/constants'
import { fallbackUiCallSchema, fallbackUiReplySchema } from '../../shared/hostApi/fallbackUi'
import { MHP_METHODS } from '../../shared/hostApi/methods'
import { parseMhpResult } from '../../shared/hostApi/protocol'
import type * as Fallbacks from '../fallbacks'

/** Native hosts can invoke this same responder with their existing correlated MHP call. */
export function createUiResponder(
  ui: ReturnType<typeof Fallbacks.createFallbackUi>,
  onError: (error: unknown) => void,
) {
  const calls = new Map<string | number, AbortController>()
  return {
    async receive(value: unknown): Promise<unknown> {
      const frame = fallbackUiCallSchema.parse(value)
      if (frame.method === '$/cancelRequest') {
        calls.get(frame.params.id)?.abort()
        return undefined
      }
      if (calls.has(frame.id)) throw new Error('MHP_UI_DUPLICATE_REQUEST')
      const signal = new AbortController()
      calls.set(frame.id, signal)
      try {
        const params = MHP_METHODS[frame.method].params.parse(frame.params)
        const result = await ui.request(frame.method, params, signal.signal)
        return fallbackUiReplySchema.parse(
          parseMhpResult(frame.method, { jsonrpc: MHP.jsonRpcVersion, id: frame.id, result }),
        )
      } catch (error: unknown) {
        if (!signal.signal.aborted) onError(error)
        return fallbackUiReplySchema.parse({
          jsonrpc: MHP.jsonRpcVersion,
          id: frame.id,
          error: {
            code: signal.signal.aborted
              ? MHP_ERROR_CODES.cancelled
              : MHP_ERROR_CODES.unsupportedCapability,
            message: 'MHP_UI_FAILED',
          },
        })
      } finally {
        calls.delete(frame.id)
      }
    },
    dispose() {
      for (const call of calls.values()) call.abort()
      calls.clear()
      ui.dispose()
    },
  }
}
