// Desktop observability (M111 lane OB, PLAN.md D91.22): the Electron
// app's OpenTelemetry wiring (research §11). The main process uses the
// Node SDK's shape and the renderers the web SDK's, both speaking
// OTLP/HTTP JSON to the local receiver; the workbench lane (WB) applies
// these options to the real SDKs. Export to the person's collector stays
// off here too: only the receiver's loopback base URL is ever wired.

import { O11Y_RECEIVER_HOST, O11Y_RECEIVER_PORT } from '../../shared/constants'

/** The local receiver's base URL, loopback only. */
export function o11yReceiverBaseUrl(): string {
  return `http://${O11Y_RECEIVER_HOST}:${String(O11Y_RECEIVER_PORT)}`
}

/** The OTLP/HTTP JSON options one Electron process exports with. */
export interface ElectronOtelProcessOptions {
  readonly serviceName: 'app-main' | 'app-renderer'
  readonly tracesUrl: string
  readonly metricsUrl: string
  readonly logsUrl: string
  readonly protocol: 'http-json'
}

/**
The main process's exporter options: OTLP/HTTP JSON to the local
receiver. A custom base URL is for the harness only, and anything but
loopback is refused with it.
*/
export function electronMainOtelOptions(
  baseUrl: string = o11yReceiverBaseUrl(),
): ElectronOtelProcessOptions {
  return processOptions('app-main', baseUrl)
}

/** The renderers' exporter options: same receiver, their service name. */
export function electronRendererOtelOptions(
  baseUrl: string = o11yReceiverBaseUrl(),
): ElectronOtelProcessOptions {
  return processOptions('app-renderer', baseUrl)
}

function processOptions(
  serviceName: 'app-main' | 'app-renderer',
  baseUrl: string,
): ElectronOtelProcessOptions {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch (error: unknown) {
    // Only a malformed base URL refuses: anything else keeps its kind
    // past the options.
    if (!(error instanceof TypeError)) throw error
    throw new RangeError('o11y receiver base URL is not a URL', { cause: error })
  }
  if (url.hostname !== O11Y_RECEIVER_HOST && url.hostname !== 'localhost') {
    throw new RangeError('o11y receiver base URL is not loopback')
  }
  const base = url.href.endsWith('/') ? url.href.slice(0, -1) : url.href
  return {
    serviceName,
    tracesUrl: `${base}/v1/traces`,
    metricsUrl: `${base}/v1/metrics`,
    logsUrl: `${base}/v1/logs`,
    protocol: 'http-json',
  }
}
