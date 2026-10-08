import { spawn } from 'node:child_process'
import { type Socket } from 'node:net'
import * as z from 'zod/mini'
import { VAULT_APPROVAL_TTL_MS, VAULT_LIMITS, UI_TEXT } from '../../../shared/constants'

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
  verify(socket: Socket): Promise<VaultProcessIdentity>
}
/** Compile peer.c as a trusted shipped helper in W. fd 3 is the accepted OS socket. */
export interface VaultSocketDescriptorPort {
  /** Native listener adapter's descriptor of this exact connected socket. Never a frame field. */
  descriptor(socket: Socket): number
}
export class UnixVaultPeerVerifier implements VaultPeerVerifier {
  constructor(
    private readonly executable: string,
    private readonly processIdentity: (pid: number) => Promise<VaultProcessIdentity>,
    private readonly descriptors: VaultSocketDescriptorPort,
  ) {}
  async verify(socket: Socket): Promise<VaultProcessIdentity> {
    const result = await new Promise<z.infer<typeof nativePeerSchema>>((resolve, reject) => {
      const child = spawn(this.executable, [], {
        env: {},
        stdio: [
          'ignore',
          'pipe',
          'ignore',
          z.number().check(z.int(), z.positive()).parse(this.descriptors.descriptor(socket)),
        ],
        windowsHide: true,
      })
      const chunks: Buffer[] = []
      let size = 0
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(UI_TEXT.vault.noAccess))
      }, VAULT_APPROVAL_TTL_MS)
      child.stdout?.on('data', (bytes: Buffer) => {
        size += bytes.byteLength
        if (size > VAULT_LIMITS.text) {
          child.kill()
          reject(new Error(UI_TEXT.vault.noAccess))
        } else chunks.push(bytes)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      let code: number | null | undefined
      let hasEnded = false
      const finish = (): void => {
        if (code === undefined || !hasEnded) return
        clearTimeout(timer)
        try {
          if (code !== 0) throw new Error(UI_TEXT.vault.noAccess)
          resolve(nativePeerSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error(UI_TEXT.vault.noAccess))
        }
      }
      // close also waits for the inherited live socket: wait for exit + stdout end instead.
      child.once('exit', (result) => {
        code = result
        finish()
      })
      child.stdout?.once('end', () => {
        hasEnded = true
        finish()
      })
    })
    if (result.uid !== globalThis.process.getuid?.()) throw new Error(UI_TEXT.vault.noAccess)
    const identity = processSchema.parse(await this.processIdentity(result.pid))
    if (identity.processId !== result.pid || identity.userId !== String(result.uid))
      throw new Error(UI_TEXT.vault.noAccess)
    return identity
  }
}
/** P/W bind GetNamedPipeClientProcessId + the client's SID, start time and image. */
export interface WindowsVaultPipePort {
  inspect(
    socket: Socket,
  ): Promise<VaultProcessIdentity & { remote: boolean; ownerOnlyDacl: boolean }>
}
export class WindowsVaultPeerVerifier implements VaultPeerVerifier {
  constructor(
    private readonly port: WindowsVaultPipePort,
    private readonly ownerSid: string,
  ) {}
  async verify(socket: Socket): Promise<VaultProcessIdentity> {
    const identity = pipeSchema.parse(await this.port.inspect(socket))
    if (identity.remote || !identity.ownerOnlyDacl || identity.userId !== this.ownerSid)
      throw new Error(UI_TEXT.vault.noAccess)
    return identity
  }
}
