import { execFile } from 'node:child_process'
import { chmod, lstat, mkdtemp, open, realpath, rename, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach } from 'vitest'
import type { DeviceStore } from '../../../src/host/devices/deviceStore'
import type { DeviceStorageProtection } from '../../../src/core/devices/storageProtection'
import { startWindowsStorageProtection } from '../../../src/host/devices/windowsStorageProtection'
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import type { DeviceGrant } from '../../../src/core/devices/grants'
import type { DeviceDispatch } from '../../../src/shared/devices'

export const deviceCaps = {
  workers: 2,
  processes: 2,
  heavyChecks: 1,
  tokens: 100,
  spendUsd: 1,
  artifactBytes: 100,
}
export function deviceGrant(pairId: string, deviceId = 'a'.repeat(32)): DeviceGrant {
  return {
    pairId,
    offer: {
      deviceId,
      receiverIncarnationId: '1'.repeat(32),
      poolId: '2'.repeat(32),
      repositoryId: '3'.repeat(32),
      grantId: '4'.repeat(32),
      grantRevision: 1,
      platform: 'linux',
      toolchainDigest: '5'.repeat(64),
      lanes: true,
      checks: true,
      caps: deviceCaps,
      entries: [
        {
          entryId: '6'.repeat(32),
          roleId: '7'.repeat(32),
          model: { providerId: 'meta', modelId: 'muse-spark-1.3' },
          capabilities: {
            vision: false,
            tools: true,
            structuredOutput: false,
            hostedSearch: false,
            reasoningEffort: false,
          },
          readiness: 'ready',
          payer: 'apiKey',
          caps: deviceCaps,
        },
      ],
      checkIds: ['8'.repeat(32)],
    },
    snapshot: { baseCommit: '9'.repeat(40), tree: 'a'.repeat(40), manifestDigest: 'b'.repeat(64) },
    modes: ['manual'],
  }
}
export function deviceCheck(grant: DeviceGrant): DeviceDispatch {
  return {
    kind: 'check',
    identity: {
      pairId: grant.pairId,
      receiverIncarnationId: grant.offer.receiverIncarnationId,
      boardId: 'c'.repeat(32),
      taskId: 'd'.repeat(32),
      attemptId: 'e'.repeat(32),
    },
    payloadDigest: 'f'.repeat(64),
    repositoryId: grant.offer.repositoryId,
    grantId: grant.offer.grantId,
    grantRevision: grant.offer.grantRevision,
    snapshot: grant.snapshot,
    caps: deviceCaps,
    mode: 'manual',
    checkId: grant.offer.checkIds[0]!,
    toolchainDigest: grant.offer.toolchainDigest,
  }
}
export function deviceLane(grant: DeviceGrant): DeviceDispatch {
  const entry = grant.offer.entries[0]!
  const check = deviceCheck(grant)
  return {
    kind: 'lane',
    identity: check.identity,
    payloadDigest: check.payloadDigest,
    repositoryId: check.repositoryId,
    grantId: check.grantId,
    grantRevision: check.grantRevision,
    snapshot: check.snapshot,
    caps: check.caps,
    mode: check.mode,
    route: {
      pairId: grant.pairId,
      deviceId: grant.offer.deviceId,
      receiverIncarnationId: grant.offer.receiverIncarnationId,
      poolId: grant.offer.poolId,
      entryId: entry.entryId,
      model: entry.model,
    },
    roleId: entry.roleId,
    isolation: 'own-branch',
    brief: 'Bounded fake-only task',
    plannedWrites: [],
  }
}
export const deviceTestNow = Date.UTC(2026, 9, 6)
export const deviceTestExpiry = deviceTestNow + DEVICE_LIMITS.invitationValidityMs * 100

export async function removeDeviceFixture(stores: DeviceStore[], parent: string): Promise<void> {
  for (const store of stores.splice(0)) {
    try {
      await store.close()
    } catch {
      continue
    }
  }
  await rm(parent, { recursive: true, force: true })
}

const run = promisify(execFile)
const windowsBinding: { current?: Promise<DeviceStorageProtection> } = {}
/**
 * Each OS's production storage configuration: the real native binding on
 * Windows (its helper compiled once into a shared temp cache), and no binding
 * elsewhere, where POSIX owner/mode checks and directory fsync apply.
 */
export async function deviceStorage(): Promise<DeviceStorageProtection | undefined> {
  if (process.platform !== 'win32') return undefined
  windowsBinding.current ??= (async () => {
    const binding = await startWindowsStorageProtection({
      directory: path.join(tmpdir(), 'muse-spark-device-storage-test'),
      systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
    })
    return binding.protection
  })()
  return await windowsBinding.current
}
/** A temp root this test owns: mkdtemp is 0700 on POSIX; Windows claims it as a store folder. */
export async function privateDeviceRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  const storage = await deviceStorage()
  await storage?.secureFresh(root, true)
  return root
}
/** Per test: a fresh private root, this OS's storage binding, and store cleanup. */
export function useDeviceStorageRoot(prefix: string) {
  const fixture: { parent: string; storage: DeviceStorageProtection | undefined } = {
    parent: '',
    storage: undefined,
  }
  const stores: DeviceStore[] = []
  beforeEach(async () => {
    fixture.storage = await deviceStorage()
    fixture.parent = await privateDeviceRoot(prefix)
  })
  afterEach(async () => {
    await removeDeviceFixture(stores, fixture.parent)
  })
  return { fixture, stores }
}
// Windows' Everyone group: a principal other than the owner.
const EVERYONE = '*S-1-1-0'
/**
 * Lets another principal read `target` (or, with `canReplaceEntries`, also
 * delete and add its entries), through each OS's own permission model, on a
 * path the test created. `restore` undoes exactly that grant.
 */
export async function grantOthers(
  target: string,
  kind: 'file' | 'directory' | 'parent',
): Promise<{ restore: () => Promise<void> }> {
  if (process.platform === 'win32') {
    await run('icacls', [target, '/grant', `${EVERYONE}:(${kind === 'parent' ? 'DC,AD,WD' : 'R'})`])
    return {
      restore: async () => {
        await run('icacls', [target, '/remove:g', EVERYONE])
      },
    }
  }
  const modes: Record<typeof kind, readonly [number, number]> = {
    file: [0o644, 0o600],
    directory: [0o755, 0o700],
    parent: [0o777, 0o700],
  }
  const [open, closed] = modes[kind]
  await chmod(target, open)
  return {
    restore: async () => {
      await chmod(target, closed)
    },
  }
}
/**
 * A reparse alias any account may create at `at`: a symlink to `target`, or
 * on Windows a junction (to `target`'s folder when it is a file), since file
 * symlinks need a privilege there.
 */
export async function reparseAlias(target: string, at: string): Promise<void> {
  if (process.platform !== 'win32') {
    await symlink(target, at)
    return
  }
  const info = await lstat(target)
  const folder = info.isDirectory() ? target : path.dirname(target)
  await symlink(folder, at, 'junction')
}
/**
 * Each OS's independent reading of owner-only access: POSIX mode bits, or
 * .NET's SDDL through Windows PowerShell (owner and one explicit, protected
 * full-control rule). .NET, not Get-Acl: a runner's PowerShell 7 module path
 * can stop Windows PowerShell autoloading its security module.
 */
export async function ownerOnlyEvidence(target: string, isDirectory: boolean): Promise<string> {
  if (process.platform !== 'win32') {
    const info = await stat(target)
    return (info.mode & 0o777).toString(8)
  }
  const reader = isDirectory ? 'Directory' : 'File'
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      String.raw`$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $sddl = [IO.${reader}]::GetAccessControl($env:MUSE_TEST_TARGET).GetSecurityDescriptorSddlForm('Owner, Access'); if ($sddl -match ('^O:' + $sid + 'D:PA?I?\(A;' + $env:MUSE_TEST_FLAGS + ';FA;;;' + $sid + '\)$')) { 'owner-only' } else { 'not owner-only: ' + $sddl }`,
    ],
    {
      env: { ...process.env, MUSE_TEST_TARGET: target, MUSE_TEST_FLAGS: isDirectory ? 'OICI' : '' },
    },
  )
  return stdout.trim() === 'owner-only' ? (isDirectory ? '700' : '600') : stdout.trim()
}

type ProtectionStep = keyof DeviceStorageProtection
/**
 * The shared fake binding: it records each step and refuses the ones it is
 * told to. Otherwise it round-trips through `base` (the real Windows binding
 * when a test wants real behaviour underneath) or the real filesystem.
 */
export function fakeDeviceStorage(base?: DeviceStorageProtection) {
  const refused = new Set<ProtectionStep>()
  const calls: ProtectionStep[] = []
  const step = (name: ProtectionStep) => {
    calls.push(name)
    return refused.has(name) ? Promise.reject(new Error('protection-sentinel')) : Promise.resolve()
  }
  const protection: DeviceStorageProtection = {
    async assertPrivate(file, isDirectory) {
      await step('assertPrivate')
      await base?.assertPrivate(file, isDirectory)
    },
    async assertSafeAncestor(directory) {
      await step('assertSafeAncestor')
      await base?.assertSafeAncestor(directory)
    },
    async secureFresh(file, isDirectory) {
      await step('secureFresh')
      await base?.secureFresh(file, isDirectory)
    },
    async replace(stage, target) {
      await step('replace')
      await (base === undefined ? rename(stage, target) : base.replace(stage, target))
    },
    async syncDirectory(directory) {
      await step('syncDirectory')
      if (base !== undefined) await base.syncDirectory(directory)
      else if (process.platform !== 'win32') {
        const handle = await open(directory, 'r')
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
    },
  }
  return {
    protection,
    calls,
    refuse(name: ProtectionStep) {
      refused.add(name)
    },
  }
}
