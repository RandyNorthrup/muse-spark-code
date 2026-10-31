// M108 X local profiles over real modules: the supervisor drives the real
// slot registry and state folders, and the test's runtime port spawns real
// OS processes (this node running a keepalive) so start/stop signal
// handling is proven, not scripted. Strays are killed in cleanup.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeveloperOptionsError } from '../../src/core/developer/developerOptions'
import {
  LocalDeveloperProfiles,
  profileCredentialSlot,
  type LocalProfilePorts,
} from '../../src/core/developer/localProfiles'
import { DeveloperLocalFiles } from '../../src/runtime/developer/localFiles'
import { DEVELOPER_FILES, UI_TEXT } from '../../src/shared/constants'
import type { DeveloperProfile } from '../../src/shared/developerOptions'

const CHILD_EXIT_BUDGET_MS = 10_000
const CHILD_POLL_MS = 10
const folders: string[] = []
const children: ChildProcess[] = []
afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone; the test below still owns its own assertions.
    }
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function scratch(): string {
  mkdirSync('temp', { recursive: true })
  const folder = mkdtempSync(path.join('temp', 'developer-profiles-'))
  folders.push(folder)
  return folder
}

async function waitExit(child: ChildProcess): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) return
    if (Date.now() - startedAt > CHILD_EXIT_BUDGET_MS) throw new Error('child did not exit')
    await new Promise((resolve) => {
      setTimeout(resolve, CHILD_POLL_MS)
    })
  }
}

/** A real registry: it keeps devices, it does not script them. */
function livePool(): LocalProfilePorts['pool'] & {
  size(): number
  deviceIds(): string[]
} {
  const devices = new Map<string, () => boolean>()
  const ids: string[] = []
  return {
    register: (device) => {
      devices.set(device.id, device.admit)
      ids.push(device.id)
      return () => {
        devices.delete(device.id)
        const at = ids.indexOf(device.id)
        if (at !== -1) ids.splice(at, 1)
      }
    },
    size: () => devices.size,
    deviceIds: () => [...ids],
  }
}

/** A real runtime: each profile gets its own OS process. */
function liveRuntime(): LocalProfilePorts['runtime'] {
  return {
    start: (_config) => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      })
      children.push(child)
      return Promise.resolve({
        stop: async () => {
          child.kill('SIGTERM')
          await waitExit(child)
        },
      })
    },
  }
}

const work: DeveloperProfile = { id: 'profile-work', provider: 'meta', account: 'work' }
const personal: DeveloperProfile = {
  id: 'profile-personal',
  provider: 'meta',
  account: 'personal',
}

function slotsOf(folder: string): Record<string, string> {
  const file = path.join(folder, 'developer', DEVELOPER_FILES.slots)
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { slots: Record<string, string> }).slots
    : {}
}

function folderOf(folder: string, id: string): string {
  return path.join(folder, 'developer', 'profiles', id)
}

function byString(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error: unknown) {
    return error
  }
  throw new Error('the refused call unexpectedly succeeded')
}

describe('M108 X local profiles', () => {
  it('starts a profile with its own slot, folder, process and local device', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    const pool = livePool()
    const resources = new LocalDeveloperProfiles({
      credentials: {
        prepare: (slot, profile) => files.prepareSlot(slot, profile),
        remove: (slot) => files.removeSlot(slot),
      },
      folders: files,
      runtime: liveRuntime(),
      pool,
    })
    await resources.start(work, () => true)
    await resources.start(personal, () => true)
    expect(slotsOf(folder)).toEqual({
      [profileCredentialSlot(work)]: 'profile-work',
      [profileCredentialSlot(personal)]: 'profile-personal',
    })
    expect(existsSync(folderOf(folder, 'profile-work'))).toBe(true)
    expect(existsSync(folderOf(folder, 'profile-personal'))).toBe(true)
    expect(children).toHaveLength(2)
    expect(children.every((child) => child.exitCode === null)).toBe(true)
    expect(pool.deviceIds().toSorted(byString)).toEqual([
      'local-profile-personal',
      'local-profile-work',
    ])
    await resources.stop(work)
    await resources.stop(personal)
  })

  it('treats a second start while admitted as a no-op', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    const pool = livePool()
    const resources = new LocalDeveloperProfiles({
      credentials: {
        prepare: (slot, profile) => files.prepareSlot(slot, profile),
        remove: (slot) => files.removeSlot(slot),
      },
      folders: files,
      runtime: liveRuntime(),
      pool,
    })
    const before = children.length
    await resources.start(work, () => true)
    await resources.start(work, () => true)
    expect(children.length - before).toBe(1)
    expect(pool.size()).toBe(1)
    await resources.stop(work)
  })

  it('stops the device and the process but keeps the slot until removal', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    const pool = livePool()
    const resources = new LocalDeveloperProfiles({
      credentials: {
        prepare: (slot, profile) => files.prepareSlot(slot, profile),
        remove: (slot) => files.removeSlot(slot),
      },
      folders: files,
      runtime: liveRuntime(),
      pool,
    })
    await resources.start(work, () => true)
    const child = children.at(-1)
    if (child === undefined) throw new Error('no child was spawned')
    await resources.stop(work)
    expect(pool.size()).toBe(0)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    // The reservation outlives the stop: only removal releases it.
    expect(slotsOf(folder)[profileCredentialSlot(work)]).toBe('profile-work')
    await resources.remove(work)
    expect(slotsOf(folder)).toEqual({})
    expect(existsSync(folderOf(folder, 'profile-work'))).toBe(false)
  })

  it('rolls a refused launch back and restarts after a stop', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    const production = files.resources()
    const failure = await failureOf(production.start(work, () => true))
    expect((failure as Error).message).toBe(UI_TEXT.developer.unavailable)
    // The rollback released the slot; the folder stays for removal.
    expect(slotsOf(folder)).toEqual({})
    expect(existsSync(folderOf(folder, 'profile-work'))).toBe(true)
    await production.remove(work)
    expect(existsSync(folderOf(folder, 'profile-work'))).toBe(false)
    // A live supervisor restarts cleanly after a stop.
    const pool = livePool()
    const resources = new LocalDeveloperProfiles({
      credentials: {
        prepare: (slot, profile) => files.prepareSlot(slot, profile),
        remove: (slot) => files.removeSlot(slot),
      },
      folders: files,
      runtime: liveRuntime(),
      pool,
    })
    const before = children.length
    await resources.start(work, () => true)
    await resources.stop(work)
    await resources.start(work, () => true)
    expect(children.length - before).toBe(2)
    const first = children[before]
    if (first === undefined) throw new Error('no child was spawned')
    expect(first.exitCode !== null || first.signalCode !== null).toBe(true)
    await resources.stop(work)
  })

  it('refuses a stale owner before touching anything', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    const pool = livePool()
    const resources = new LocalDeveloperProfiles({
      credentials: {
        prepare: (slot, profile) => files.prepareSlot(slot, profile),
        remove: (slot) => files.removeSlot(slot),
      },
      folders: files,
      runtime: liveRuntime(),
      pool,
    })
    const before = children.length
    const failure = await failureOf(resources.start(work, () => false))
    expect(failure).toBeInstanceOf(DeveloperOptionsError)
    expect((failure as DeveloperOptionsError).code).toBe('locked')
    expect(children.length - before).toBe(0)
    expect(slotsOf(folder)).toEqual({})
    expect(existsSync(folderOf(folder, 'profile-work'))).toBe(false)
    expect(pool.size()).toBe(0)
  })

  it('guards the slot registry against confusion and corruption', async () => {
    const folder = scratch()
    const files = new DeveloperLocalFiles(`${folder}/developer`)
    await files.prepareSlot(profileCredentialSlot(work), work)
    // Re-preparing the same mapping is idempotent.
    await files.prepareSlot(profileCredentialSlot(work), work)
    // The slot must be exactly the profile's derived name.
    const confused = await failureOf(files.prepareSlot(profileCredentialSlot(work), personal))
    expect((confused as Error).message).toBe(UI_TEXT.developer.unavailable)
    // Removing an unknown slot resolves.
    await files.removeSlot(profileCredentialSlot(personal))
    expect(slotsOf(folder)).toEqual({ [profileCredentialSlot(work)]: 'profile-work' })
    await files.removeSlot(profileCredentialSlot(work))
    expect(slotsOf(folder)).toEqual({})
    // A corrupt registry refuses in fixed words.
    writeFileSync(path.join(folder, 'developer', DEVELOPER_FILES.slots), '{broken')
    const corrupt = await failureOf(files.prepareSlot(profileCredentialSlot(work), work))
    expect((corrupt as Error).message).toBe(UI_TEXT.developer.unavailable)
  })
})
