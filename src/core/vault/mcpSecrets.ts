import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { MCP_TRANSPORTS, VAULT_LIMITS } from '../../shared/constants'
import { vaultCommandSchema, vaultUseSchema, type VaultUse } from '../../shared/vault'
import type { McpStdioLaunch } from '../backends/modelapi/mcp/servers'
import type { McpChildProcess } from '../backends/modelapi/mcp/stdio'
import { vaultUseDigest } from './useDigest'
import {
  mcpSecretReferences,
  isMcpSecretHeaderSafe,
  hasMcpSecretReference,
  mcpSecretDenied,
} from './mcpReferences'

const reference = /^\$\{secret:([a-z][a-z0-9-]{0,47})\}$/u
const object = z.record(z.string(), z.unknown())

export interface McpVaultPoolPort {
  startStdio(
    server: string,
    launch: McpStdioLaunch,
    cwd: string,
    isCancelled: () => boolean,
  ): Promise<McpChildProcess>
  fetchFor(
    server: string,
    url: string,
    headers: Readonly<Record<string, string>>,
    isCancelled?: () => boolean,
  ): typeof fetch | undefined
}

/** Trusted bindings, shared by the extension pool and M96's bridge. No value crosses these ports. */
export interface McpVaultRoutePorts {
  resolveCommand(launch: McpStdioLaunch, cwd: string): Promise<z.infer<typeof vaultCommandSchema>>
  /** X resolves/authorizes in the feeder, rechecks actual use, and owns tree lifetime + scrub. */
  start(input: {
    server: string
    launch: McpStdioLaunch
    use: Extract<VaultUse, { kind: 'mcp' }>
    secrets: ReadonlyMap<string, string>
    isCancelled: () => boolean
  }): Promise<McpChildProcess>
  /** Broker/host transport authorizes each use and scrubs response bytes, including token echoes. */
  remote(input: {
    server: string
    url: string
    /** Rechecked at physical credential release by the trusted transport. */
    isCancelled: () => boolean
    init: RequestInit
    uses: readonly { handle: string; use: Extract<VaultUse, { kind: 'header' }>; bearer: boolean }[]
  }): Promise<Response>
  /** O's broker-owned OAuth transport, selected by authenticated server registry. */
  oauth?(server: string, url: string, isCancelled: () => boolean): typeof fetch | undefined
}

export function mcpVaultRoutes(ports: McpVaultRoutePorts): McpVaultPoolPort {
  return {
    async startStdio(server, input, cwd, isCancelled) {
      const launch = structuredClone(input)
      const secrets = mcpSecretReferences(launch)
      if (secrets.size === 0 || isCancelled()) mcpSecretDenied()
      const command = vaultCommandSchema.parse(await ports.resolveCommand(launch, cwd))
      if (JSON.stringify(command.argv) !== JSON.stringify(launch.args)) mcpSecretDenied()
      const names = [...secrets].map(([name]) => name)
      const use = vaultUseSchema.parse({ kind: 'mcp', command, server, names })
      if (use.kind !== 'mcp' || isCancelled()) mcpSecretDenied()
      let child: McpChildProcess
      try {
        child = await ports.start({ server, launch, use, secrets, isCancelled })
      } catch {
        mcpSecretDenied()
      }
      if (isCancelled()) {
        await child.kill()
        mcpSecretDenied()
      }
      return child
    },
    fetchFor(server, url, input, isCancelled = () => false) {
      const headers = { ...input }
      const refs = mcpSecretReferences({ transport: MCP_TRANSPORTS.streamableHttp, url, headers })
      if (refs.size === 0) return ports.oauth?.(server, url, isCancelled)
      if (ports.oauth?.(server, url, isCancelled) !== undefined) mcpSecretDenied()
      const destination = new URL(url)
      if (
        destination.protocol !== 'https:' ||
        destination.username !== '' ||
        destination.password !== '' ||
        destination.hash !== ''
      )
        mcpSecretDenied()
      const uses = [...refs].map(([name, handle]) => {
        const use = vaultUseSchema.parse({
          kind: 'header',
          origin: destination.origin,
          headerName: name,
        })
        if (use.kind !== 'header') mcpSecretDenied()
        return { handle, use, bearer: headers[name]?.startsWith('Bearer ') === true }
      })
      return async (target, init) => {
        if (
          typeof target !== 'string' ||
          target !== url ||
          init?.redirect !== 'error' ||
          isCancelled()
        )
          mcpSecretDenied()
        const safe = new Headers(init.headers)
        // The transport still carries handles; only the trusted route supplies credentials.
        for (const name of refs.keys()) {
          if (safe.get(name) !== headers[name]) mcpSecretDenied()
          safe.delete(name)
        }
        try {
          return await ports.remote({
            server,
            url,
            isCancelled,
            init: { ...init, headers: safe },
            uses,
          })
        } catch {
          mcpSecretDenied()
        }
      }
    },
  }
}

export interface McpMovePort {
  /** Trusted host resolves the selected entry's current executable/argv/cwd or header origin. */
  resolveUse(
    server: string,
    entry: Readonly<Record<string, unknown>>,
    field: 'env' | 'headers',
    key: string,
  ): Promise<VaultUse>
  /** Must reject duplicate names; encrypt and read-back SHA-256 verify before resolving. */
  importSecret(name: string, bytes: Uint8Array, use: VaultUse): Promise<void>
}

/** User-only review artifact. No disk write: the editor displays/saves this exact proposed edit. */
export async function moveMcpSecretToVault(
  source: string,
  input: { server: string; field: 'env' | 'headers'; key: string; name: string; use: VaultUse },
  port: McpMovePort,
): Promise<{ sourceDigest: string; proposed: string; handle: string }> {
  const selection = structuredClone(input)
  if (!reference.test(`\${secret:${selection.name}}`) || source.length > VAULT_LIMITS.frameBytes)
    mcpSecretDenied()
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    mcpSecretDenied()
  }
  const root = object.parse(parsed)
  if (root['mcpServers'] !== undefined && root['mcp_servers'] !== undefined) mcpSecretDenied()
  const servers = object.parse(root['mcpServers'] ?? root['mcp_servers'])
  const entry = object.parse(servers[selection.server])
  const fields = object.parse(entry[selection.field])
  const value = fields[selection.key]
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    hasMcpSecretReference(value) ||
    value.includes('${')
  )
    mcpSecretDenied()
  if (Buffer.byteLength(value) > VAULT_LIMITS.valueBytes) mcpSecretDenied()
  const use = vaultUseSchema.parse(selection.use)
  const resolved = vaultUseSchema.parse(
    await port.resolveUse(selection.server, entry, selection.field, selection.key),
  )
  if (vaultUseDigest(use) !== vaultUseDigest(resolved)) mcpSecretDenied()
  if (selection.field === 'env') {
    if (
      use.kind !== 'mcp' ||
      use.server !== selection.server ||
      use.names.length !== 1 ||
      use.names[0] !== selection.key
    )
      mcpSecretDenied()
  } else {
    if (
      use.kind !== 'header' ||
      !use.origin.startsWith('https://') ||
      !isMcpSecretHeaderSafe(selection.key) ||
      /[\r\n\0]/u.test(value) ||
      use.headerName !== selection.key ||
      typeof entry['url'] !== 'string' ||
      new URL(entry['url']).origin !== use.origin
    )
      mcpSecretDenied()
  }
  const bytes = Buffer.alloc(Buffer.byteLength(value))
  try {
    bytes.write(value)
    try {
      await port.importSecret(selection.name, bytes, use)
    } catch {
      mcpSecretDenied()
    }
  } finally {
    bytes.fill(0)
  }
  fields[selection.key] = `\${secret:${selection.name}}`
  entry[selection.field] = fields
  servers[selection.server] = entry
  root[root['mcpServers'] === undefined ? 'mcp_servers' : 'mcpServers'] = servers
  return {
    sourceDigest: createHash('sha256').update(source).digest('hex'),
    proposed: `${JSON.stringify(root, null, 2)}\n`,
    handle: `secret://${selection.name}`,
  }
}
