// Which protocol era a server speaks (PLAN.md D213): `server/discover`
// is probed once at the newest modern revision, and anything that is not
// positive modern evidence falls back to the `initialize` handshake (the
// denylist, as the official clients probe). The stdio probe runs on a
// disposable sibling process — some servers exit on any pre-`initialize`
// request, so the probe must not spend the session's process — and the
// HTTP probe on its own transport instance. A silence bound the probe
// always carries: on stdio a silent server is a legacy server, while on
// HTTP silence is an outage and rejects. Transport outages, credential
// refusals and failed servers are never era evidence and keep their own
// error. Pure over the injected probe transport, except the verdict log.

import {
  MCP_DISCOVER_PROBE_TIMEOUT_MS,
  MCP_MODERN_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSIONS,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_TRANSPORTS,
} from '../../../../shared/constants'
import type { CoreLogger } from '../../../logging'
import { McpConnection, McpTimeoutError, type McpTransport } from './connection'
import type { McpElicitationHandler } from './elicitation'
import { McpError, newestMutualModern, unsupportedVersions } from './protocol'

export type EraVerdict =
  | { readonly era: 'modern'; readonly version: string; readonly hasTools: boolean }
  | { readonly era: 'legacy' }

export interface EraProbeDeps {
  /** The server's name in the settings, for the log. */
  readonly name: string
  readonly transport: (typeof MCP_TRANSPORTS)[keyof typeof MCP_TRANSPORTS]
  /** A fresh disposable transport: a sibling process on stdio, a new instance on HTTP. */
  readonly openProbe: () => McpTransport | Promise<McpTransport>
  readonly clientVersion: string
  readonly elicitation?: McpElicitationHandler
  /** The verdict is logged here, once. */
  readonly log: CoreLogger
  /** The probe's own chatter goes here: the session repeats anything worth saying. */
  readonly probeLog: CoreLogger
  /** The entry's own start-up deadline, when it names one. */
  readonly startupTimeoutMs: number | undefined
  /** The servers' stop: a probe it ends is no verdict. */
  readonly signal: AbortSignal
}

/**
How long the probe waits: on stdio the ecosystem's bound, clamped to
the entry's own start-up budget, so a silent legacy server falls back
promptly; on HTTP the entry's budget when set, since silence there is
an outage to fail, not a legacy server to find.
*/
function probeTimeoutMs(
  transport: EraProbeDeps['transport'],
  startupTimeoutMs: number | undefined,
): number {
  if (transport === MCP_TRANSPORTS.stdio) {
    return startupTimeoutMs === undefined
      ? MCP_DISCOVER_PROBE_TIMEOUT_MS
      : Math.min(startupTimeoutMs, MCP_DISCOVER_PROBE_TIMEOUT_MS)
  }
  return startupTimeoutMs ?? MCP_DISCOVER_PROBE_TIMEOUT_MS
}

/** One probe; the era the session opens with. The probe transport is closed on every path. */
export async function probeEra(deps: EraProbeDeps): Promise<EraVerdict> {
  const transport = await deps.openProbe()
  const connection = new McpConnection(transport, {
    name: deps.name,
    clientVersion: deps.clientVersion,
    log: deps.probeLog,
    transport: deps.transport,
    ...(deps.elicitation !== undefined && { elicitation: deps.elicitation }),
  })
  try {
    connection.adoptModern(MCP_MODERN_PROTOCOL_VERSION, false)
    const discover = await connection.discover(
      probeTimeoutMs(deps.transport, deps.startupTimeoutMs),
      deps.signal,
    )
    // A server that answers discover but names no modern version
    // advertises the legacy era, not an incompatibility.
    const mutual = newestMutualModern(discover.supportedVersions)
    if (mutual === undefined) {
      deps.log.info(`MCP server ${deps.name} speaks legacy MCP; the handshake follows`)
      return { era: 'legacy' }
    }
    deps.log.info(`MCP server ${deps.name} speaks modern MCP ${mutual}`)
    return { era: 'modern', version: mutual, hasTools: discover.capabilities.tools !== undefined }
  } catch (error: unknown) {
    if (deps.signal.aborted) {
      throw error
    }
    if (error instanceof McpTimeoutError) {
      if (deps.transport === MCP_TRANSPORTS.streamableHttp) {
        throw error
      }
      deps.log.info(`MCP server ${deps.name} is silent; the legacy handshake follows`)
      return { era: 'legacy' }
    }
    if (error instanceof McpError) {
      const versions = unsupportedVersions(error)
      if (versions !== undefined) {
        const mutual = newestMutualModern(versions.supported)
        if (mutual !== undefined) {
          // Positive modern evidence at a mutual version: the session
          // goes modern, and its first tools/list confirms (or fails
          // loudly with the same evidence).
          deps.log.info(`MCP server ${deps.name} speaks modern MCP ${mutual}`)
          return { era: 'modern', version: mutual, hasTools: true }
        }
        if (versions.supported.some((version) => MCP_SUPPORTED_PROTOCOL_VERSIONS.has(version))) {
          deps.log.info(`MCP server ${deps.name} speaks legacy MCP; the handshake follows`)
          return { era: 'legacy' }
        }
        throw new McpError(
          `the server speaks only MCP ${versions.supported.join(', ') || 'no named revision'}; this client speaks ${[...MCP_MODERN_PROTOCOL_VERSIONS].join(', ')}, ${[...MCP_SUPPORTED_PROTOCOL_VERSIONS].join(', ')}`,
        )
      }
      // Every other answer — a legacy `-32601`, a closed sibling, a
      // status-only HTTP refusal — is a legacy server (the denylist).
      deps.log.info(`MCP server ${deps.name} speaks legacy MCP; the handshake follows`)
      return { era: 'legacy' }
    }
    throw error
  } finally {
    await connection.close()
  }
}
