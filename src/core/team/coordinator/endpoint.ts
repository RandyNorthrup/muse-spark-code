// M96d machine coordinator (PLAN.md D75): the discovery endpoint.
//
// One broker listens on a Unix socket (a named pipe on Windows) so
// other processes can find it. The endpoint is discoverability only:
// a refused, missing or busy endpoint marks the broker unreachable and
// never elects a successor, releases a grant or retires anything
// (docs/design/m96d-coordinator.md §§1, 3 F1). The beacon names the
// store and the epoch; it never carries secrets or grant capabilities.

import { createConnection, createServer, type Server, type Socket } from 'node:net'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  COORDINATOR_BEACON_MAX_BYTES,
  COORDINATOR_SOCKET_PATH_MAX_BYTES,
  UI_TEXT,
} from '../../../shared/constants'

const beaconSchema = z.strictObject({
  storeId: z.string().check(z.minLength(1)),
  epoch: z.string().check(z.minLength(1)),
})
export type CoordinatorBeacon = z.infer<typeof beaconSchema>

export type CoordinatorEndpointAddress =
  | { readonly kind: 'unix'; readonly path: string }
  | { readonly kind: 'pipe'; readonly path: string }

/** A refusal that names its cause; the host renders the code through UI_TEXT. */
export class CoordinatorEndpointError extends Error {
  public constructor(
    public readonly code: 'pathTooLong',
    message: string,
  ) {
    super(message)
    this.name = 'CoordinatorEndpointError'
  }
}

export function isCoordinatorEndpointError(value: unknown): value is CoordinatorEndpointError {
  return value instanceof Error && value.name === 'CoordinatorEndpointError'
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

/**
The discovery address for a store directory. A Unix path beyond the
platform's `sun_path` refuses with a said reason instead of failing
at listen; Windows names a pipe, which has no directory-length bound.
*/
export function discoveryEndpointAddress(
  directory: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
): CoordinatorEndpointAddress {
  const endpoint = z.string().check(z.regex(SAFE_NAME)).parse(name)
  if (platform === 'win32') return { kind: 'pipe', path: `\\\\.\\pipe\\${endpoint}` }
  const socket = path.join(directory, `${endpoint}.sock`)
  if (Buffer.byteLength(socket) > COORDINATOR_SOCKET_PATH_MAX_BYTES)
    throw new CoordinatorEndpointError('pathTooLong', UI_TEXT.coordinatorEndpointPathTooLong)
  return { kind: 'unix', path: socket }
}

export interface DiscoveryEndpoint {
  readonly address: CoordinatorEndpointAddress
  close(): Promise<void>
}

/**
Serve discovery: every connection first reads the beacon line, then
echoes, proving the very same process still executes admitted work.
A listen failure rejects with its system code; per-connection
failures drop that connection, never the server.
*/
export async function startDiscoveryEndpoint(
  address: CoordinatorEndpointAddress,
  beacon: CoordinatorBeacon,
): Promise<DiscoveryEndpoint> {
  const line = `${JSON.stringify(beaconSchema.parse(beacon))}\n`
  const server: Server = createServer((socket: Socket) => {
    socket.on('error', () => {
      // Cleanup may destroy the peer while a beacon or echo is in flight.
      socket.destroy()
    })
    socket.write(line)
    socket.pipe(socket)
  })
  server.on('error', () => {
    // A failed accept drops that handshake; the server keeps serving.
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(address.path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    address,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

export type EndpointProbe =
  | { readonly reachable: true; readonly beacon: CoordinatorBeacon }
  | { readonly reachable: false; readonly code: string }

/**
Probe discovery: connect, read the beacon line, validate it. Any
connection failure, early close or malformed beacon reads as
unreachable with its code; nothing here elects or releases. No
deadline of ours: our own server always speaks first, and a foreign
silent listener is answered by the caller closing the probe.
*/
export async function probeDiscoveryEndpoint(
  address: CoordinatorEndpointAddress,
): Promise<EndpointProbe> {
  return await new Promise<EndpointProbe>((resolve) => {
    const socket = createConnection(address.path)
    let text = ''
    let isSettled = false
    const done = (probe: EndpointProbe): void => {
      if (isSettled) return
      isSettled = true
      socket.destroy()
      resolve(probe)
    }
    socket.on('error', (error: unknown) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'unknown'
      done({ reachable: false, code })
    })
    socket.on('close', () => {
      done({ reachable: false, code: 'closed' })
    })
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
      const end = text.indexOf('\n')
      if (end === -1) {
        // A beacon line beyond the bound is a foreign speaker, never our broker.
        if (Buffer.byteLength(text) > COORDINATOR_BEACON_MAX_BYTES)
          done({ reachable: false, code: 'badBeacon' })
        return
      }
      let line: unknown
      try {
        line = JSON.parse(text.slice(0, end))
      } catch (error: unknown) {
        // Only torn text reads as a foreign beacon; anything else keeps its kind.
        if (!(error instanceof SyntaxError)) throw error
        done({ reachable: false, code: 'badBeacon' })
        return
      }
      const parsed = beaconSchema.safeParse(line)
      done(
        parsed.success
          ? { reachable: true, beacon: parsed.data }
          : { reachable: false, code: 'badBeacon' },
      )
    })
  })
}
