import { developerProfileSchema, type DeveloperProfile } from '../../shared/developerOptions'
import { DeveloperOptionsError } from './developerOptions'

export interface DeveloperProfileResources {
  start(profile: DeveloperProfile, isCurrent: () => boolean): Promise<void>
  stop(profile: DeveloperProfile): Promise<void>
  remove(profile: DeveloperProfile): Promise<void>
}
export interface LocalProfilePorts {
  // M109/K bind the slot to the real credential store. No credential is read
  // here, copied from another account, or supplied to the child launcher.
  readonly credentials: {
    prepare(slot: string, profile: DeveloperProfile): Promise<void>
    remove(slot: string): Promise<void>
  }
  readonly folders: {
    prepare(id: string): Promise<string>
    remove(id: string): Promise<void>
  }
  readonly runtime: {
    // The child resolves its slot through the parent-owned broker. This is
    // an identifier, not a credential/environment variable/command argument.
    start(config: {
      readonly deviceId: string
      readonly stateFolder: string
      readonly credentialSlot: string
      readonly profile: DeveloperProfile
    }): Promise<{ stop(): Promise<void> }>
  }
  readonly pool: {
    // Synchronous registration returns a synchronous withdrawal. Admission
    // MUST check admit immediately before dispatch, like paired receivers.
    register(device: {
      readonly id: string
      readonly profile: DeveloperProfile
      readonly admit: () => boolean
    }): () => void
  }
}

function slot(profile: DeveloperProfile): string {
  return `museSpark.developer.profile.${profile.id}.provider.${profile.provider}.account.${profile.account}`
}

/** One supervisor per machine owner. Missing runtime/broker/device bindings
 * are mandatory injected ports, never empty successful implementations. */
export class LocalDeveloperProfiles implements DeveloperProfileResources {
  private readonly running = new Map<
    string,
    {
      readonly process: { stop(): Promise<void> }
      readonly withdraw: (() => void) | undefined
      readonly admit: () => boolean
    }
  >()

  public constructor(private readonly ports: LocalProfilePorts) {}

  public async start(value: DeveloperProfile, isCurrent: () => boolean): Promise<void> {
    if (!isCurrent()) throw new DeveloperOptionsError('locked')
    const profile = developerProfileSchema.parse(value)
    const active = this.running.get(profile.id)
    if (active?.withdraw !== undefined && active.admit()) return
    if (active !== undefined) await this.stop(profile)
    const credentialSlot = slot(profile)
    await this.ports.credentials.prepare(credentialSlot, profile)
    try {
      if (!isCurrent()) throw new DeveloperOptionsError('locked')
      const stateFolder = await this.ports.folders.prepare(profile.id)
      if (!isCurrent()) throw new DeveloperOptionsError('locked')
      const deviceId = `local-${profile.id}`
      const process = await this.ports.runtime.start({
        deviceId,
        stateFolder,
        credentialSlot,
        profile,
      })
      this.running.set(profile.id, { process, withdraw: undefined, admit: isCurrent })
      if (!isCurrent()) throw new DeveloperOptionsError('locked')
      const withdraw = this.ports.pool.register({ id: deviceId, profile, admit: isCurrent })
      this.running.set(profile.id, { process, withdraw, admit: isCurrent })
    } catch (error) {
      await this.stop(profile)
      await this.ports.credentials.remove(credentialSlot)
      throw error
    }
  }

  public async stop(profile: DeveloperProfile): Promise<void> {
    const active = this.running.get(profile.id)
    if (active === undefined) return
    // Withdrawal precedes process cleanup, including a failed stop. Keep the
    // handle so a later Reset can retry stopping it rather than forget it.
    active.withdraw?.()
    await active.process.stop()
    this.running.delete(profile.id)
  }

  public async remove(profile: DeveloperProfile): Promise<void> {
    await this.stop(profile)
    await this.ports.credentials.remove(slot(profile))
    await this.ports.folders.remove(profile.id)
  }
}
