import { isIP } from 'node:net'
import * as z from 'zod/mini'
import { limitsSchema } from './gcode/limits'

/** Structural slice of MakerHost.secrets, until lane I's full port lands. */
export interface MakerSecrets {
  get(name: string): Promise<string | undefined>
  store(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}
export interface MachineStorage {
  read(): Promise<unknown>
  write(records: readonly MachineRecord[]): Promise<void>
}
export const machineRecordSchema = z.strictObject({
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
  .check(z.refine((records) => new Set(records.map((record) => record.id)).size === records.length))

export class MachineError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
export function machineSecretName(id: string): string {
  return `maker.machine.${machineRecordSchema.shape.id.parse(id)}`
}

/** Host-owned machine storage. Register/remove are user commands, never model tools. */
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
      await operation()
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
  async list(): Promise<readonly MachineRecord[]> {
    const stored = await this.storage.read()
    return recordsSchema.parse(stored ?? [])
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
      const record = machineRecordSchema.parse(input)
      if (record.credentialPendingRemoval) throw new MachineError('credentialPendingRemoval')
      if (['grbl', 'fluidnc'].includes(record.kind) && record.category === 'printer') {
        throw new MachineError('machineCategory')
      }
      if (['moonraker', 'octoprint', 'prusalink'].includes(record.kind))
        await machineTarget(record, this.lan)
      const records = await this.list()
      if (records.some((entry) => entry.id === record.id))
        throw new MachineError('duplicateMachine')
      // Reserve the id durably before touching credentials. Failed cleanup
      // must leave a blocked record, including after a failed registration.
      await this.storage.write([...records, { ...record, credentialPendingRemoval: true }])
      await this.secrets.delete(machineSecretName(record.id))
      try {
        if (key !== undefined) await this.secrets.store(machineSecretName(record.id), key)
        await this.storage.write([...records, record])
      } catch (error) {
        await this.secrets.delete(machineSecretName(record.id))
        await this.storage.write(records)
        throw error
      }
    })
  }
  remove(id: string): Promise<void> {
    return this.mutate(async () => {
      const records = await this.list()
      await this.storage.write(
        records.map((entry) =>
          entry.id === id ? { ...entry, credentialPendingRemoval: true } : entry,
        ),
      )
      await this.secrets.delete(machineSecretName(id))
      await this.storage.write(records.filter((entry) => entry.id !== id))
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
