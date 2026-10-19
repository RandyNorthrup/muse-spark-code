import { spawnResourceProcess } from '../../resources/launcher'
import { Socket } from 'node:net'
import { type Duplex } from 'node:stream'
import { probeChildEnvironment } from '../../resources/trees/run'
import * as z from 'zod/mini'
import { VAULT_TRANSPORT_TIMEOUT_MS, VAULT_LIMITS, UI_TEXT } from '../../../shared/constants'

const nativePeerSchema = z.strictObject({
  v: z.literal(1),
  uid: z.number().check(z.int(), z.nonnegative()),
  pid: z.number().check(z.int(), z.positive()),
  nonblocking: z.literal(true),
})
const processSchema = z.strictObject({
  processId: z.number().check(z.int(), z.positive()),
  userId: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
  startedAt: z.number().check(z.int(), z.nonnegative()),
  executable: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
})
const pipeSchema = z.extend(processSchema, { remote: z.boolean(), ownerOnlyDacl: z.boolean() })
export interface VaultProcessIdentity {
  processId: number
  userId: string
  startedAt: number
  executable: string
}
export interface VaultPeerVerifier {
  /** OS credentials and pinned process start/image identity; never a claimed token or pid. */
  verify(socket: Duplex): Promise<VaultProcessIdentity>
}
/**
 * The Windows client's pipe dialer (lane C-M109-1c): a raw pipe socket
 * carries no inspectable server end, so the client platform verifies the
 * pipe's owner through its files-mode helper before connecting.
 */
export interface VaultPipeDialPort {
  /** The pipe's trusted server identity, or a refusal. Never a raw answer. */
  verifyPipe(pipe: string): Promise<VaultProcessIdentity>
  /** Connect this user's pipe; the hello still binds the broker. */
  connectPipe(pipe: string): Socket
}
/** Compile peer.c as a trusted shipped helper in W. fd 3 is the accepted OS socket. */
export interface VaultSocketDescriptorPort {
  /** Native listener adapter's descriptor of this exact connected socket. Never a frame field. */
  descriptor(socket: Socket): number
}
/** Unix vault peer verifier, built by the POSIX client platform and the broker entry. */
export class UnixVaultPeerVerifier implements VaultPeerVerifier {
  constructor(
    private readonly executable: string,
    private readonly processIdentity: (pid: number) => Promise<VaultProcessIdentity>,
    private readonly descriptors: VaultSocketDescriptorPort,
  ) {}
  async verify(stream: Duplex): Promise<VaultProcessIdentity> {
    // Only a kernel socket has peer credentials; a relayed stream never passes here.
    if (!(stream instanceof Socket)) throw new Error(UI_TEXT.vault.noAccess)
    const socket = stream
    // The peer verifier binary runs with an empty environment: absolute
    // entries only, links followed.
    const { child, stop } = await spawnResourceProcess(
      'contained',
      this.executable,
      [],
      { env: probeChildEnvironment({}) },
      [z.number().check(z.int(), z.positive()).parse(this.descriptors.descriptor(socket))],
    )
    child.stdin.end()
    child.stderr.resume()
    const result = await new Promise<z.infer<typeof nativePeerSchema>>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      const timer = setTimeout(() => {
        void stop().catch(() => {
          // The verify already rejects below; a failing stop keeps no cause.
          reject(new Error(UI_TEXT.vault.noAccess))
        })
        reject(new Error(UI_TEXT.vault.noAccess))
      }, VAULT_TRANSPORT_TIMEOUT_MS)
      child.stdout.on('data', (bytes: Buffer) => {
        size += bytes.byteLength
        if (size > VAULT_LIMITS.text) {
          void stop().catch(() => {
            // The verify already rejects below; a failing stop keeps no cause.
            reject(new Error(UI_TEXT.vault.noAccess))
          })
          reject(new Error(UI_TEXT.vault.noAccess))
        } else chunks.push(bytes)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      let code: number | null | undefined
      let hasEnded = false
      const finish = (): Error | undefined => {
        if (code === undefined || !hasEnded) return undefined
        clearTimeout(timer)
        try {
          if (code !== 0) throw new Error(UI_TEXT.vault.noAccess)
          resolve(nativePeerSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
          return undefined
        } catch (error: unknown) {
          // The verify fails with the fixed denial for a foreign value; a
          // peer failure keeps itself for the rejection below.
          return error instanceof Error
            ? error
            : new Error(UI_TEXT.vault.noAccess, { cause: error })
        }
      }
      // close also waits for the inherited live socket: wait for exit + stdout end instead.
      child.once('exit', (result) => {
        code = result
        const failure = finish()
        if (failure !== undefined) reject(failure)
      })
      child.stdout.once('end', () => {
        hasEnded = true
        const failure = finish()
        if (failure !== undefined) reject(failure)
      })
    })
    if (result.uid !== globalThis.process.getuid?.()) throw new Error(UI_TEXT.vault.noAccess)
    const identity = processSchema.parse(await this.processIdentity(result.pid))
    if (identity.processId !== result.pid || identity.userId !== String(result.uid))
      throw new Error(UI_TEXT.vault.noAccess)
    return identity
  }
}
/**
 * The Windows pipe helper's relay (docs/design/vault-windows-pipe-helper.md)
 * reports GetNamedPipeClientProcessId + the client's SID, start time and image
 * with each accepted connection; inspect returns exactly that record.
 */
export interface WindowsVaultPipePort {
  inspect(
    socket: Duplex,
  ): Promise<VaultProcessIdentity & { remote: boolean; ownerOnlyDacl: boolean }>
}
/** @unwired M109 Windows vault peer verifier (waits on lane C-M109-1c's pipe helper) */
export class WindowsVaultPeerVerifier implements VaultPeerVerifier {
  constructor(
    private readonly port: WindowsVaultPipePort,
    private readonly ownerSid: string,
  ) {}
  async verify(socket: Duplex): Promise<VaultProcessIdentity> {
    const identity = pipeSchema.parse(await this.port.inspect(socket))
    if (identity.remote || !identity.ownerOnlyDacl || identity.userId !== this.ownerSid)
      throw new Error(UI_TEXT.vault.noAccess)
    return identity
  }
}
