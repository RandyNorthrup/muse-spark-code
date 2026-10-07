import { MCP_TRANSPORTS, UI_TEXT } from '../../shared/constants'
import type { McpLaunch } from '../backends/modelapi/mcp/servers'

const reference = /^\$\{secret:([a-z][a-z0-9-]{0,47})\}$/u
const headerReference = /^(Bearer )?\$\{secret:([a-z][a-z0-9-]{0,47})\}$/u
const routingHeaders = new Set([
  'host',
  'proxy-authorization',
  'proxy-authenticate',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
])

/** Credentials cannot override routing or authorize a proxy rather than the bound resource. */
export function isMcpSecretHeaderSafe(name: string): boolean {
  return /^[!#$%&'*+.^_`|~\w-]+$/u.test(name) && !routingHeaders.has(name.toLowerCase())
}

export function mcpSecretDenied(): never {
  throw new Error(UI_TEXT.vault.noAccess)
}

export function hasMcpSecretReference(value: string): boolean {
  return value.includes('${secret:') || value.includes('secret://')
}

/** References are accepted only in MCP env/header values, never executable/argv/cwd/URL. */
export function mcpSecretReferences(launch: McpLaunch): ReadonlyMap<string, string> {
  const refs = new Map<string, string>()
  const isStdio = launch.transport === MCP_TRANSPORTS.stdio
  const fields = isStdio ? [launch.command, ...launch.args, launch.cwd ?? ''] : [launch.url]
  if (fields.some((field) => hasMcpSecretReference(field))) mcpSecretDenied()
  const values = isStdio ? launch.env : launch.headers
  const names = new Set<string>()
  for (const [name, value] of Object.entries(values)) {
    const identity = isStdio ? name : name.toLowerCase()
    if (names.has(identity)) mcpSecretDenied()
    names.add(identity)
    if (!hasMcpSecretReference(value)) continue
    const match = (isStdio ? reference : headerReference).exec(value)
    const secret = match?.[isStdio ? 1 : 2]
    if (secret === undefined) mcpSecretDenied()
    if (isStdio && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) mcpSecretDenied()
    if (!isStdio && !isMcpSecretHeaderSafe(name)) mcpSecretDenied()
    refs.set(name, `secret://${secret}`)
  }
  return refs
}
