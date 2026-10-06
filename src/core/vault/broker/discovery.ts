import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { VAULT_PROTOCOL_VERSION, VAULT_LIMITS, UI_TEXT } from '../../../shared/constants'
import { vaultBrokerLockSchema } from '../../../shared/vaultProtocol'
import { UnixVaultPrivateFiles, isVaultFileMissing, type VaultPrivateFilesPort } from './files'
import { type VaultProcessIdentity } from './peer'

export interface VaultBrokerLocation {
  lock: ReturnType<typeof vaultBrokerLockSchema.parse>
  bootToken: string
}
/** Different protocol versions coexist; lock epoch remains common to the vault. */
export class VaultBrokerDiscovery {
  private readonly lockPath: string
  private readonly tokenPath: string
  readonly directory: string
  constructor(
    runDirectory: string,
    readonly userSession: string,
    private readonly files: VaultPrivateFilesPort = new UnixVaultPrivateFiles(),
  ) {
    const session = Buffer.from(userSession).toString('hex')
    this.directory = path.join(runDirectory, `broker-v${String(VAULT_PROTOCOL_VERSION)}-${session}`)
    this.lockPath = path.join(this.directory, 'broker.lock')
    this.tokenPath = path.join(this.directory, 'boot-token')
  }
  async discover(
    identity: (pid: number) => Promise<VaultProcessIdentity>,
  ): Promise<VaultBrokerLocation | null> {
    await this.files.directory(this.directory)
    let raw: Buffer
    try {
      raw = await this.files.read(this.lockPath)
    } catch (error: unknown) {
      if (isVaultFileMissing(error)) return null
      throw error
    }
    const lock = vaultBrokerLockSchema.parse(JSON.parse(raw.toString('utf8')))
    if (lock.userSession !== this.userSession) throw new Error(UI_TEXT.vault.noAccess)
    const process = await identity(lock.processId)
    if (process.processId !== lock.processId || process.startedAt !== lock.startedAt)
      throw new Error(UI_TEXT.vault.noAccess)
    const token = await this.files.read(this.tokenPath)
    const bootToken = token.toString('ascii')
    if (!/^[a-f0-9]{32}$/u.test(bootToken)) throw new Error(UI_TEXT.vault.noAccess)
    return { lock, bootToken }
  }
  async claim(
    process: VaultProcessIdentity,
    socket: string,
  ): Promise<{ location: VaultBrokerLocation; release: () => Promise<void> }> {
    await this.files.directory(this.directory)
    const lock = vaultBrokerLockSchema.parse({
      v: VAULT_PROTOCOL_VERSION,
      processId: process.processId,
      startedAt: process.startedAt,
      brokerId: randomBytes(VAULT_LIMITS.idBytes).toString('hex'),
      userSession: this.userSession,
      socket,
    })
    const releaseLock = await this.files.claim(this.lockPath, Buffer.from(JSON.stringify(lock)))
    try {
      const bootToken = randomBytes(VAULT_LIMITS.idBytes).toString('hex')
      const releaseToken = await this.files.claim(this.tokenPath, Buffer.from(bootToken, 'ascii'))
      return {
        location: { lock, bootToken },
        release: async () => {
          await releaseToken()
          await releaseLock()
        },
      }
    } catch (error: unknown) {
      await releaseLock()
      throw error
    }
  }
}
