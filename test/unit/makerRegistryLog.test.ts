import type { MakerSecrets } from '../../src/core/maker/ports'
import { Buffer } from 'node:buffer'
import { fork } from 'node:child_process'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile, link } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REGISTRY_PROCESS_MARKER } from './helpers/makerRegistryProcess'
import { DeviceLog, payloadDigest } from '../../src/core/maker/deviceLog'
import {
  MachineRegistry,
  FileMachineStorage,
  machineRecordSchema,
  machineSecretName,
  machineTarget,
  registeredMachineEndpoints,
  type MachineRecord,
  type MakerLanPolicy,
} from '../../src/core/maker/registry'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
const privateLan: MakerLanPolicy = {
  classify: (address) => (address.startsWith('192.168.') ? 'private' : 'public'),
  resolve: () => Promise.resolve(['192.168.1.2']),
}
function machine(): MachineRecord {
  return {
    registrationId: '11111111-1111-4111-8111-111111111111',
    id: 'printer',
    name: 'Virtual',
    kind: 'moonraker',
    category: 'printer',
    endpoint: 'https://printer.local',
    allowPlainHttp: false,
    limits: {},
  }
}
async function registry() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maker-registry-'))
  directories.push(directory)
  let stored: unknown = { revision: 0, records: [] }
  let revision = 0
  const write = vi.fn((expected: number, records: readonly MachineRecord[]) => {
    if (expected !== revision) return Promise.resolve(false)
    revision += 1
    stored = { revision, records: structuredClone(records) }
    return Promise.resolve(true)
  })
  const values = new Map<string, string>()
  const secrets: MakerSecrets = {
    get: (name) => Promise.resolve(values.get(name)),
    store: (name, value) => {
      values.set(name, value)
      return Promise.resolve()
    },
    delete: (name) => {
      values.delete(name)
      return Promise.resolve()
    },
  }
  return {
    registry: new MachineRegistry(
      { directory, read: () => Promise.resolve(stored), compareAndSwap: write },
      secrets,
      privateLan,
    ),
    values,
    secrets,
    write,
    setRecords(input: unknown) {
      stored = { revision, records: input }
    },
  }
}
describe('maker registry boundaries', () => {
  it('stores keys only through the host secret port and rejects unregistered machines', async () => {
    const { registry: records, values, write } = await registry(),
      key = randomUUID()
    await records.register(machine(), key)
    expect(JSON.stringify(write.mock.calls).includes(key)).toBe(false)
    const captured0 = await records.get('printer')
    expect(values.has(machineSecretName(captured0.registrationId))).toBe(true)
    expect(captured0.name).toBe('Virtual')
    await expect(records.get('unregistered')).rejects.toThrow('unregisteredMachine')
    await records.remove('printer')

    expect(values.size).toBe(0)
    const captured1 = await records.list()
    expect(captured1).toEqual([])
  })
  it('refuses secrets in records, duplicates and GRBL pretending to be a printer', async () => {
    const { registry: records, setRecords } = await registry()
    await expect(records.register({ ...machine(), apiKey: randomUUID() })).rejects.toThrow()
    await expect(records.register({ ...machine(), kind: 'grbl' })).rejects.toThrow(
      'machineCategory',
    )
    await records.register(machine())
    await expect(records.register(machine())).rejects.toThrow('duplicateMachine')
    setRecords([machine(), machine()])
    await expect(records.list()).rejects.toThrow()
    setRecords([machine(), { ...machine(), id: 'second' }])
    await expect(records.list()).rejects.toThrow()
    expect(machineRecordSchema.safeParse({ ...machine(), limits: { feedMmMin: -1 } }).success).toBe(
      false,
    )
  })
  it('refuses public registration, empty DNS and embedded URL credentials', async () => {
    const { registry: records } = await registry()
    await expect(records.register({ ...machine(), endpoint: 'https://8.8.8.8' })).rejects.toThrow(
      'machineAddress',
    )
    await expect(
      machineTarget(machine(), { ...privateLan, resolve: () => Promise.resolve([]) }),
    ).rejects.toThrow('machineAddress')
    await expect(
      records.register({ ...machine(), endpoint: 'https://user:password@printer.local' }),
    ).rejects.toThrow('machineEndpoint')
  })
  it('serializes concurrent registry mutations and rolls back a failed new secret', async () => {
    const { registry: records, values, write } = await registry()
    write.mockRejectedValueOnce(new Error('diskFull'))
    await expect(records.register(machine(), randomUUID())).rejects.toThrow('diskFull')

    expect(values.size).toBe(0)
    await Promise.all([
      records.register(machine()),
      records.register({ ...machine(), id: 'second' }),
    ])
    const captured2 = await records.list()
    expect(captured2).toHaveLength(2)
  })
  it('keeps failed credential removal pending, blocks reuse and retries deletion', async () => {
    const { registry: records, values, secrets, write } = await registry()
    const key = randomUUID()
    await records.register(machine(), key)
    const registered = await records.get('printer')
    const deletion = vi.spyOn(secrets, 'delete').mockRejectedValueOnce(new Error('storeLocked'))
    await expect(records.remove('printer')).rejects.toThrow('storeLocked')
    expect(await records.list()).toMatchObject([{ id: 'printer', credentialPendingRemoval: true }])
    await expect(records.get('printer')).rejects.toThrow('credentialPendingRemoval')
    await expect(
      records.register({ ...machine(), endpoint: 'https://second.local' }),
    ).rejects.toThrow('duplicateMachine')
    expect(values.has(machineSecretName(registered.registrationId))).toBe(true)
    await records.remove('printer')
    expect(deletion).toHaveBeenCalledTimes(2)
    expect(values.size).toBe(0)
    expect(await records.list()).toEqual([])
    expect(JSON.stringify(write.mock.calls).includes(key)).toBe(false)
  })
  it('does not delete a secret until the pending-removal record is durable', async () => {
    const { registry: records, values, secrets, write } = await registry()
    await records.register(machine(), randomUUID())
    const deletion = vi.spyOn(secrets, 'delete')
    write.mockRejectedValueOnce(new Error('diskFull'))
    await expect(records.remove('printer')).rejects.toThrow('diskFull')
    expect(deletion).not.toHaveBeenCalled()
    expect(values.size).toBe(1)
    expect(await records.get('printer')).toMatchObject({ id: 'printer', name: 'Virtual' })
  })
  it('isolates replacement credentials by registration identity and never reuses an orphan', async () => {
    const { registry: records, values, secrets } = await registry()
    const orphan = machineSecretName(machine().registrationId)
    values.set(orphan, randomUUID())
    const deletion = vi.spyOn(secrets, 'delete')
    await records.register(machine())
    const first = await records.get('printer')
    expect(first.registrationId).not.toBe(machine().registrationId)
    expect(values.has(machineSecretName(first.registrationId))).toBe(false)
    await records.remove('printer')
    await records.register(machine(), randomUUID())
    const second = await records.get('printer')
    expect(second.registrationId).not.toBe(first.registrationId)
    expect(values.has(machineSecretName(second.registrationId))).toBe(true)
    expect(values.has(orphan)).toBe(true)
    expect(deletion).toHaveBeenCalledExactlyOnceWith(machineSecretName(first.registrationId))
  })
  it('retains the pending record when registration rollback cannot delete its credential', async () => {
    const { registry: records, values, secrets, write } = await registry()
    const originalWrite = write.getMockImplementation()!
    write.mockImplementationOnce(originalWrite).mockRejectedValueOnce(new Error('diskFull'))
    vi.spyOn(secrets, 'delete').mockRejectedValueOnce(new Error('storeLocked'))
    await expect(records.register(machine(), randomUUID())).rejects.toThrow('storeLocked')
    expect(await records.list()).toMatchObject([{ id: 'printer', credentialPendingRemoval: true }])
    await expect(records.get('printer')).rejects.toThrow('credentialPendingRemoval')
    expect(values.size).toBe(1)
    await records.remove('printer')
    expect(values.size).toBe(0)
  })
  it('keeps removal pending when record finalization fails after deleting the key', async () => {
    const { registry: records, values, write } = await registry()
    await records.register(machine(), randomUUID())
    const originalWrite = write.getMockImplementation()!
    write.mockImplementationOnce(originalWrite).mockRejectedValueOnce(new Error('diskFull'))
    await expect(records.remove('printer')).rejects.toThrow('diskFull')
    expect(values.size).toBe(0)
    await expect(records.get('printer')).rejects.toThrow('credentialPendingRemoval')
    await records.remove('printer')
    expect(await records.list()).toEqual([])
  })
  it('rejects a stale revision without committing a record or deleting another credential', async () => {
    const { registry: records, values, write } = await registry()
    const original = write.getMockImplementation()!
    write.mockImplementationOnce(original).mockResolvedValueOnce(false)
    await expect(records.register(machine(), randomUUID())).rejects.toThrow(
      'machineRegistryChanged',
    )
    expect(values.size).toBe(0)
    expect(await records.list()).toEqual([])
  })
  it('excludes two real processes and keeps each registration paired with its own credential', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'maker-process-registry-'))
    directories.push(directory)
    const worker = path.join(directory, 'worker.cjs')
    await build({
      entryPoints: [path.resolve('test/unit/helpers/makerRegistryProcess.ts')],
      outfile: worker,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
    const values = new Map<string, string>()
    const resultSchema = z.object({
      ok: z.boolean(),
      isOwnCredential: z.optional(z.boolean()),
      error: z.optional(z.string()),
      records: z.optional(z.array(machineRecordSchema)),
    })
    const secretSchema = z.object({
      request: z.string(),
      operation: z.enum(['get', 'store', 'delete']),
      name: z.string(),
      value: z.optional(z.string()),
    })
    let release: (() => void) | undefined
    const firstStore = Promise.withResolvers<undefined>()
    let held: (() => void) | undefined = () => {
      firstStore.resolve(undefined)
    }
    function client() {
      const child = fork(worker, [directory, REGISTRY_PROCESS_MARKER], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: {},
      })
      let complete: ((input: unknown) => void) | undefined
      child.on('message', (input: unknown) => {
        const secret = secretSchema.safeParse(input)
        if (!secret.success) {
          complete?.(input)
          return
        }
        const { request, operation, name, value } = secret.data
        const respond = () => {
          child.send({ request, value: operation === 'get' ? values.get(name) : undefined })
        }
        if (operation === 'store' && value !== undefined) {
          values.set(name, value)
          if (held !== undefined) {
            release = respond
            held()
            held = undefined
            return
          }
        }
        if (operation === 'delete') values.delete(name)
        respond()
      })
      return {
        child,
        command(operation: 'register' | 'remove', id: string, endpoint: string) {
          return new Promise<z.infer<typeof resultSchema>>((resolve) => {
            complete = (input) => {
              resolve(resultSchema.parse(input))
            }
            child.send({ operation, id, endpoint })
          })
        },
      }
    }
    const first = client(),
      second = client()
    try {
      const pending = first.command('register', 'printer', 'https://first.local')
      await firstStore.promise
      const blocked = await second.command('register', 'printer', 'https://second.local')
      expect(blocked.ok).toBe(false)
      expect(blocked.error).toContain('EEXIST')
      const blockedRemoval = await second.command('remove', 'printer', 'https://first.local')
      expect(blockedRemoval.error).toContain('EEXIST')
      release?.()
      const accepted = await pending
      expect(accepted).toMatchObject({ ok: true, isOwnCredential: true })
      expect(await second.command('register', 'printer', 'https://second.local')).toMatchObject({
        ok: false,
        error: 'duplicateMachine',
      })
      const added = await second.command('register', 'second', 'https://second.local')
      expect(added).toMatchObject({ ok: true, isOwnCredential: true })
      expect(added.records?.map((entry) => entry.endpoint)).toEqual([
        'https://first.local',
        'https://second.local',
      ])
      expect(new Set(added.records?.map((entry) => entry.registrationId)).size).toBe(2)
      const removed = await first.command('remove', 'printer', 'https://first.local')
      expect(removed.records?.map((entry) => entry.id)).toEqual(['second'])
      expect(values.size).toBe(1)
      expect(values.has(machineSecretName(added.records![1]!.registrationId))).toBe(true)
      const replaced = await first.command('register', 'printer', 'https://replacement.local')
      expect(replaced).toMatchObject({ ok: true, isOwnCredential: true })
      expect(replaced.records?.find((entry) => entry.id === 'printer')?.registrationId).not.toBe(
        accepted.records?.[0]?.registrationId,
      )
      expect(values.size).toBe(2)
    } finally {
      release?.()
      const exits = [first, second].map(
        ({ child }) =>
          new Promise<void>((resolve) => {
            child.once('exit', () => {
              resolve()
            })
            child.kill()
          }),
      )
      await Promise.all(exits)
    }
  })
  it('persists revision CAS and refuses a stale cross-process writer lock', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'maker-file-registry-'))
    directories.push(directory)
    const storage = new FileMachineStorage(directory)
    const secrets: MakerSecrets = {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }
    const records = new MachineRegistry(storage, secrets, privateLan)
    await records.register(machine())
    expect(await storage.compareAndSwap(0, [])).toBe(false)
    expect(await records.list()).toHaveLength(1)
    expect(await registeredMachineEndpoints(directory)).toEqual(['https://printer.local'])
    await writeFile(path.join(directory, 'machines.lock'), '')
    await expect(records.remove('printer')).rejects.toThrow()
    expect(await records.list()).toHaveLength(1)
    await writeFile(
      path.join(directory, 'machines.json'),
      '{"revision":0,"records":[{"endpoint":"http://agent"}]}',
    )
    await expect(registeredMachineEndpoints(directory)).rejects.toThrow()
  })
})
async function logFixture(maxBytes = 20_000, maxEntryBytes = 2000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maker-log-'))
  directories.push(directory)
  const workspace = path.join(directory, 'workspace')
  await mkdir(workspace)
  const storage = path.join(directory, 'storage')
  const key = randomUUID()
  const log = new DeviceLog(storage, workspace, {
    maxBytes,
    maxEntryBytes,
    now: () => 123,
    secretValues: () => Promise.resolve([key]),
  })
  return { directory, workspace, storage, key, log }
}
const entry = {
  machine: 'virtual',
  action: 'actuate',
  payload: 'M105',
  approval: null,
  outcome: 'sent',
} as const

describe('maker device log', () => {
  it('appends redacted JSONL with original payload hashes and private file permissions', async () => {
    const { log, key, storage } = await logFixture()
    const payload = `G1 X1 ; ${key}`
    await Promise.all([
      log.append({ ...entry, payload }),
      log.append({ ...entry, payload: 'M104 S0' }),
    ])
    const entries = await log.read()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      time: 123,
      digest: payloadDigest(payload),
      payload: expect.stringContaining('[redacted]'),
    })

    const captured3 = await readFile(path.join(storage, 'device-log.jsonl'), 'utf8')
    expect(captured3.includes(key)).toBe(false)
    if (process.platform === 'win32') return
    const captured4 = await stat(path.join(storage, 'device-log.jsonl'))
    expect(captured4.mode & 0o777).toBe(0o600)
  })
  it('persists uncertain dispatch without changing it to success or failure', async () => {
    const { log } = await logFixture()
    await log.append({ ...entry, outcome: 'sentOutcomeUnknown' })
    expect(await log.read()).toMatchObject([
      { outcome: 'sentOutcomeUnknown', digest: payloadDigest(entry.payload) },
    ])
  })
  it('logs nonprintable Stop bytes as hex with a digest of the actual bytes', async () => {
    const { log } = await logFixture()
    const bytes = Buffer.from([0x21, 0x85, 0x18])
    await log.append({ ...entry, action: 'stop', payload: bytes, outcome: 'stopped' })
    const awaitEntries = await log.read()
    expect(awaitEntries[0]).toMatchObject({
      payload: 'hex:218518',
      digest: payloadDigest(bytes),
    })
  })
  it('refuses repository storage, symlinked files and symlink ancestors into the repository', async () => {
    const { log, workspace, storage, directory } = await logFixture()
    expect(
      () =>
        new DeviceLog(path.join(workspace, 'logs'), workspace, {
          maxBytes: 20_000,
          maxEntryBytes: 2000,
          now: () => 1,
          secretValues: () => Promise.resolve([]),
        }),
    ).toThrow('deviceLogInWorkspace')
    await mkdir(storage)
    const target = path.join(directory, 'target')
    await writeFile(target, 'untouched')
    await symlink(target, path.join(storage, 'device-log.jsonl'))

    await expect(log.append(entry)).rejects.toThrow()
    const captured5 = await readFile(target, 'utf8')
    expect(captured5).toBe('untouched')
    const link = path.join(directory, 'workspace-link')
    await symlink(workspace, link, 'dir')
    const linked = new DeviceLog(path.join(link, 'logs'), workspace, {
      maxBytes: 20_000,
      maxEntryBytes: 2000,
      now: () => 1,
      secretValues: () => Promise.resolve([]),
    })
    await expect(linked.append(entry)).rejects.toThrow('deviceLogInWorkspace')
    await expect(linked.read()).rejects.toThrow('deviceLogInWorkspace')
  })
  it('refuses hard-linked log files rather than writing another file', async () => {
    const { log, storage, directory } = await logFixture()
    await mkdir(storage)
    const target = path.join(directory, 'target')
    await writeFile(target, 'untouched')
    await link(target, path.join(storage, 'device-log.jsonl'))
    await expect(log.append(entry)).rejects.toThrow('deviceLogSymlink')
    expect(await readFile(target, 'utf8')).toBe('untouched')
  })
  it('refuses oversized entries, caps the file and rejects an existing writer lock', async () => {
    const { log, storage } = await logFixture(350, 300)
    await expect(log.append({ ...entry, payload: 'x'.repeat(400) })).rejects.toThrow(
      'deviceLogEntrySize',
    )
    await log.append(entry)

    await expect(log.append(entry)).rejects.toThrow('deviceLogSize')
    const captured6 = await log.read()
    expect(captured6).toHaveLength(1)
    await writeFile(path.join(storage, 'device-log.jsonl.lock'), '')

    await expect(log.append(entry)).rejects.toThrow()
    const captured7 = await log.read()
    expect(captured7).toHaveLength(1)
  })
  it('refuses an existing writer lock while the log still has free capacity', async () => {
    const { log, storage } = await logFixture()
    await log.append(entry)
    await writeFile(path.join(storage, 'device-log.jsonl.lock'), '')
    await expect(log.append(entry)).rejects.toThrow()
    expect(await log.read()).toHaveLength(1)
  })
  it('does not let a secret equal to an outcome corrupt structural fields', async () => {
    const { storage, workspace } = await logFixture()
    const log = new DeviceLog(storage, workspace, {
      maxBytes: 20_000,
      maxEntryBytes: 2000,
      now: () => 1,
      secretValues: () => Promise.resolve(['sent']),
    })
    await log.append({ ...entry, payload: 'sent' })
    const entries = await log.read()
    expect(entries[0]).toMatchObject({ outcome: 'sent', payload: '[redacted]' })
  })
})
