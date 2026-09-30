// The agent's own requests and a proxy (PLAN.md D62, Q66). The Model API
// backend reaches Meta through Node's `fetch`, which ignores the proxy
// variables unless Node's own switch is on (NODE_USE_ENV_PROXY=1, or
// --use-env-proxy), and only Node 22.21 and later on the 22 line, and every
// release from 24, have that switch (measured 2026-09-27,
// docs/certification/pr32-integration.md). The owner's ruling: the agent
// Page requests use node:https instead, whose switch starts on Node 24.5
// (22.21 on Node 22); early Node 24 can proxy Meta while pages go direct.
// does not re-route by itself; it says so, once, at start, when a proxy
// variable is set for the Model API backend and nothing will use it. Only
// the variables' names are logged: a proxy's address can hold credentials.

import {
  type AcpBackendKind,
  NODE_ENV_PROXY,
  NODE_OPTIONS_VARIABLE,
  NODE_PROXY_VARIABLES,
} from '../shared/constants'

export interface EnvProxyInput {
  readonly backend: AcpBackendKind
  /** Windows reads a variable whatever its case, so one name may answer to both spellings. */
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  /** `process.execArgv`: Node's own flags for this process. */
  readonly execArgv: readonly string[]
  /** `process.version`, such as "v22.20.0". */
  readonly nodeVersion: string
}

const VERSION = /^v?(\d+)\.(\d+)/
const OPTION_SEPARATOR = /\s+/

/** Whether this Node's `fetch` can use the environment's proxy at all. */
function hasEnvProxySwitch(nodeVersion: string, isPageRequest = false): boolean {
  const match = VERSION.exec(nodeVersion)
  if (match === null) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const { allFromMajor, lineMajor, lineMinor } = NODE_ENV_PROXY.since
  return (
    (major >= allFromMajor &&
      (!isPageRequest || major > allFromMajor || minor >= NODE_ENV_PROXY.httpsLineMinor)) ||
    (major === lineMajor && minor >= lineMinor)
  )
}

/** Whether the switch is on: the variable, or the flag given to Node directly or in NODE_OPTIONS. */
function isEnvProxyOn(input: EnvProxyInput): boolean {
  const options = (input.env[NODE_OPTIONS_VARIABLE] ?? '').split(OPTION_SEPARATOR)
  return (
    input.env[NODE_ENV_PROXY.variable] === NODE_ENV_PROXY.on ||
    input.execArgv.includes(NODE_ENV_PROXY.flag) ||
    options.includes(NODE_ENV_PROXY.flag)
  )
}

/** The proxy variables set, each once: on Windows `HTTPS_PROXY` and `https_proxy` are one. */
function proxyVariablesSet(input: EnvProxyInput): readonly string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const name of NODE_PROXY_VARIABLES) {
    const key = input.platform === 'win32' ? name.toUpperCase() : name
    if ((input.env[name] ?? '') === '' || seen.has(key)) {
      continue
    }
    seen.add(key)
    names.push(name)
  }
  return names
}

/** The one warning to log at start, or undefined when the proxy is used or none is set. */
export function envProxyWarning(input: EnvProxyInput): string | undefined {
  if (input.backend !== 'modelApi') {
    return undefined
  }
  const names = proxyVariablesSet(input)
  if (names.length === 0) {
    return undefined
  }
  const set = `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'}`
  const guide = 'docs/acp.md, "Networks and proxies"'
  if (!hasEnvProxySwitch(input.nodeVersion)) {
    const { allFromMajor, lineMajor, lineMinor } = NODE_ENV_PROXY.since
    const since = `${String(lineMajor)}.${String(lineMinor)} or later, or ${String(allFromMajor)}`
    return `${set} set, but Node ${input.nodeVersion} cannot send the Model API backend's requests through a proxy: they go to Meta directly, bypassing it. Node ${since}, can, with ${NODE_ENV_PROXY.variable}=${NODE_ENV_PROXY.on} in the agent's environment (${guide}).`
  }
  if (!isEnvProxyOn(input)) {
    return `${set} set, but ${NODE_ENV_PROXY.variable} is not ${NODE_ENV_PROXY.on}: the Model API backend's requests go to Meta directly, bypassing the proxy. Set ${NODE_ENV_PROXY.variable}=${NODE_ENV_PROXY.on} in the agent's environment and restart it (${guide}).`
  }
  return hasEnvProxySwitch(input.nodeVersion, true)
    ? undefined
    : `${set} set and Meta requests use the proxy, but Node ${input.nodeVersion} sends web_fetch page requests directly, bypassing it. Page requests need Node 22.21 or later on Node 22, or Node 24.${String(NODE_ENV_PROXY.httpsLineMinor)} or later, with ${NODE_ENV_PROXY.variable}=${NODE_ENV_PROXY.on} (${guide}).`
}
