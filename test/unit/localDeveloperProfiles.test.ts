import { describe, expect, it, vi } from 'vitest'
import {
  LocalDeveloperProfiles,
  type LocalProfilePorts,
} from '../../src/core/developer/localProfiles'
import type { DeveloperProfile } from '../../src/shared/developerOptions'

function setup() {
  const devices = new Map<string, { admit: () => boolean }>()
  const processes: { stop: ReturnType<typeof vi.fn<() => Promise<void>>> }[] = []
  const ports: LocalProfilePorts = {
    credentials: {
      prepare: vi.fn<LocalProfilePorts['credentials']['prepare']>(() => Promise.resolve()),
      remove: vi.fn<LocalProfilePorts['credentials']['remove']>(() => Promise.resolve()),
    },
    folders: {
      prepare: vi.fn<LocalProfilePorts['folders']['prepare']>((id) =>
        Promise.resolve(`/machine/profiles/${id}`),
      ),
      remove: vi.fn<LocalProfilePorts['folders']['remove']>(() => Promise.resolve()),
    },
    runtime: {
      start: vi.fn<LocalProfilePorts['runtime']['start']>(() => {
        const process = { stop: vi.fn(() => Promise.resolve()) }
        processes.push(process)
        return Promise.resolve(process)
      }),
    },
    pool: {
      register: vi.fn<LocalProfilePorts['pool']['register']>((device) => {
        devices.set(device.id, device)
        return () => {
          devices.delete(device.id)
        }
      }),
    },
  }
  return { ports, processes, devices, resources: new LocalDeveloperProfiles(ports) }
}
const work: DeveloperProfile = { id: 'profile-work', provider: 'meta', account: 'work' }
const personal: DeveloperProfile = { id: 'profile-personal', provider: 'meta', account: 'personal' }

describe('isolated local Developer profiles', () => {
  it('gives each account its own credential slot, folder, process and local device', async () => {
    const h = setup()
    let isCurrent = true
    await h.resources.start(work, () => isCurrent)
    await h.resources.start(personal, () => isCurrent)
    const configs = vi.mocked(h.ports.runtime.start).mock.calls.map(([config]) => config)
    expect(new Set(configs.map((row) => row.credentialSlot)).size).toBe(2)
    expect(new Set(configs.map((row) => row.stateFolder)).size).toBe(2)
    expect(h.processes).toHaveLength(2)
    expect(h.devices.size).toBe(2)
    expect(h.devices.has('local-profile-work')).toBe(true)
    expect(h.devices.has('local-profile-personal')).toBe(true)
    expect(configs[0]).toEqual({
      deviceId: 'local-profile-work',
      stateFolder: '/machine/profiles/profile-work',
      credentialSlot: 'museSpark.developer.profile.profile-work.provider.meta.account.work',
      profile: work,
    })
    isCurrent = false
    for (const device of h.devices.values()) expect(device.admit()).toBe(false)
    await h.resources.stop(work)
    expect(h.devices.has('local-profile-work')).toBe(false)
    expect(h.processes[0]?.stop).toHaveBeenCalledTimes(1)
  })

  it('refuses stale authority before credential provisioning', async () => {
    const h = setup()
    await expect(h.resources.start(work, () => false)).rejects.toThrow()
    expect(h.ports.credentials.prepare).not.toHaveBeenCalled()
    expect(h.ports.runtime.start).not.toHaveBeenCalled()
  })

  it.each(['credentials', 'folders'] as const)(
    'refuses a stale continuation after preparing %s',
    async (boundary) => {
      const h = setup()
      let isValid = true
      if (boundary === 'credentials')
        vi.mocked(h.ports.credentials.prepare).mockImplementationOnce(() => {
          isValid = false
          return Promise.resolve()
        })
      else
        vi.mocked(h.ports.folders.prepare).mockImplementationOnce(() => {
          isValid = false
          return Promise.resolve('/machine/profiles/profile-work')
        })
      await expect(h.resources.start(work, () => isValid)).rejects.toThrow()
      expect(h.ports.runtime.start).not.toHaveBeenCalled()
      expect(h.ports.pool.register).not.toHaveBeenCalled()
    },
  )

  it('stops a late child instead of registering it after expiry or Reset', async () => {
    const h = setup()
    const start = Promise.withResolvers<{ stop: () => Promise<void> }>()
    let isValid = true
    const stop = vi.fn(() => Promise.resolve())
    vi.mocked(h.ports.runtime.start).mockReturnValueOnce(start.promise)
    const starting = h.resources.start(work, () => isValid)
    const refused = expect(starting).rejects.toThrow()
    await vi.waitFor(() => {
      expect(h.ports.runtime.start).toHaveBeenCalled()
    })
    isValid = false
    start.resolve({ stop })
    await refused
    expect(stop).toHaveBeenCalledTimes(1)
    expect(h.ports.pool.register).not.toHaveBeenCalled()
  })

  it('stops the child if local-device registration fails', async () => {
    const h = setup()
    vi.mocked(h.ports.pool.register).mockImplementationOnce(() => {
      throw new Error('pool unavailable')
    })
    await expect(h.resources.start(work, () => true)).rejects.toThrow('pool unavailable')
    expect(h.processes[0]?.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed child stop for retry, withdraws it before the await and never deletes live state', async () => {
    const h = setup()
    await h.resources.start(work, () => true)
    const process = h.processes[0]
    expect(process).toBeDefined()
    if (process === undefined) throw new Error('missing test process')
    process.stop.mockRejectedValueOnce(new Error('stop failed'))
    await expect(h.resources.remove(work)).rejects.toThrow('stop failed')
    expect(h.devices.size).toBe(0)
    expect(h.ports.credentials.remove).not.toHaveBeenCalled()
    expect(h.ports.folders.remove).not.toHaveBeenCalled()
    await h.resources.remove(work)
    expect(process.stop).toHaveBeenCalledTimes(2)
    expect(h.ports.credentials.remove).toHaveBeenCalledWith(
      'museSpark.developer.profile.profile-work.provider.meta.account.work',
    )
    expect(h.ports.folders.remove).toHaveBeenCalledWith(work.id)
  })

  it('reuses an active profile process and cleans recorded resources when it never started', async () => {
    const h = setup()
    await h.resources.start(work, () => true)
    await h.resources.start(work, () => true)
    expect(h.ports.runtime.start).toHaveBeenCalledTimes(1)
    await h.resources.remove(personal)
    expect(h.ports.credentials.remove).toHaveBeenCalledTimes(1)
    expect(h.ports.folders.remove).toHaveBeenCalledWith(personal.id)
  })
})
