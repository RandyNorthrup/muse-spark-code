import { spawn } from 'node:child_process'
import { readFile, mkdtemp, mkdir, chmod, realpath, symlink } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { verifyTrustedPath } from '../../src/runtime/trustedPath'
import { trustedPrivateRoot } from '../../src/runtime/privateDirectory'
import { darwinProcessHelper } from './helpers/darwinProcessHelper'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async (original) => ({ ...(await original<typeof fs>()) }))
vi.mock('node:os', async (original) => ({ ...(await original<typeof os>()) }))
const componentSchema = z.strictObject({
  owner: z.enum(['root', 'user', 'foreign']),
  mode: z.int(),
  sticky: z.boolean(),
  directory: z.boolean(),
  symlink: z.boolean(),
  acl: z.boolean(),
  writableForeign: z.boolean(),
})
const vectors = z
  .array(
    z.strictObject({
      name: z.string(),
      components: z.array(componentSchema),
      posix: z.boolean(),
      windows: z.boolean(),
    }),
  )
  .parse(JSON.parse(await readFile('test/fixtures/trusted-path-vectors.json', 'utf8')))
const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'muse-trusted-path-')))
const native = process.platform === 'darwin' ? await darwinProcessHelper() : undefined
afterAll(async () => {
  await native?.remove()
  await removeFolder(folder)
})

function nativeRun(file: string, args: readonly string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: { PATH: '/usr/bin:/bin', SystemRoot: process.env['SystemRoot'] },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error('native path refused'))
    })
    child.stdin.end(input)
  })
}

describe('one full-path trust rule', () => {
  it.runIf(process.platform !== 'win32').each(vectors)(
    'TypeScript shared vector: $name',
    async (vector) => {
      const paths = vector.components.map((_component, index) =>
        index === 0
          ? path.parse(folder).root
          : `${path.parse(folder).root}${Array.from({ length: index }, (_, offset) => `component${String(offset)}`).join(path.sep)}`,
      )
      const originalOpen = fs.open
      const rows = await Promise.all(
        vector.components.map(async (component) => {
          const info = await fs.lstat(folder, { bigint: true })
          const uid = process.getuid?.() ?? 0
          info.uid = BigInt({ root: 0, user: uid, foreign: uid + 1 }[component.owner])
          info.mode = BigInt(component.mode | (component.sticky ? 0o1000 : 0))
          Object.defineProperty(info, 'isDirectory', {
            value: () => component.directory && !component.symlink,
          })
          return info
        }),
      )
      const resolving = vi.spyOn(fs, 'realpath').mockResolvedValue(paths.at(-1) ?? '/')
      const stating = vi.spyOn(fs, 'lstat').mockImplementation((file) => {
        const info = rows[paths.indexOf(String(file))]
        if (info === undefined) throw new Error('unexpected vector path')
        return Promise.resolve(info)
      })
      const opening = vi.spyOn(fs, 'open').mockImplementation(async (file) => {
        const handle = await originalOpen(folder, 'r')
        const info = rows[paths.indexOf(String(file))]
        if (info === undefined) throw new Error('unexpected vector open')
        vi.spyOn(handle, 'stat').mockResolvedValue(info)
        return handle
      })
      try {
        // Native ACL proof is separate from the portable POSIX metadata walk.
        const shouldPass = vector.posix
        const result = verifyTrustedPath(paths.at(-1) ?? '/', true, () =>
          vector.components.at(-1)?.acl === true
            ? Promise.reject(new Error('ELSP_PRIVATE: native ACL'))
            : Promise.resolve(),
        )
        if (shouldPass) await expect(result).resolves.toHaveProperty('directory')
        else await expect(result).rejects.toThrow('ELSP_PRIVATE')
      } finally {
        resolving.mockRestore()
        stating.mockRestore()
        opening.mockRestore()
      }
    },
  )
  it.runIf(process.platform === 'darwin')(
    'signed Darwin helper runs the same JSON vectors',
    async () => {
      if (native === undefined) throw new Error('missing native fixture')
      const results = z
        .array(z.boolean())
        .parse(
          JSON.parse(
            await nativeRun(native.helperPath, ['private-path-vectors'], JSON.stringify(vectors)),
          ),
        )
      expect(results).toEqual(vectors.map((vector) => vector.posix))
    },
  )
  it.runIf(process.platform === 'win32')('Windows helper runs the same JSON vectors', async () => {
    const shell = path.join(
      process.env['SystemRoot'] ?? String.raw`C:\Windows`,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const source = path.resolve('native/windows/MuseSparkJob.cs').replaceAll("'", "''")
    const script = `$ErrorActionPreference='Stop'; Add-Type -Path '${source}'; $vectors=[Console]::In.ReadToEnd() | ConvertFrom-Json; $results=@(foreach($vector in $vectors) { $ok=$true; for($i=0;$i -lt $vector.components.Count;$i++) { $r=$vector.components[$i]; $ok=$ok -and [MuseSparkPrivateDirectory]::AllowsComponent($r.owner,$r.directory,$r.symlink,$r.acl,$r.writableForeign,($i -eq $vector.components.Count-1)) }; $ok }); ConvertTo-Json -InputObject $results -Compress`
    const results = z
      .array(z.boolean())
      .parse(
        JSON.parse(
          await nativeRun(
            shell,
            [
              '-NoProfile',
              '-NonInteractive',
              '-EncodedCommand',
              Buffer.from(script, 'utf16le').toString('base64'),
            ],
            JSON.stringify(vectors),
          ),
        ),
      )
    expect(results).toEqual(vectors.map((vector) => vector.windows))
  })
  it.runIf(process.platform !== 'win32')(
    'refuses unsafe XDG ancestry, reports every refusal and selects the next verified root',
    async () => {
      const unsafe = path.join(folder, 'unsafe')
      const runtime = path.join(unsafe, 'runtime')
      const state = path.join(folder, 'state')
      await mkdir(unsafe, { mode: 0o777 })
      await chmod(unsafe, 0o777)
      await mkdir(runtime, { mode: 0o700 })
      await mkdir(state, { mode: 0o700 })
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('fixture platform')
      Object.defineProperty(process, 'platform', { value: 'linux' })
      vi.stubEnv('XDG_RUNTIME_DIR', runtime)
      vi.stubEnv('XDG_STATE_HOME', state)
      vi.stubEnv('XDG_CACHE_HOME', '')
      const diagnostics: string[] = []
      try {
        expect(
          await trustedPrivateRoot(folder, (message) => {
            diagnostics.push(message)
          }),
        ).toBe(state)
        expect(diagnostics[0]).toContain(unsafe)
        expect(diagnostics[0]).toContain('writable ancestor')
        expect(diagnostics.at(-1)).toBe(`ELSP_PRIVATE_ROOT: ${state}`)
      } finally {
        Object.defineProperty(process, 'platform', platform)
        vi.unstubAllEnvs()
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'refuses a symlink above the selected XDG root',
    async () => {
      const parent = path.join(folder, 'real-parent')
      const alias = path.join(folder, 'alias-parent')
      await mkdir(parent, { mode: 0o700 })
      const runtime = path.join(parent, 'runtime')
      await mkdir(runtime, { mode: 0o700 })
      await symlink(parent, alias)
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('fixture platform')
      Object.defineProperty(process, 'platform', { value: 'linux' })
      vi.stubEnv('XDG_RUNTIME_DIR', path.join(alias, 'runtime'))
      vi.stubEnv('XDG_STATE_HOME', runtime)
      const diagnostics: string[] = []
      try {
        expect(
          await trustedPrivateRoot(folder, (message) => {
            diagnostics.push(message)
          }),
        ).toBe(runtime)
        expect(diagnostics[0]).toContain(`${alias}: symlink ancestor`)
      } finally {
        Object.defineProperty(process, 'platform', platform)
        vi.unstubAllEnvs()
      }
      if (native !== undefined)
        await expect(
          nativeRun(native.helperPath, ['private-path', path.join(alias, 'runtime')], ''),
        ).rejects.toThrow('native path refused')
    },
  )
  it.runIf(process.platform !== 'win32').each(['runtime', 'state', 'cache', 'home'])(
    'Linux root order reaches %s only after refusing earlier candidates',
    async (chosen) => {
      const home = path.join(folder, `home-${chosen}`)
      await mkdir(home, { mode: 0o700 })
      const roots = ['runtime', 'state', 'cache']
      const expectedIndex = roots.indexOf(chosen)
      for (const [index, name] of roots.entries()) {
        const directory = path.join(home, name)
        await mkdir(directory, { mode: 0o700 })
        if (index !== expectedIndex) await chmod(directory, 0o755)
        let variable = 'XDG_CACHE_HOME'
        if (name === 'runtime') variable = 'XDG_RUNTIME_DIR'
        else if (name === 'state') variable = 'XDG_STATE_HOME'
        vi.stubEnv(variable, directory)
      }
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('fixture platform')
      const homeRead = vi.spyOn(os, 'homedir').mockReturnValue(home)
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const diagnostics: string[] = []
      try {
        const expected =
          chosen === 'home'
            ? path.join(home, '.local', 'state', 'muse-spark')
            : path.join(home, chosen)
        expect(
          await trustedPrivateRoot(folder, (message) => {
            diagnostics.push(message)
          }),
        ).toBe(expected)
        expect(diagnostics).toHaveLength(chosen === 'home' ? 4 : expectedIndex + 1)
      } finally {
        homeRead.mockRestore()
        Object.defineProperty(process, 'platform', platform)
        vi.unstubAllEnvs()
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'refuses startup without creating state when every root has unsafe ancestry',
    async () => {
      const home = path.join(folder, 'no-safe-home')
      await mkdir(home, { mode: 0o777 })
      await chmod(home, 0o777)
      for (const name of ['XDG_RUNTIME_DIR', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'])
        vi.stubEnv(name, home)
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('fixture platform')
      const homeRead = vi.spyOn(os, 'homedir').mockReturnValue(home)
      Object.defineProperty(process, 'platform', { value: 'linux' })
      const creating = vi.spyOn(fs, 'mkdir')
      const diagnostics: string[] = []
      try {
        await expect(
          trustedPrivateRoot(folder, (message) => {
            diagnostics.push(message)
          }),
        ).rejects.toThrow('no verified runtime root')
        expect(diagnostics).toHaveLength(4)
        expect(diagnostics.every((message) => message.includes(home))).toBe(true)
        expect(creating).not.toHaveBeenCalled()
      } finally {
        creating.mockRestore()
        homeRead.mockRestore()
        Object.defineProperty(process, 'platform', platform)
        vi.unstubAllEnvs()
      }
    },
  )

  it.runIf(process.platform === 'darwin')(
    'chooses this Mac’s verified confstr root and records it',
    async () => {
      if (native === undefined) throw new Error('missing native fixture')
      const diagnostics: string[] = []
      const root = await trustedPrivateRoot(
        path.resolve(native.helperPath, '../../..'),
        (message) => {
          diagnostics.push(message)
        },
      )
      expect(root.replaceAll('\\', '/')).toContain('/private/var/folders/')
      expect(diagnostics).toEqual([`ELSP_PRIVATE_ROOT: ${root}`])
    },
  )
})
