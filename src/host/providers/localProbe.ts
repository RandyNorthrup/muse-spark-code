// Scan this computer (M95 lane K, PLAN.md D74): probes the local servers'
// default loopback ports and reports what answered, so the panel prefills
// it. Plain HTTP, but loopback only (D74's transport rule): the targets come
// from the presets, and the fetch runs with a short timeout per port. The
// fetch itself is injected (VS Code's patched fetch, or `node:http`
// directly where that would proxy loopback: M95 step 1).

import {
  HTTP_STATUS,
  LOCAL_PROBE_SNIPPET_CHARS,
  LOCAL_PROBE_TIMEOUT_MS,
} from '../../shared/constants'
import type { LocalProbeTarget } from './providerPorts'

export interface LocalProbeResult {
  readonly host: string
  readonly port: number
  readonly path: string
  /** A 2xx answer came back before the timeout. */
  readonly answered: boolean
  /** The answer's status; undefined when nothing answered. */
  readonly status: number | undefined
  /** The body's first characters; '' when nothing answered. */
  readonly snippet: string
}

/**
 * Probes every target at once. A refused connection, a timeout and a
 * non-2xx answer all read as unanswered: the panel only prefills what
 * answered.
 */
export async function probeLocalServers(
  targets: readonly LocalProbeTarget[],
  fetchImpl: typeof fetch,
  timeoutMs: number = LOCAL_PROBE_TIMEOUT_MS,
): Promise<readonly LocalProbeResult[]> {
  return await Promise.all(
    targets.map(async (target) => {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, timeoutMs)
      timer.unref()
      try {
        const response = await fetchImpl(
          `http://${target.host}:${String(target.port)}${target.path}`,
          { signal: controller.signal },
        )
        const body = await response.text()
        const isAnswered =
          response.status >= HTTP_STATUS.ok && response.status < HTTP_STATUS.multipleChoices
        return {
          host: target.host,
          port: target.port,
          path: target.path,
          answered: isAnswered,
          status: response.status,
          snippet: isAnswered ? body.slice(0, LOCAL_PROBE_SNIPPET_CHARS) : '',
        }
      } catch {
        return {
          host: target.host,
          port: target.port,
          path: target.path,
          answered: false,
          status: undefined,
          snippet: '',
        }
      } finally {
        clearTimeout(timer)
      }
    }),
  )
}
