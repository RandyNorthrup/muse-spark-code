import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { isIP } from 'node:net'
import * as z from 'zod/mini'
import { limitsSchema } from './gcode/limits'

import type { MakerSecrets } from './ports'

export interface MachineStorage {
  /** Canonical per-user data directory, shared by every editor/runtime. */
  readonly directory: string
  read(): Promise<unknown>
  /** Called only with the directory's registry lock held. No unconditional writes. */
  compareAndSwap(revision: number, records: readonly MachineRecord[]): Promise<boolean>
}
export const machineRecordSchema = z.strictObject({
  registrationId: z.uuid(),
  id: z.string().check(z.regex(/^[\w-]+$/)),
  name: z.string().check(z.minLength(1)),
  kind: z.enum(['moonraker', 'octoprint', 'prusalink', 'grbl', 'fluidnc', 'marlin']),
  category: z.enum(['printer', 'cnc', 'laser', 'robot']),
  endpoint: z.string().check(z.minLength(1)),
  allowPlainHttp: z.boolean(),
  limits: limitsSchema,
  credentialPendingRemoval: z.optional(z.literal(true)),
})
export type MachineRecord = z.infer<typeof machineRecordSchema>
const recordsSchema = z
  .array(machineRecordSchema)
  .check(
    z.refine(
      (records) =>
        new Set(records.map((record) => record.id)).size === records.length &&
        new Set(records.map((record) => record.registrationId)).size === records.length,
    ),
  )

export class MachineError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
const snapshotSchema = z.strictObject({
  revision: z.number().check(z.int(), z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER)),
  records: recordsSchema,
})
const registrationSchema = z.strictObject({
  ...machineRecordSchema.shape,
  registrationId: z.optional(z.uuid()),
})
export function machineSecretName(registrationId: string): string {
  return `maker.machine.${machineRecordSchema.shape.registrationId.parse(registrationId)}`
}

/** Atomic, owner-only persistence; the registry owns the cross-process writer lock. */
export class FileMachineStorage implements MachineStorage {
  constructor(readonly directory: string) {}
  async read(): Promise<unknown> {
    let handle
    try {
      handle = await open(
        path.join(this.directory, 'machines.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { revision: 0, records: [] }
      throw error
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1) throw new MachineError('machineStorageFile')
      const bytes = await handle.readFile()
      const text = bytes.toString('utf8')
      const input: unknown = JSON.parse(text)
      return snapshotSchema.parse(input)
    } finally {
      await handle.close()
    }
  }
  async compareAndSwap(revision: number, records: readonly MachineRecord[]): Promise<boolean> {
    const current = snapshotSchema.parse(await this.read())
    if (current.revision !== revision) return false
    const next = snapshotSchema.parse({ revision: revision + 1, records })
    const temporary = path.join(this.directory, `machines-${randomUUID()}.json`)
    const handle = await open(temporary, 'wx', constants.S_IRUSR | constants.S_IWUSR)
    try {
      await handle.writeFile(JSON.stringify(next))
      await handle.sync()
      await handle.close()
      await rename(temporary, path.join(this.directory, 'machines.json'))
      return true
    } finally {
      await handle.close()
      await rm(temporary, { force: true })
    }
  }
}

/** Browser safety reads only validated registrations, never their secrets. */
export async function registeredMachineEndpoints(directory: string): Promise<readonly string[]> {
  const snapshot = snapshotSchema.parse(await new FileMachineStorage(directory).read())
  return snapshot.records
    .filter(
      (record) =>
        ['moonraker', 'octoprint', 'prusalink'].includes(record.kind) ||
        /^https?:\/\//.test(record.endpoint),
    )
    .map((record) => record.endpoint)
}

/** Host-only mutations, under one fail-closed OS lock and a revision CAS. */
export class MachineRegistry {
  private pending: Promise<void> = Promise.resolve()
  constructor(
    private readonly storage: MachineStorage,
    private readonly secrets: MakerSecrets,
    private readonly lan: MakerLanPolicy,
  ) {}
  private mutate(operation: () => Promise<void>): Promise<void> {
    const previous = this.pending
    const result = (async () => {
      await previous
      await mkdir(this.storage.directory, {
        recursive: true,
        mode: constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR,
      })
      const lockPath = path.join(this.storage.directory, 'machines.lock')
      // Never steal/reap a stale lock: an old writer must not resume after a new one.
      const lock = await open(lockPath, 'wx', constants.S_IRUSR | constants.S_IWUSR)
      try {
        await operation()
      } finally {
        await lock.close()
        await rm(lockPath)
      }
    })()
    this.pending = (async () => {
      try {
        await result
      } catch {
        return
      }
    })()
    return result
  }
  private async snapshot() {
    return snapshotSchema.parse(await this.storage.read())
  }
  private async commit(revision: number, records: readonly MachineRecord[]): Promise<void> {
    if (!(await this.storage.compareAndSwap(revision, records)))
      throw new MachineError('machineRegistryChanged')
  }
  async list(): Promise<readonly MachineRecord[]> {
    const snapshot = await this.snapshot()
    return snapshot.records
  }
  async get(id: string): Promise<MachineRecord> {
    const records = await this.list()
    const record = records.find((entry) => entry.id === id)
    if (record === undefined) throw new MachineError('unregisteredMachine')
    if (record.credentialPendingRemoval) throw new MachineError('credentialPendingRemoval')
    return record
  }
  register(input: unknown, key?: string): Promise<void> {
    return this.mutate(async () => {
      const record = { ...registrationSchema.parse(input), registrationId: randomUUID() }
      if (record.credentialPendingRemoval) throw new MachineError('credentialPendingRemoval')
      if (['grbl', 'fluidnc'].includes(record.kind) && record.category === 'printer') {
        throw new MachineError('machineCategory')
      }
      if (['moonraker', 'octoprint', 'prusalink'].includes(record.kind))
        await machineTarget(record, this.lan)
      const { revision, records } = await this.snapshot()
      if (records.some((entry) => entry.id === record.id))
        throw new MachineError('duplicateMachine')
      // Reserve cleanup ownership before a secret write. Readers refuse it.
      await this.commit(revision, [...records, { ...record, credentialPendingRemoval: true }])
      try {
        if (key !== undefined)
          await this.secrets.store(machineSecretName(record.registrationId), key)
        await this.commit(revision + 1, [...records, record])
      } catch (error) {
        await this.secrets.delete(machineSecretName(record.registrationId))
        await this.commit(revision + 1, records)
        throw error
      }
    })
  }
  remove(id: string): Promise<void> {
    return this.mutate(async () => {
      const { revision, records } = await this.snapshot()
      const record = records.find((entry) => entry.id === id)
      if (record === undefined) return
      await this.commit(
        revision,
        records.map((entry) =>
          entry.id === id ? { ...entry, credentialPendingRemoval: true } : entry,
        ),
      )
      await this.secrets.delete(machineSecretName(record.registrationId))
      await this.commit(
        revision + 1,
        records.filter((entry) => entry.id !== id),
      )
    })
  }
}

/** Adapter for the planned endpointPolicy classifier. Only its private lane is admitted. */
export interface MakerLanPolicy {
  classify(
    address: string,
  ): 'private' | 'public' | 'loopback' | 'linkLocal' | 'metadata' | 'reserved'
  resolve(host: string): Promise<readonly string[]>
}
export interface MachineTarget {
  readonly url: URL
  readonly address: string
}

/** Re-resolve every request, reject mixed answers, and pin the selected private IP. */
export async function machineTarget(
  record: MachineRecord,
  policy: MakerLanPolicy,
): Promise<MachineTarget> {
  const url = new URL(record.endpoint)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/'
  )
    throw new MachineError('machineEndpoint')
  if (url.protocol === 'http:' && !record.allowPlainHttp)
    throw new MachineError('plainHttpWarningRequired')
  const host = url.hostname.replaceAll(/^\[|\]$/g, '')
  const answers = isIP(host) === 0 ? await policy.resolve(host) : [host]
  if (
    answers.length === 0 ||
    answers.some((address) => isIP(address) === 0 || policy.classify(address) !== 'private')
  ) {
    throw new MachineError('machineAddress')
  }
  const address = answers[0]
  if (address === undefined) throw new MachineError('machineAddress')
  return { url, address }
}
