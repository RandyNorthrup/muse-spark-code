import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile, link } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceLog, payloadDigest } from '../../src/core/maker/deviceLog'
import {
  MachineRegistry,
  machineRecordSchema,
  machineSecretName,
  machineTarget,
  type MakerSecrets,
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
    id: 'printer',
    name: 'Virtual',
    kind: 'moonraker',
    category: 'printer',
    endpoint: 'https://printer.local',
    allowPlainHttp: false,
    limits: {},
  }
}
function registry() {
  let stored: unknown = []
  const write = vi.fn((records: readonly MachineRecord[]) => {
    stored = structuredClone(records)
    return Promise.resolve()
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
      { read: () => Promise.resolve(stored), write },
      secrets,
      privateLan,
    ),
    values,
    secrets,
    write,
    setRecords(input: unknown) {
      stored = input
    },
  }
}
describe('maker registry boundaries', () => {
  it('stores keys only through the host secret port and rejects unregistered machines', async () => {
    const { registry: records, values, write } = registry(),
      key = randomUUID()
    await records.register(machine(), key)
    expect(JSON.stringify(write.mock.calls).includes(key)).toBe(false)
    expect(values.has(machineSecretName('printer'))).toBe(true)

    const captured0 = await records.get('printer')
    expect(captured0.name).toBe('Virtual')
    await expect(records.get('unregistered')).rejects.toThrow('unregisteredMachine')
    await records.remove('printer')

    expect(values.size).toBe(0)
    const captured1 = await records.list()
    expect(captured1).toEqual([])
  })
  it('refuses secrets in records, duplicates and GRBL pretending to be a printer', async () => {
    const { registry: records, setRecords } = registry()
    await expect(records.register({ ...machine(), apiKey: randomUUID() })).rejects.toThrow()
    await expect(records.register({ ...machine(), kind: 'grbl' })).rejects.toThrow(
      'machineCategory',
    )
    await records.register(machine())
    await expect(records.register(machine())).rejects.toThrow('duplicateMachine')
    setRecords([machine(), machine()])
    await expect(records.list()).rejects.toThrow()
    expect(machineRecordSchema.safeParse({ ...machine(), limits: { feedMmMin: -1 } }).success).toBe(
      false,
    )
  })
  it('refuses public registration, empty DNS and embedded URL credentials', async () => {
    const { registry: records } = registry()
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
    const { registry: records, values, write } = registry()
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
    const { registry: records, values, secrets, write } = registry()
    const key = randomUUID()
    await records.register(machine(), key)
    const deletion = vi.spyOn(secrets, 'delete').mockRejectedValueOnce(new Error('storeLocked'))
    await expect(records.remove('printer')).rejects.toThrow('storeLocked')
    expect(await records.list()).toEqual([{ ...machine(), credentialPendingRemoval: true }])
    await expect(records.get('printer')).rejects.toThrow('credentialPendingRemoval')
    await expect(
      records.register({ ...machine(), endpoint: 'https://second.local' }),
    ).rejects.toThrow('duplicateMachine')
    expect(values.has(machineSecretName('printer'))).toBe(true)
    await records.remove('printer')
    expect(deletion).toHaveBeenCalledTimes(2)
    expect(values.size).toBe(0)
    expect(await records.list()).toEqual([])
    expect(JSON.stringify(write.mock.calls).includes(key)).toBe(false)
  })
  it('does not delete a secret until the pending-removal record is durable', async () => {
    const { registry: records, values, secrets, write } = registry()
    await records.register(machine(), randomUUID())
    const deletion = vi.spyOn(secrets, 'delete')
    write.mockRejectedValueOnce(new Error('diskFull'))
    await expect(records.remove('printer')).rejects.toThrow('diskFull')
    expect(deletion).not.toHaveBeenCalled()
    expect(values.size).toBe(1)
    expect(await records.get('printer')).toEqual(machine())
  })
  it('clears an orphan credential before keyless registration and refuses on failure', async () => {
    const { registry: records, values, secrets } = registry()
    values.set(machineSecretName('printer'), randomUUID())
    vi.spyOn(secrets, 'delete').mockRejectedValueOnce(new Error('storeLocked'))
    await expect(records.register(machine())).rejects.toThrow('storeLocked')
    expect(await records.list()).toEqual([{ ...machine(), credentialPendingRemoval: true }])
    await expect(records.get('printer')).rejects.toThrow('credentialPendingRemoval')
    await records.remove('printer')
    await records.register(machine())
    expect(values.size).toBe(0)
  })
  it('retains the pending record when registration rollback cannot delete its credential', async () => {
    const { registry: records, values, secrets, write } = registry()
    const originalWrite = write.getMockImplementation()!
    write.mockImplementationOnce(originalWrite).mockRejectedValueOnce(new Error('diskFull'))
    const originalDelete = secrets.delete
    vi.spyOn(secrets, 'delete')
      .mockImplementationOnce(originalDelete)
      .mockRejectedValueOnce(new Error('storeLocked'))
    await expect(records.register(machine(), randomUUID())).rejects.toThrow('storeLocked')
    expect(await records.list()).toEqual([{ ...machine(), credentialPendingRemoval: true }])
    await expect(records.get('printer')).rejects.toThrow('credentialPendingRemoval')
    expect(values.size).toBe(1)
    await records.remove('printer')
    expect(values.size).toBe(0)
  })
  it('keeps removal pending when record finalization fails after deleting the key', async () => {
    const { registry: records, values, write } = registry()
    await records.register(machine(), randomUUID())
    const originalWrite = write.getMockImplementation()!
    write.mockImplementationOnce(originalWrite).mockRejectedValueOnce(new Error('diskFull'))
    await expect(records.remove('printer')).rejects.toThrow('diskFull')
    expect(values.size).toBe(0)
    await expect(records.get('printer')).rejects.toThrow('credentialPendingRemoval')
    await records.remove('printer')
    expect(await records.list()).toEqual([])
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
