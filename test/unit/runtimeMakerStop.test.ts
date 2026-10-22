import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { makePrivateFolder, makerTempRoot } from './helpers/makerTemp'
import { removeFolder } from './helpers/temporaryFolders'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { machineSimulator } from './helpers/makerMachineSimulator'
import { runRuntimeMaker } from '../../src/runtime/maker/entry'
import { parseMakerCommand } from '../../src/runtime/maker/commandArgs'
import {
  runtimeLeaseIdentity,
  stopRuntimeMachines,
  stopResultText,
} from '../../src/runtime/maker/stop'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import { claimHardwareLease } from '../../src/core/maker/lease'
import { makerLeaseDeps, previousBuildOwner } from './helpers/makerSerial'
import { MAKER_LEASE_SOCKET_NAME_CHARS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  await Promise.all(roots.splice(0).map((root) => removeFolder(root)))
})
async function fixture() {
  const root = await mkdtemp(path.join(makerTempRoot(), 'maker-stop-'))
  roots.push(root)
  const dataDirectory = path.join(root, 'data')
  const directory = path.join(dataDirectory, 'maker')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const server = await machineSimulator()
  closers.push(() => server.close())
  const record = {
    registrationId: randomUUID(),
    id: 'printer',
    name: 'Bench printer',
    kind: 'moonraker',
    category: 'printer',
    endpoint: server.endpoint,
    allowPlainHttp: true,
    limits: {},
  }
  await writeFile(
    path.join(directory, 'machines.json'),
    JSON.stringify({ revision: 1, records: [record] }),
  )
  const deps = {
    dataDirectory,
    platform: process.platform,
    lan: {
      classify: () => 'private' as const,
      resolve: () => Promise.resolve(['127.0.0.1']),
    },
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  }
  const stops = () =>
    server.requests.filter(
      (request) => request.method === 'POST' && request.path === '/printer/emergency_stop',
    )
  return { root, directory, record, deps, server, stops }
}
const devicesFailed = () => fill(UI_TEXT.makerStopFailed, { machine: UI_TEXT.makerDevicesTitle })
// FIXM103W11: a Stop index record for one owner, with the endpoint spelling under test.
async function owner(endpoint: (folder: string, id: string) => string, pid = process.pid) {
  const f = await fixture()
  const folder = path.join(f.directory, 'leases')
  await makePrivateFolder(folder)
  const startedAt = await runtimeLeaseIdentity(process.platform, process.env).processStartTime(
    process.pid,
  )
  const id = randomUUID(),
    generation = randomUUID(),
    resource = 'port:owner'
  const record = {
    version: 1,
    id,
    generation,
    resource,
    holder: 'owner',
    pid,
    startedAt,
    endpoint: endpoint(folder, id),
  }
  const key = createHash('sha256').update(resource).digest('hex')
  const file = path.join(folder, `stop-v1.${key}.${id}.${generation}.json`)
  await writeFile(file, JSON.stringify(record))
  return { f, file, record }
}
describe('independent runtime Stop', () => {
  // The CLI entry hard-wires the production LAN policy, which refuses a
  // loopback simulator, so machine reach is proven through the same
  // stopRuntimeMachines the entry calls; argument parsing is covered by the
  // command suites.
  it.each(['plain', 'linked-data'])(
    'Stop reaches the machine under data layout %s without touching workspace storage',
    async (layout) => {
      const f = await fixture()
      let dataDirectory = f.deps.dataDirectory
      if (layout === 'linked-data') {
        dataDirectory = path.join(f.root, 'linked')
        await symlink(
          f.deps.dataDirectory,
          dataDirectory,
          process.platform === 'win32' ? 'junction' : 'dir',
        )
      }
      const result = await stopRuntimeMachines({ ...f.deps, dataDirectory })
      expect(result).toEqual({ physicalStopRequired: [] })
      expect(f.stops()).toHaveLength(1)
      expect(await readdir(f.directory)).toEqual(['machines.json'])
      expect(stopResultText(result)).toBe(UI_TEXT.makerSoftwareStopWarning)
    },
  )
  it('the companion keeps Stop when home is the workspace and authority storage is unavailable', async () => {
    const f = await fixture()
    const service = await createRuntimeMakerService({
      ...f.deps,
      workspace: f.root,
      trusted: () => true,
      flagged: () => true,
      interactive: () => true,
      stopOnlyFallback: true,
      native: { platform: process.platform, env: {}, packageRoot: path.resolve('.') },
    })
    try {
      expect(service.host.hardwareEnabled()).toBe(false)
      await expect(service.host.setHardware(true, 'unsafe')).rejects.toThrow()
      expect(
        await service.dispatch({ v: 1, type: 'makerStop' }, new AbortController().signal),
      ).toMatchObject({ outcome: 'stopped' })
      expect(f.stops()).toHaveLength(1)
    } finally {
      await service.close()
    }
  })
  it('does not create storage when no user registry or lease exists', async () => {
    const f = await fixture()
    const result = await stopRuntimeMachines({
      ...f.deps,
      dataDirectory: path.join(f.root, 'missing'),
    })
    expect(result.physicalStopRequired).toEqual([])
    expect(await readdir(f.root)).toEqual(['data'])
  })
  it('reaches lease owners even if the machine registry is corrupt', async () => {
    const f = await fixture()
    // The Windows helper writes its script into the folder, then makes it private.
    await mkdir(path.join(f.directory, 'leases'), { mode: 0o700 })
    const lease = await makerLeaseDeps(path.join(f.directory, 'leases'))
    let stops = 0
    const stopped = () => {
      stops += 1
      return Promise.resolve()
    }
    const claim = await claimHardwareLease(lease, 'port:test-owner', 'test', stopped)
    if (claim.status !== 'acquired') throw new Error('claim')
    await writeFile(path.join(f.directory, 'machines.json'), '{}')
    try {
      await expect(stopRuntimeMachines(f.deps)).rejects.toThrow('Stop failed')
      expect(stops).toBe(1)
    } finally {
      await claim.release()
    }
  })
  it('names a failed machine and directs immediate physical emergency Stop', async () => {
    const f = await fixture()
    f.server.reply({ status: 500, body: 'private transport detail' })
    const output: string[] = []
    const command = parseMakerCommand(['stop-machine', 'printer'])
    if (command === undefined) throw new Error('command')
    expect(
      await runRuntimeMaker(command, {
        ...f.deps,
        workspace: f.root,
        distDirectory: '',
        env: {},
        readSecret: () => Promise.resolve(undefined),
        print: () => undefined,
        reportFailure: (text) => {
          output.push(text)
        },
        done: new AbortController().signal,
        table: EN,
        locale: 'en',
      }),
    ).toBe(1)
    expect(output).toEqual([fill(UI_TEXT.makerStopFailed, { machine: 'Bench printer' })])
    expect(output.join('')).not.toContain('private transport')
  })
  it('attempts HTTP Stop alongside registered serial and PrusaLink machines and names their physical Stop requirement', async () => {
    const f = await fixture()
    const records = [
      f.record,
      ...['grbl', 'fluidnc', 'marlin', 'prusalink'].map((kind) => ({
        ...f.record,
        id: kind,
        name: kind,
        registrationId: randomUUID(),
        kind,
      })),
    ]
    await writeFile(
      path.join(f.directory, 'machines.json'),
      JSON.stringify({ revision: 1, records }),
    )
    const result = await stopRuntimeMachines(f.deps)
    expect(f.stops()).toHaveLength(1)
    expect(
      result.physicalStopRequired.toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(['fluidnc', 'grbl', 'marlin', 'prusalink'])
    expect(stopResultText(result)).toContain('physical emergency stop')
  })
  it('dead owner with an absent endpoint is stale and remains untouched without a false Stop alarm', async () => {
    const f = await fixture()
    const leaseDirectory = path.join(f.directory, 'leases')
    // Private on every host: this case is about the dead owner, not the folder ACL.
    await makePrivateFolder(leaseDirectory)
    const resource = 'port:crashed'
    const directory = path.join(
      leaseDirectory,
      `${createHash('sha256').update(resource).digest('hex')}.lock`,
    )
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const id = randomUUID(),
      generation = randomUUID()
    const file = path.join(directory, `${id}.${generation}.json`)
    const text = JSON.stringify({
      version: 2,
      id,
      generation,
      resource,
      holder: 'crashed',
      pid: 2_147_483_647,
      endpoint:
        process.platform === 'win32'
          ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
          : path.join(leaseDirectory, `${id}.sock`),
    })
    await writeFile(file, text)
    const result = await stopRuntimeMachines(f.deps)
    expect(result.physicalStopRequired).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(text)
  })

  describe('FIXM103W11 RVM103W5 P1: an owner Stop cannot confirm is never a stopped one', () => {
    it('RVM103W6 P1: stop-machine --all fails for an acquired owner with another resource hash in its Stop filename', async () => {
      const f = await fixture()
      const folder = path.join(f.directory, 'leases')
      await makePrivateFolder(folder)
      const lease = {
        ...(await makerLeaseDeps(folder)),
        ...runtimeLeaseIdentity(process.platform, process.env),
      }
      let stops = 0
      const stopped = () => {
        stops += 1
        return Promise.resolve()
      }
      const claim = await claimHardwareLease(lease, 'port:actual', 'owner', stopped)
      if (claim.status !== 'acquired') throw new Error('claim')
      try {
        const suffix = `.${claim.record.id}.${claim.record.generation}.json`
        const actualKey = createHash('sha256').update(claim.record.resource).digest('hex')
        const otherKey = createHash('sha256').update('port:other').digest('hex')
        await rename(
          path.join(folder, `stop-v1.${actualKey}${suffix}`),
          path.join(folder, `stop-v1.${otherKey}${suffix}`),
        )
        expect(await readFile(path.join(folder, `claim-v1.${actualKey}${suffix}`), 'utf8')).toBe(
          JSON.stringify(claim.record),
        )
        expect(await lease.processStartTime(claim.record.pid)).toBe(claim.record.startedAt)
        const command = parseMakerCommand(['stop-machine', '--all'])
        if (command === undefined) throw new Error('command')
        const printed: string[] = []
        const failures: string[] = []
        expect(
          await runRuntimeMaker(command, {
            ...f.deps,
            workspace: f.root,
            distDirectory: '',
            env: process.env,
            readSecret: () => Promise.resolve(undefined),
            print: (line) => {
              printed.push(line)
            },
            reportFailure: (line) => {
              failures.push(line)
            },
            done: new AbortController().signal,
            table: EN,
            locale: 'en',
          }),
        ).toBe(1)
        expect(failures).toEqual([devicesFailed()])
        expect(printed).not.toContain(UI_TEXT.makerSoftwareStopWarning)
        expect(f.stops()).toHaveLength(1)
        expect(stops).toBe(0)
      } finally {
        await claim.release()
      }
    })
    it.skipIf(process.platform === 'win32')(
      'stop-machine --all reaches an owner a previous build published under the whole-id socket',
      async () => {
        const f = await fixture()
        const folder = path.join(f.directory, 'leases')
        await makePrivateFolder(folder)
        const startedAt = await runtimeLeaseIdentity(
          process.platform,
          process.env,
        ).processStartTime(process.pid)
        const previous = await previousBuildOwner(folder, 'port:previous', startedAt ?? '')
        try {
          expect(await stopRuntimeMachines(f.deps)).toEqual({ physicalStopRequired: [] })
          expect(previous.requests).toEqual([{ command: 'stop', id: previous.record.id }])
        } finally {
          await previous.close()
        }
      },
    )
    it('an unrecognised live owner leaves Stop unconfirmed with the physical-stop advice', async () => {
      const { f, file } = await owner(() => 'foreign')
      await expect(stopRuntimeMachines(f.deps)).rejects.toThrow(devicesFailed())
      expect(await readdir(path.dirname(file))).toContain(path.basename(file))
    })
    it('a live owner Stop cannot reach leaves Stop unconfirmed with the physical-stop advice', async () => {
      const { f } = await owner((folder, id) =>
        process.platform === 'win32'
          ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
          : path.join(folder, `${id.slice(0, MAKER_LEASE_SOCKET_NAME_CHARS)}.sock`),
      )
      await expect(stopRuntimeMachines(f.deps)).rejects.toThrow(devicesFailed())
    })
    it('an unrecognised owner whose process is gone raises no alarm and stays untouched', async () => {
      const { f, file } = await owner(() => 'foreign', 2_147_483_647)
      const text = await readFile(file, 'utf8')
      expect(await stopRuntimeMachines(f.deps)).toEqual({ physicalStopRequired: [] })
      expect(await readFile(file, 'utf8')).toBe(text)
    })
  })
})
