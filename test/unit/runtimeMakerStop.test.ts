import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRuntimeMaker } from '../../src/runtime/maker/entry'
import { parseMakerCommand } from '../../src/runtime/maker/commandArgs'
import { stopRuntimeMachines, stopResultText } from '../../src/runtime/maker/stop'
import { createRuntimeMakerService, runtimeMakerLan } from '../../src/runtime/maker/service'
import { RuntimeMakerStorage } from '../../src/runtime/maker/storage'
import { MachineHttp } from '../../src/core/maker/machines/http'
import { claimHardwareLease } from '../../src/core/maker/lease'
import { makerLeaseDeps } from './helpers/makerSerial'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'maker-stop-'))
  roots.push(root)
  const dataDirectory = path.join(root, 'data')
  const directory = path.join(dataDirectory, 'maker')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const record = {
    registrationId: randomUUID(),
    id: 'printer',
    name: 'Bench printer',
    kind: 'moonraker',
    category: 'printer',
    endpoint: 'https://192.168.1.10',
    allowPlainHttp: false,
    limits: {},
  }
  await writeFile(
    path.join(directory, 'machines.json'),
    JSON.stringify({ revision: 1, records: [record] }),
  )
  const deps = {
    dataDirectory,
    platform: process.platform,
    lan: runtimeMakerLan,
    secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
  }
  const http = vi.spyOn(MachineHttp.prototype, 'json').mockResolvedValue({ result: 'ok' })
  return { root, directory, record, deps, http }
}
describe('independent runtime Stop', () => {
  it.each(['home', 'root', 'data-parent', 'linked-data'])(
    'CLI Stop reaches the machine from D4 cwd %s without touching workspace storage',
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
      const create = vi
        .spyOn(RuntimeMakerStorage, 'create')
        .mockRejectedValue(new Error('storage-forbidden'))
      let workspace = f.root
      if (layout === 'root') workspace = path.parse(f.root).root
      else if (layout === 'data-parent') workspace = f.deps.dataDirectory
      const command = parseMakerCommand(['stop-machine', '--all'])
      if (command === undefined) throw new Error('command')
      const print = vi.fn()
      expect(
        await runRuntimeMaker(command, {
          ...f.deps,
          dataDirectory,
          workspace,
          distDirectory: '/not-read',
          env: {},
          readSecret: vi.fn(),
          print,
          done: new AbortController().signal,
          table: EN,
          locale: 'en',
        }),
      ).toBe(0)
      expect(f.http).toHaveBeenCalledWith('POST', '/printer/emergency_stop')
      expect(create).not.toHaveBeenCalled()
      expect(await readdir(f.directory)).toEqual(['machines.json'])
      expect(print).toHaveBeenCalledWith(UI_TEXT.makerSoftwareStopWarning)
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
    const create = vi.spyOn(RuntimeMakerStorage, 'create').mockRejectedValue(new Error('forbidden'))
    try {
      expect(service.host.hardwareEnabled()).toBe(false)
      await expect(service.host.setHardware(true, 'unsafe')).rejects.toThrow()
      expect(
        await service.dispatch({ v: 1, type: 'makerStop' }, new AbortController().signal),
      ).toMatchObject({ outcome: 'stopped' })
      expect(f.http).toHaveBeenCalledWith('POST', '/printer/emergency_stop')
      expect(create).not.toHaveBeenCalled()
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
    const lease = await makerLeaseDeps(path.join(f.directory, 'leases'))
    const stopped = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const claim = await claimHardwareLease(lease, 'port:test-owner', 'test', stopped)
    if (claim.status !== 'acquired') throw new Error('claim')
    await writeFile(path.join(f.directory, 'machines.json'), '{}')
    try {
      await expect(stopRuntimeMachines(f.deps)).rejects.toThrow('Stop failed')
      expect(stopped).toHaveBeenCalledTimes(1)
    } finally {
      await claim.release()
    }
  })
  it('names a failed machine and directs immediate physical emergency Stop', async () => {
    const f = await fixture()
    f.http.mockRejectedValue(new Error('private transport detail'))
    const output: string[] = []
    const command = parseMakerCommand(['stop-machine', 'printer'])
    if (command === undefined) throw new Error('command')
    expect(
      await runRuntimeMaker(command, {
        ...f.deps,
        workspace: f.root,
        distDirectory: '',
        env: {},
        readSecret: vi.fn(),
        print: vi.fn(),
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
    expect(f.http).toHaveBeenCalledTimes(1)
    expect(
      result.physicalStopRequired.toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(['fluidnc', 'grbl', 'marlin', 'prusalink'])
    expect(stopResultText(result)).toContain('physical emergency stop')
  })
  it('dead owner with an absent endpoint is stale and remains untouched without a false Stop alarm', async () => {
    const f = await fixture()
    const leaseDirectory = path.join(f.directory, 'leases')
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
})
