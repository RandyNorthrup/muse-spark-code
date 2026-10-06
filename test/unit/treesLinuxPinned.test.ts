import process from 'node:process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LinuxResourceTreeReader,
  pinLinuxCgroupDirectory,
} from '../../src/core/resources/trees/linux'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import type { ResourceTicket } from '../../src/shared/resources'
import { removeFolder } from './helpers/temporaryFolders'

const root = `/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/delegated`
const scope = `${root}/tree`
const ticket: ResourceTicket = {
  id: 'pinned-tree',
  root: { pid: 710, startTime: '1000' },
  scope: { type: 'cgroup', path: scope },
  kind: 'check',
  class: 'foreground',
  sessionId: null,
}
async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'm107-pinned-'))
  const directory = path.join(folder, 'tree')
  await mkdir(directory)
  const contents = async (member: string) => {
    const entries = Object.entries({
      'cgroup.procs': member,
      'cgroup.events': 'populated 0\nfrozen 1\n',
      'cpu.stat': 'usage_usec 1000000\n',
      'cgroup.kill': '',
      'cgroup.freeze': '',
    })
    for (const [file, text] of entries) await writeFile(path.join(directory, file), text)
  }
  await contents('710')
  const homeDirectory = path.join(folder, 'home')
  await mkdir(homeDirectory)
  await writeFile(path.join(homeDirectory, 'cgroup.procs'), '')
  const homeHandle = await pinLinuxCgroupDirectory(homeDirectory)
  const homeClose = vi.spyOn(homeHandle, 'close')
  const handle = await pinLinuxCgroupDirectory(directory)
  const close = vi.spyOn(handle, 'close')
  const write = vi.fn((file: string, text: string) => writeFile(file, text))
  const remove = vi.fn(() => Promise.resolve())
  const read = vi.fn((file: string) => {
    if (file === '/proc/710/cgroup')
      return Promise.resolve(`0::${scope.slice('/sys/fs/cgroup'.length)}\n`)
    if (file === '/proc/710/stat') {
      const fields = Array.from({ length: 50 }, () => '0')
      fields[0] = 'S'
      fields[1] = '1'
      fields[2] = '710'
      fields[19] = '1000'
      fields[21] = '1'
      return Promise.resolve(`710 (fixture) ${fields.join(' ')}`)
    }
    return readFile(file, 'utf8')
  })
  const pin = vi.fn((directory: string) =>
    Promise.resolve(directory === root ? homeHandle : handle),
  )
  const reader = new LinuxResourceTreeReader({
    ownedCgroupRoot: root,
    canonical: (file) => Promise.resolve(file),
    homeCgroup: root,
    pinDirectory: pin,
    read,
    write,
    remove,
    directories: () => Promise.resolve([]),
    sendSignal: vi.fn(),
    run: (_file, args) => Promise.resolve(args[0] === 'CLK_TCK' ? '100' : '4096'),
  })
  const registry = new ResourceTreeRegistry(reader)
  const join = await reader.pin(ticket)
  await registry.register(ticket)
  return {
    pin,
    join,
    folder,
    directory,
    homeDirectory,
    homeHandle,
    homeClose,
    contents,
    handle,
    close,
    write,
    remove,
    reader,
    registry,
    read,
  }
}

function expectJoin(w: Awaited<ReturnType<typeof fixture>>) {
  expect(w.join).toBe(w.handle.path.replace('/proc/self/', () => `/proc/${String(process.pid)}/`))
}
async function retire(w: Awaited<ReturnType<typeof fixture>>) {
  w.registry.unregister(ticket)
  try {
    await vi.waitFor(() => {
      expect(w.close).toHaveBeenCalledTimes(1)
      expect(w.homeClose).toHaveBeenCalledTimes(1)
    })
    expect(await w.reader.usage(ticket)).toBeNull()
    expect(w.pin).toHaveBeenCalledTimes(2)
  } finally {
    await removeFolder(w.folder)
  }
}

describe.runIf(process.platform === 'linux')('pinned cgroup directory identity', () => {
  it.each(['SIGKILL', 'SIGTERM'] as const)(
    'refuses a removed and recreated directory before %s without writing to its new member',
    async (signal) => {
      const w = await fixture()
      try {
        expectJoin(w)
        await rm(w.directory, { recursive: true })
        await mkdir(w.directory)
        await w.contents('999')
        expect(await w.registry.kill(ticket, signal)).toMatchObject({ status: 'cgroup_changed' })
        expect(w.write).not.toHaveBeenCalled()
        expect(w.remove).not.toHaveBeenCalled()
        expect(await readFile(path.join(w.directory, 'cgroup.kill'), 'utf8')).toBe('')
        expect(await readFile(path.join(w.directory, 'cgroup.freeze'), 'utf8')).toBe('')
        expect(await readFile(path.join(w.directory, 'cgroup.procs'), 'utf8')).toBe('999')
        expect(await w.registry.usage(ticket)).toBeNull()
        expect(w.close).not.toHaveBeenCalled()
      } finally {
        await retire(w)
      }
    },
  )
  it.each(['SIGKILL', 'SIGTERM'] as const)(
    'uses pinned file paths for the positive %s control and closes only on unregister',
    async (signal) => {
      const w = await fixture()
      try {
        expectJoin(w)
        expect(w.homeHandle.path).toMatch(/^\/proc\/self\/fd\/\d+$/)
        expect(w.handle.path).toMatch(/^\/proc\/self\/fd\/\d+$/)
        expect(await w.registry.usage(ticket)).toEqual({ cpuSeconds: 1, residentBytes: 4096 })
        expect(await w.registry.kill(ticket, signal)).toMatchObject({ status: 'done' })
        expect(await readFile(path.join(w.homeDirectory, 'cgroup.procs'), 'utf8')).toBe(
          String(process.pid),
        )
        expect(w.write.mock.calls.every(([file]) => file.startsWith('/proc/self/fd/'))).toBe(true)
        expect(w.homeClose).not.toHaveBeenCalled()
        expect(
          w.read.mock.calls
            .filter(([file]) => !file.startsWith('/proc/710/'))
            .every(([file]) => file.startsWith(`${w.handle.path}/`)),
        ).toBe(true)
        expect(w.close).not.toHaveBeenCalled()
      } finally {
        await retire(w)
      }
    },
  )
})
