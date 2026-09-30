// The extension's network posture (M56, PLAN.md D43). VS Code extends an
// extension's global `fetch` and `WebSocket` with its proxy support
// (`http.proxy`, the system proxy or a PAC file, proxy authentication,
// `http.noProxy`) and the operating system's certificates, while
// `http.fetchAdditionalSupport`, `http.webSocketAdditionalSupport`,
// `http.proxySupport` and `http.systemCertificates` allow it (read from VS
// Code 1.125.0's `proxyResolver.ts` and 1.139.0's shipped extension host).
// Not every version the manifest accepts does both (M62): `fetch` is routed
// from the 1.99 floor on, `WebSocket` only from 1.112.0, and an editor that
// does not run VS Code's extension host may route neither. So the Model API
// client and the Muse Voice socket use the globals as they stand at each
// call, and the Diagnostics report states whether this editor routes each
// and the settings that decide it, never a proxy's address (it can hold a
// password).

import * as z from 'zod/mini'
import { environmentValue } from '../core/backends/musecode/launch'
import type { HostRouting, NetworkFacts, SupportFacts } from '../core/support/report'
import {
  HTTP_NO_PROXY_SETTING,
  HTTP_POSTURE_SETTINGS,
  HTTP_PROXY_SETTING,
  HTTP_PROXY_SUPPORT_DEFAULT,
  HTTP_PROXY_SUPPORT_MODES,
  NODE_EXTRA_CA_CERTS_VARIABLE,
  PROXY_VARIABLE_SPELLINGS,
  VSCODE_ROUTED_GLOBALS,
} from '../shared/constants'
import type { ProxySettings } from './backend/museCodeBackendManager'
import type { ProcessResult } from './backend/sandboxSetup'

/**
 * The global `fetch` at each call, not at activation: whatever VS Code has
 * installed then (its proxy-aware fetch, or Electron's with
 * `http.electronFetch`) carries the request.
 */
export const liveFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)

/** The one method of `vscode.WorkspaceConfiguration` (the `http` section) this reads. */
export interface HttpSettingsSource {
  get(section: string): unknown
}

/** Where `muse serve` gets its proxy and certificates (MuseCodeBackendManager). */
export interface MuseNetworkPosture {
  proxySource(): NetworkFacts['museProxySource']
  hasCertificateOverride(): boolean
}

const flagSchema = z.boolean()
const textSchema = z.string()
const listSchema = z.array(z.string())

/** Type-check VS Code's `http.proxy` and `http.noProxy` before passing either to Muse Code. */
export function readProxySettings(source: HttpSettingsSource): ProxySettings {
  const proxy = textSchema.safeParse(source.get(HTTP_PROXY_SETTING))
  const noProxy = listSchema.safeParse(source.get(HTTP_NO_PROXY_SETTING))
  return {
    proxy: proxy.success ? proxy.data : '',
    noProxy: noProxy.success ? noProxy.data : [],
  }
}

function isFlagOn(source: HttpSettingsSource, key: string, isOnByDefault: boolean): boolean {
  const parsed = flagSchema.safeParse(source.get(key))
  return parsed.success ? parsed.data : isOnByDefault
}

function isTextSet(source: HttpSettingsSource, key: string): boolean {
  const parsed = textSchema.safeParse(source.get(key))
  return parsed.success && parsed.data !== ''
}

/**
 * Whether the extension host put its proxy-aware `fetch` or `WebSocket` in
 * place (M62), told by the global VS Code's `proxyResolver.ts` sets beside
 * it. A host without the marker is not claimed to route the global.
 */
export function hostRouting(
  globals: object,
  global: keyof typeof VSCODE_ROUTED_GLOBALS,
): HostRouting {
  const { name, marker } = VSCODE_ROUTED_GLOBALS[global]
  const value: unknown = Reflect.get(globals, name)
  if (typeof value !== 'function') {
    return 'absent'
  }
  return Object.hasOwn(globals, marker) ? 'routed' : 'notRouted'
}

/**
 * VS Code's defaults stand for a value it does not report or that is
 * malformed; `globals` is the extension host's `globalThis`.
 */
export function readNetworkFacts(
  http: HttpSettingsSource,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  muse: MuseNetworkPosture,
  globals: object,
): NetworkFacts {
  const isVariableSet = (name: string) => (environmentValue(env, platform, name) ?? '') !== ''
  const proxySupport = z
    .enum(HTTP_PROXY_SUPPORT_MODES)
    .safeParse(http.get(HTTP_POSTURE_SETTINGS.proxySupport))
  const proxy = readProxySettings(http)
  return {
    isProxySet: proxy.proxy !== '',
    proxySupport: proxySupport.success ? proxySupport.data : HTTP_PROXY_SUPPORT_DEFAULT,
    isProxyStrictSsl: isFlagOn(http, HTTP_POSTURE_SETTINGS.proxyStrictSsl, true),
    isProxyAuthorizationSet: isTextSet(http, HTTP_POSTURE_SETTINGS.proxyAuthorization),
    noProxyCount: proxy.noProxy.length,
    isSystemCertificatesOn: isFlagOn(http, HTTP_POSTURE_SETTINGS.systemCertificates, true),
    isFetchSupportOn: isFlagOn(http, HTTP_POSTURE_SETTINGS.fetchAdditionalSupport, true),
    isWebSocketSupportOn: isFlagOn(http, HTTP_POSTURE_SETTINGS.webSocketAdditionalSupport, true),
    fetchRouting: hostRouting(globals, 'fetch'),
    webSocketRouting: hostRouting(globals, 'webSocket'),
    hasEnvironmentProxy: PROXY_VARIABLE_SPELLINGS.some((name) => isVariableSet(name)),
    hasExtraCaCertificates: isVariableSet(NODE_EXTRA_CA_CERTS_VARIABLE),
    museProxySource: muse.proxySource(),
    hasMuseCertificateOverride: muse.hasCertificateOverride(),
  }
}

const CLI_NOT_FOUND = 'not run: the Muse Code CLI was not found'

/**
 * `muse config status` for the report: its output, or why there is none.
 * `run` is undefined when the CLI is not installed.
 */
export async function managedConfiguration(
  run: (() => Promise<ProcessResult>) | undefined,
): Promise<SupportFacts['managedConfiguration']> {
  if (run === undefined) {
    return { ok: false, reason: CLI_NOT_FOUND }
  }
  let result: ProcessResult
  try {
    result = await run()
  } catch {
    return { ok: false, reason: 'could not read status' }
  }
  if (result.exitCode !== 0) {
    // CLI output is untrusted and may contain managed credentials. The
    // report needs its exit code, never stderr or partial stdout.
    return { ok: false, reason: `exit code ${String(result.exitCode)}` }
  }
  return { ok: true, text: result.stdout }
}
