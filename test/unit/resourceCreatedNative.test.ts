import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { fileIdentityKey, lstatIdentity } from '../../src/core/fs/fileIdentity'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { readJobSource } from './helpers/jobSource'
import { RESOURCE_TEMP_MARKER } from '../../src/shared/constants'

function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { env, windowsHide: true }, (error, stdout) => {
      if (error === null) resolve(stdout)
      else reject(new Error(error.message, { cause: error }))
    })
  })
}
const state: {
  scratch?: string
  call?: (args: readonly string[]) => Promise<string>
  device?: (args: readonly string[]) => Promise<string>
  mount?: (args: readonly string[]) => Promise<string>
} = {}
// A native compilation is shared by the file; tests themselves keep the repo's 5 s limit.
beforeAll(async () => {
  await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
  state.scratch = await mkdtemp(path.join(process.cwd(), 'temp', 'm107-native-'))
  const scratch = state.scratch
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot']!
    const powershell = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const assembly = path.join(scratch, 'created.dll')
    const source = path.join(scratch, 'created.cs')
    await writeFile(source, await readJobSource('shellJob'))
    const prefix = ['-NoProfile', '-NonInteractive', '-Command']
    await run(
      powershell,
      [
        ...prefix,
        `$ErrorActionPreference='Stop'; Add-Type -Path ${powerShellQuoted(source)} -OutputAssembly ${powerShellQuoted(assembly)}`,
      ],
      { SystemRoot: systemRoot, TMP: scratch, TEMP: scratch },
    )
    state.call = (args) =>
      run(
        powershell,
        [
          ...prefix,
          `$ErrorActionPreference='Stop'; [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(assembly)}); [MuseSparkCreated]::Execute([string[]]@(${args.map((arg) => powerShellQuoted(arg)).join(',')}))`,
        ],
        { SystemRoot: systemRoot, TMP: scratch, TEMP: scratch },
      )
  } else {
    const binary = path.join(scratch, 'created')
    await run(
      '/usr/bin/cc',
      [
        '-Wall',
        '-Wextra',
        '-Werror',
        '-DMUSE_CREATED_STANDALONE',
        path.join(process.cwd(), 'native', 'darwin', 'MuseSparkCreated.c'),
        ...(process.platform === 'linux' ? ['-lcrypto'] : []),
        '-o',
        binary,
      ],
      { PATH: '/usr/bin:/bin', TMPDIR: scratch },
    )
    state.call = (args) => run(binary, args)
    const deviceBinary = path.join(scratch, 'device')
    await run(
      '/usr/bin/cc',
      [
        '-Wall',
        '-Wextra',
        '-Werror',
        '-DMUSE_CREATED_STANDALONE',
        path.join(process.cwd(), 'test', 'unit', 'helpers', 'createdNativeDevice.c'),
        ...(process.platform === 'linux' ? ['-lcrypto'] : []),
        '-o',
        deviceBinary,
      ],
      { PATH: '/usr/bin:/bin', TMPDIR: scratch },
    )
    state.device = (args) => run(deviceBinary, args)
    if (process.platform === 'linux') {
      const mountBinary = path.join(scratch, 'mount')
      await run(
        '/usr/bin/cc',
        [
          '-Wall',
          '-Wextra',
          '-Werror',
          '-DMUSE_CREATED_STANDALONE',
          path.join(process.cwd(), 'test', 'unit', 'helpers', 'createdNativeMount.c'),
          '-lcrypto',
          '-o',
          mountBinary,
        ],
        { PATH: '/usr/bin:/bin', TMPDIR: scratch },
      )
      state.mount = (args) => run(mountBinary, args)
    }
  }
}, 30_000) // Building a native helper once is a genuinely long operation on Windows.
afterAll(async () => {
  if (state.scratch !== undefined) await rm(state.scratch, { recursive: true, force: true })
})

async function nativeFixture() {
  const root = await mkdtemp(path.join(state.scratch!, 'case-'))
  const directories = vi.fn(state.call)
  const proof = {
    exited: () => Promise.resolve(true),
    archivedAndClean: () => Promise.resolve(true),
    freeBytes: () => Promise.resolve(100),
    directories,
  }
  const registry = await CreatedRegistry.open(path.join(root, 'records.json'), () => 0, proof)
  const personal = path.join(root, 'personal')
  await mkdir(personal)
  await writeFile(path.join(personal, 'keep'), 'personal')
  return { root, personal, proof, directories, registry }
}

describe('native created-directory protocol', () => {
  it('creates through the base handle and removes a nested tree without following its symlinks', async () => {
    const h = await nativeFixture()
    const created = await h.registry.createTemp('tree')
    const personal = h.personal
    await mkdir(path.join(created.root, 'nested', 'deep'), { recursive: true })
    await writeFile(path.join(created.root, 'nested', 'deep', 'owned'), 'ours')
    await symlink(personal, path.join(created.root, 'link'), 'junction')
    await h.registry.finish('tree', false)
    expect(await h.registry.remove(created.root)).toBe(true)
    expect(await readdir(h.registry.base)).toEqual([])
    expect(await readFile(path.join(personal, 'keep'), 'utf8')).toBe('personal')
    expect(h.directories.mock.calls[1]?.[0][0]).toBe('remove')
  })
  it('refuses wrong base/root identity, an occupied quarantine and a copied or forged marker', async () => {
    const h = await nativeFixture()
    const created = await h.registry.createTemp('tree')
    const base = fileIdentityKey(await lstatIdentity(h.registry.base))!
    const identity = fileIdentityKey(await lstatIdentity(created.root))!
    const args = [
      'remove',
      h.registry.base,
      base,
      path.basename(created.root),
      created.id,
      createHash('sha256').update(h.directories.mock.calls[0]![0][5]!).digest('hex'),
      identity,
    ]
    await expect(state.call!([...args.slice(0, 2), '0:0', ...args.slice(3)])).rejects.toThrow()
    await expect(state.call!([...args.slice(0, 6), '0:0'])).rejects.toThrow()
    await expect(state.call!([...args.slice(0, 5), '0'.repeat(64), identity])).rejects.toThrow()
    await mkdir(path.join(h.registry.base, `.muse-trash-${created.id}`))
    await h.registry.finish('tree', false)
    expect(await h.registry.clean()).toMatchObject({ removed: 0, refused: [created.id] })
    expect(await readdir(created.root)).toContain(RESOURCE_TEMP_MARKER)
  })
  it('does not dispatch cleanup of a reloaded pending record without durable identity', async () => {
    const h = await nativeFixture()
    await h.registry.createTemp('tree')
    const file = path.join(h.root, 'records.json')
    const records: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!Array.isArray(records)) throw new Error('Invalid test registry')
    await writeFile(
      file,
      JSON.stringify(
        records.map((record: unknown) => {
          if (typeof record !== 'object' || record === null) throw new Error('Invalid test record')
          return { ...record, identity: null, state: 'pending' }
        }),
      ),
    )
    const restored = await CreatedRegistry.open(file, () => 0, h.proof, h.registry.base)
    expect(await restored.clean()).toMatchObject({ removed: 0, refused: [expect.any(String)] })
    expect(h.directories).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed helper replies and never falls back to pathname deletion', async () => {
    const h = await nativeFixture()
    const created = await h.registry.createTemp('tree')
    await h.registry.finish('tree', false)
    h.directories.mockResolvedValueOnce('{"removed":false}')
    expect(await h.registry.clean()).toMatchObject({ removed: 0, refused: [created.id] })
    expect(await readdir(created.root)).toContain(RESOURCE_TEMP_MARKER)
    h.directories.mockResolvedValueOnce('{"identity":"0:0"}')
    await expect(h.registry.createTemp('other')).rejects.toThrow()
  })
  it('refuses native device and Linux same-device mount boundaries without following Windows reparse points', async () => {
    const readers = process.platform === 'linux' ? [state.device!, state.mount!] : [state.device!]
    for (const reader of readers) {
      const h = await nativeFixture()
      const created = await h.registry.createTemp('tree')
      const mounted = path.join(created.root, 'mounted')
      if (process.platform === 'win32') {
        await symlink(h.personal, mounted, 'junction')
        await h.registry.finish('tree', false)
        expect(await h.registry.remove(created.root)).toBe(true)
      } else {
        await mkdir(mounted)
        await writeFile(path.join(mounted, 'keep'), 'mounted personal')
        h.directories.mockImplementation(reader)
        await h.registry.finish('tree', false)
        await expect(h.registry.remove(created.root)).rejects.toThrow()
        const trash = path.join(h.registry.base, `.muse-trash-${created.id}`)
        expect(await readFile(path.join(trash, 'mounted', 'keep'), 'utf8')).toBe('mounted personal')
      }
      expect(await readFile(path.join(h.personal, 'keep'), 'utf8')).toBe('personal')
    }
  })
})
