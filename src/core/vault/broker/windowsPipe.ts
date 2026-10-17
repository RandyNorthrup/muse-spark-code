// The Windows pipe helper's contract (lead decision 4, 2026-10-10): Node
// cannot give a named pipe an owner-only DACL, refuse remote clients or read
// the client's process id, so a trusted C# helper owns the pipe and relays
// each accepted connection to the broker over its standard streams. The full
// contract is docs/design/vault-windows-pipe-helper.md; lane C-M109-1c
// implements the helper (native/windows/MuseSparkVaultPipe.cs) and the relay
// below, against these types.

import * as z from 'zod/mini'
import { VAULT_LIMITS } from '../../../shared/constants'
import { type VaultSecuredListenerPort } from './channel'
import { type WindowsVaultPipePort } from './peer'
import { type VaultFileSecurityPort } from '../store'
import { type VaultPrivateFilesPort } from './files'

/** Version of the helper's stdio relay, independent of the broker protocol. */
export const WINDOWS_VAULT_PIPE_RELAY_VERSION = 1
/** Header: type (1 byte), connection id (uint32 BE), payload length (uint32 BE). */
export const WINDOWS_VAULT_PIPE_HEADER_BYTES = 9
/** At most this many connections are open at once; the helper refuses more. */
export const WINDOWS_VAULT_PIPE_MAX_CONNECTIONS = 64
/** One relay frame's payload never exceeds the broker's frame limit. */
export const WINDOWS_VAULT_PIPE_MAX_PAYLOAD = VAULT_LIMITS.frameBytes

/** Frame types. Helper to broker below 0x10; broker to helper from 0x10. */
export const WINDOWS_VAULT_PIPE_FRAME = {
  /** Connection 0. The pipe exists with the owner-only DACL; payload windowsVaultPipeReadySchema. */
  ready: 0x01,
  /** A client connected; payload windowsVaultPipeClientSchema. */
  open: 0x02,
  /** Bytes from the client, in order. */
  data: 0x03,
  /** The client closed or broke the pipe; no further frame for this id. */
  end: 0x04,
  /** Connection 0. A fixed fault word (windowsVaultPipeFaultSchema), then exit. */
  fault: 0x05,
  /** Result of a file command; payload windowsVaultPipeFileResultSchema. */
  fileResult: 0x06,
  /** Result of a server check; payload windowsVaultPipeServerResultSchema. */
  serverResult: 0x07,
  /** Bytes to the client. */
  send: 0x13,
  /** Disconnect the client (DisconnectNamedPipe, CloseHandle). */
  close: 0x14,
  /** Run a file command; payload windowsVaultPipeFileCommandSchema. */
  file: 0x21,
  /** Identify a pipe's server natively (`files` mode); payload windowsVaultPipeServerQuerySchema. */
  server: 0x22,
} as const

const sid = z.string().check(z.regex(/^S-1-[0-9]+(-[0-9]+){1,14}$/u))
const counter = z.number().check(z.int(), z.nonnegative())
const absoluteWindowsPath = z
  .string()
  .check(z.maxLength(VAULT_LIMITS.text), z.regex(/^[A-Za-z]:\\[^\0\r\n]*$/u))
/** A random name per broker start, published only in the owner-only lock file. */
export const windowsVaultPipeNameSchema = z
  .string()
  .check(z.regex(/^\\\\\.\\pipe\\muse-spark-vault-[a-f0-9]{32}$/u))

export const windowsVaultPipeReadySchema = z.strictObject({
  v: z.literal(WINDOWS_VAULT_PIPE_RELAY_VERSION),
  pipe: windowsVaultPipeNameSchema,
  /** The helper's own token user: the only principal in the pipe's DACL. */
  ownerSid: sid,
})
/** What the helper read from the OS for one accepted client; never a claim from the client. */
export const windowsVaultPipeClientSchema = z.strictObject({
  v: z.literal(WINDOWS_VAULT_PIPE_RELAY_VERSION),
  processId: counter.check(z.positive()),
  userId: sid,
  /** GetProcessTimes creation time, milliseconds since the Unix epoch. */
  startedAt: counter,
  executable: absoluteWindowsPath,
  /** GetNamedPipeClientComputerName succeeded: a remote client (always refused). */
  remote: z.boolean(),
  /** The server handle's DACL, read back with GetSecurityInfo, grants only ownerSid. */
  ownerOnlyDacl: z.boolean(),
})
export type WindowsVaultPipeClient = z.infer<typeof windowsVaultPipeClientSchema>
export const windowsVaultPipeFaultSchema = z.enum([
  'squatted',
  'createFailed',
  'protocol',
  'tooManyConnections',
  'integrity',
])
/** Owner-only DACL commands from MuseSparkVault.cs's VaultPathGuard. */
export const windowsVaultPipeFileCommandSchema = z.strictObject({
  v: z.literal(WINDOWS_VAULT_PIPE_RELAY_VERSION),
  id: counter,
  command: z.enum(['protect', 'verify']),
  kind: z.enum(['directory', 'file']),
  path: absoluteWindowsPath,
})
export const windowsVaultPipeFileResultSchema = z.strictObject({
  v: z.literal(WINDOWS_VAULT_PIPE_RELAY_VERSION),
  id: counter,
  result: z.enum(['ok', 'refused', 'missing']),
})

/** The client side's native check of the broker's pipe (RVCM1091A F9). */
export const windowsVaultPipeServerQuerySchema = z.strictObject({
  v: z.literal(WINDOWS_VAULT_PIPE_RELAY_VERSION),
  id: counter,
  pipe: windowsVaultPipeNameSchema,
})
export const windowsVaultPipeServerResultSchema = z.strictObject({
  v: z.literal(WINDOWS_VAULT_PIPE_RELAY_VERSION),
  id: counter,
  result: z.enum(['ok', 'refused', 'missing']),
  /** The helper's own token user: the server must equal it. */
  ownerSid: sid,
  /** Read from the OS for the pipe's server process; null unless `ok`. */
  server: z.nullable(windowsVaultPipeClientSchema),
})

/**
 * The host side of a Windows connection (lane C-M109-1c): the broker's pipe
 * server, identified natively, must be this user's broker from the lock.
 * The verifier refuses unless `server.userId === ownerSid`, `remote` is
 * false, and the process id and start time equal the lock's.
 */
export interface WindowsVaultPipeServerCheck {
  inspectServer(pipe: string): Promise<z.infer<typeof windowsVaultPipeServerResultSchema>>
}

/**
 * The TS side of the helper (lane C-M109-1c): starts the guarded helper in
 * `serve` mode for the broker or `files` mode for any other process, and
 * exposes the pipe as the channel's secured listener, the relayed client's
 * identity to WindowsVaultPeerVerifier, and the owner-only DACL commands to
 * the store and the broker's private files.
 */
export interface WindowsVaultPipeHelper extends VaultSecuredListenerPort, WindowsVaultPipePort {
  readonly files: VaultFileSecurityPort & VaultPrivateFilesPort
  /** Ends every connection and the helper; idempotent. */
  stop(): Promise<void>
}

/**
 * The host's decision on a server check (RVCM1091A F9): the pipe's server is
 * this user's broker only when every field the OS reported matches.
 */
export function isVaultPipeServerTrusted(
  answer: unknown,
  lock: { readonly processId: number; readonly startedAt: number },
): boolean {
  const parsed = windowsVaultPipeServerResultSchema.safeParse(answer)
  if (!parsed.success || parsed.data.result !== 'ok' || parsed.data.server === null) return false
  const server = parsed.data.server
  return (
    server.userId === parsed.data.ownerSid &&
    !server.remote &&
    server.processId === lock.processId &&
    server.startedAt === lock.startedAt
  )
}
