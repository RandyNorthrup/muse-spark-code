import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import {
  UI_TEXT,
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_SEALED_BLOB_MAX,
  VAULT_SYSTEMD_SEAL_VERSION,
} from '../../../shared/constants'
import { VaultError } from '../../../core/vault/crypto'
import { VaultStoreUnavailableError } from '../../../core/vault/broker/ports'
import {
  vaultSlotRecordSchema,
  type VaultSlotPort,
  type VaultSlotRecord,
} from '../../../shared/vault'
import { spawnResourceProcess } from '../../../core/resources/launcher'
import { slotContextSchema, type SlotContext } from './slotIdentity'
import { wrapSlotKey } from './slotWrap'

// A TPM2 sealed object through `systemd-creds --user` (systemd 256 or later),
// only where the user can open /dev/tpmrm0 (D89.2, research §2.3). The 32-byte
// vault key travels on stdin and returns inside the sealed blob; the slot
// record holds the blob, never key material. Unsealing is silent (the TPM
// binds the blob to this user and machine), so this slot serves the hardware
// tier only: Linux presence is the vault passphrase, prompted per use by the
// host, and never this slot.

/** One sealed-command run; the default below spawns the real system tools. */
export interface LinuxTpm2Runner {
  run(file: string, args: readonly string[], input: Uint8Array): Promise<Uint8Array>
}

async function defaultRun(
  file: string,
  args: readonly string[],
  input: Uint8Array,
): Promise<Uint8Array> {
  const owned = Buffer.alloc(input.length)
  owned.set(input)
  let launched: Awaited<ReturnType<typeof spawnResourceProcess>>
  try {
    launched = await spawnResourceProcess('contained', file, args, { env: {} })
  } catch {
    owned.fill(0)
    throw new VaultStoreUnavailableError()
  }
  const { child, stop } = launched
  return await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let isSettled = false
    const fail = (error: Error) => {
      if (isSettled) return
      isSettled = true
      owned.fill(0)
      for (const chunk of chunks) chunk.fill(0)
      void stop()
        .then(() => {
          reject(error)
        })
        .catch(() => {
          reject(error)
        })
    }
    const succeed = (output: Buffer) => {
      if (isSettled) return
      isSettled = true
      owned.fill(0)
      for (const chunk of chunks) chunk.fill(0)
      resolve(output)
    }
    child.on('error', () => {
      fail(new VaultStoreUnavailableError())
    })
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > VAULT_SEALED_BLOB_MAX) {
        chunk.fill(0)
        fail(new VaultError('io'))
        return
      }
      chunks.push(chunk)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new VaultStoreUnavailableError())
        return
      }
      const output = Buffer.alloc(size)
      let offset = 0
      for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.length
      }
      succeed(output)
    })
    try {
      child.stdin.write(owned)
      child.stdin.end()
    } catch {
      fail(new VaultStoreUnavailableError())
    }
  })
}

/** Where the machine seals: systemd-creds 256+ binds TPM2 with `-T`. */
export interface LinuxTpm2Capabilities {
  readonly hasDevice: boolean
  readonly canSeal: boolean
}

async function canOpenTpmRm(): Promise<boolean> {
  for (const device of ['/dev/tpmrm0', '/dev/tpm0']) {
    try {
      const handle = await open(device, constants.O_RDONLY)
      try {
        return true
      } finally {
        await handle.close()
      }
    } catch {
      /* This device is absent or closed to the user; try the next. */
    }
  }
  return false
}

async function canSealWithSystemd(run: LinuxTpm2Runner): Promise<boolean> {
  let output: Uint8Array
  try {
    output = await run.run('systemd-creds', ['--version'], new Uint8Array())
  } catch {
    return false
  }
  const first = Buffer.from(output).toString('utf8').split('\n', 1)[0] ?? ''
  output.fill(0)
  const major = /systemd\s+(\d+)/u.exec(first)?.[1]
  if (major === undefined) return false
  const version = Number(major)
  return Number.isSafeInteger(version) && version >= VAULT_SYSTEMD_SEAL_VERSION
}

/** The default runner spawns the real system tools through the resource boundary. */
export const defaultLinuxTpm2Runner: LinuxTpm2Runner = { run: defaultRun }

/** Real capability read: the sealed slot is offered only where it can seal. */
export async function linuxTpm2Capabilities(
  run: LinuxTpm2Runner = defaultLinuxTpm2Runner,
): Promise<LinuxTpm2Capabilities> {
  const hasDevice = await canOpenTpmRm()
  const canSeal = hasDevice && (await canSealWithSystemd(run))
  return { hasDevice, canSeal }
}

/** The sealed blob, base64 inside the slot record's wrappedKey. */
interface SealedContainer {
  readonly v: typeof VAULT_FORMAT_VERSION
  readonly slotId: string
  readonly vaultId: string
  readonly tool: 'systemd-creds'
  readonly sealed: string
}

/** TPM2-sealed hardware slot. Presence-tier records never resolve here. */
export class LinuxTpm2Slot implements VaultSlotPort {
  private readonly context: SlotContext
  readonly tier = 'hardware' as const
  constructor(
    context: SlotContext,
    private readonly runner: LinuxTpm2Runner = defaultLinuxTpm2Runner,
    platform: NodeJS.Platform = process.platform,
  ) {
    if (platform !== 'linux') throw new VaultError('invalid')
    const parsed = slotContextSchema.safeParse(context)
    if (!parsed.success) throw new Error(UI_TEXT.vault.useChanged)
    this.context = parsed.data
  }
  private reference(): string {
    return `vault.${this.context.vaultId}.${this.context.id}`
  }
  private record(sealed: string): VaultSlotRecord {
    const container: SealedContainer = {
      v: VAULT_FORMAT_VERSION,
      slotId: this.context.id,
      vaultId: this.context.vaultId,
      tool: 'systemd-creds',
      sealed,
    }
    return vaultSlotRecordSchema.parse({
      ...this.context,
      v: VAULT_FORMAT_VERSION,
      tier: this.tier,
      provider: 'linuxTpm2',
      keyReference: this.context.id,
      wrappedKey: Buffer.from(JSON.stringify(container), 'utf8').toString('base64'),
      nonce: null,
      tag: null,
      kdf: null,
      backend: null,
    })
  }
  private parseContainer(wrappedKey: string): SealedContainer {
    let raw: unknown
    try {
      raw = JSON.parse(Buffer.from(wrappedKey, 'base64').toString('utf8'))
    } catch {
      throw new VaultError('invalid')
    }
    const candidate: {
      readonly v?: unknown
      readonly slotId?: unknown
      readonly vaultId?: unknown
      readonly tool?: unknown
      readonly sealed?: unknown
    } = typeof raw === 'object' && raw !== null ? raw : {}
    if (
      candidate.v !== VAULT_FORMAT_VERSION ||
      candidate.slotId !== this.context.id ||
      candidate.vaultId !== this.context.vaultId ||
      candidate.tool !== 'systemd-creds' ||
      typeof candidate.sealed !== 'string'
    )
      throw new VaultError('invalid')
    return {
      v: VAULT_FORMAT_VERSION,
      slotId: this.context.id,
      vaultId: this.context.vaultId,
      tool: 'systemd-creds',
      sealed: candidate.sealed,
    }
  }
  private async seal(key: Uint8Array): Promise<string> {
    const capabilities = await linuxTpm2Capabilities(this.runner)
    if (!capabilities.hasDevice || !capabilities.canSeal) throw new VaultStoreUnavailableError()
    const blob = await this.runner.run(
      'systemd-creds',
      ['encrypt', '--user', '-T', `--name=${this.reference()}`, '-', '-'],
      key,
    )
    try {
      if (blob.length === 0) throw new VaultStoreUnavailableError()
      return Buffer.from(blob).toString('base64')
    } finally {
      blob.fill(0)
    }
  }
  private async unseal(container: SealedContainer): Promise<Uint8Array> {
    const capabilities = await linuxTpm2Capabilities(this.runner)
    if (!capabilities.hasDevice || !capabilities.canSeal) throw new VaultStoreUnavailableError()
    const blob = Buffer.from(container.sealed, 'base64')
    try {
      const key = await this.runner.run('systemd-creds', ['decrypt', '--user', '-', '-'], blob)
      try {
        if (key.length !== VAULT_KEY_BYTES) throw new VaultError('invalid')
        const owned = Buffer.alloc(VAULT_KEY_BYTES)
        owned.set(key)
        return owned
      } finally {
        key.fill(0)
      }
    } finally {
      blob.fill(0)
    }
  }
  async wrap(key: Uint8Array): Promise<VaultSlotRecord> {
    return await wrapSlotKey({
      key,
      checkCapability: async () => {
        const capabilities = await linuxTpm2Capabilities(this.runner)
        if (!capabilities.hasDevice || !capabilities.canSeal) throw new VaultStoreUnavailableError()
      },
      invoke: async (owned) => ({ container: { sealed: await this.seal(owned) } }),
      accept: (container) => typeof container.sealed === 'string' && container.sealed !== '',
      record: (raw) => {
        let decoded: unknown
        try {
          decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
        } catch {
          throw new Error(UI_TEXT.vault.useChanged)
        }
        if (
          typeof decoded !== 'object' ||
          decoded === null ||
          typeof (decoded as { sealed?: unknown }).sealed !== 'string'
        )
          throw new Error(UI_TEXT.vault.useChanged)
        return this.record((decoded as { sealed: string }).sealed)
      },
    })
  }
  async unwrap(input: VaultSlotRecord, _use: string): Promise<Uint8Array> {
    const slot = vaultSlotRecordSchema.safeParse(input)
    if (
      !slot.success ||
      slot.data.id !== this.context.id ||
      slot.data.vaultId !== this.context.vaultId ||
      slot.data.tier !== this.tier ||
      slot.data.provider !== 'linuxTpm2' ||
      slot.data.keyReference !== this.context.id ||
      slot.data.kdf !== null ||
      slot.data.backend !== null
    )
      throw new VaultError('invalid')
    try {
      return await this.unseal(this.parseContainer(slot.data.wrappedKey))
    } catch (error: unknown) {
      if (error instanceof VaultError || error instanceof VaultStoreUnavailableError) throw error
      throw new VaultStoreUnavailableError()
    }
  }
  /** Setup cancellation/removal only; the sealed blob dies with the record. */
  remove(): Promise<void> {
    // The sealed blob lives inside the slot record: dropping the record
    // removes it. No TPM object persists on the machine.
    return Promise.resolve()
  }
}
