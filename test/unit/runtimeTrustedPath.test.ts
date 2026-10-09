import { spawn } from 'node:child_process'
import { readFile, mkdtemp, mkdir, chmod, realpath, symlink } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as processTree from '../../src/host/processTree'
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
vi.mock('../../src/host/processTree', async (original) => ({
  ...(await original<typeof processTree>()),
}))
const componentSchema = z.strictObject({
  owner: z.enum(['root', 'user', 'foreign']),
  mode: z.int(),
  group: z.optional(
    z.enum([
      'private',
      'shared',
      'unknown',
      'wrongGid',
      'listed',
      'nameMismatch',
      'groupUnusable',
      'passwdUnusable',
      'passwdEmpty',
      'passwdMalformed',
      'userMissing',
      'userMismatch',
      'identityUnusable',
    ]),
  ),
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
const privateVector = vectors.find((vector) => vector.name === 'UPG group-writable')
if (privateVector === undefined) throw new Error('missing private-group vector')
/** Each new proof check refuses with its own precise reason. */
const groupRefusals = new Map<string, string>([
  ['shared', 'shared gid'],
  ['unknown', 'no group'],
  ['wrongGid', 'group/other writable ancestor'],
  ['listed', 'foreign member'],
  ['nameMismatch', 'name mismatch'],
  ['groupUnusable', 'no group'],
  ['passwdUnusable', 'passwd failed'],
  ['passwdEmpty', 'passwd empty'],
  ['passwdMalformed', 'passwd malformed'],
  ['userMissing', 'self missing'],
  ['userMismatch', 'self mismatch'],
  ['identityUnusable', 'user lookup failed'],
])
const portableVectors = [
  ...vectors,
  ...(
    [
      'wrongGid',
      'listed',
      'nameMismatch',
      'groupUnusable',
      'passwdUnusable',
      'passwdEmpty',
      'passwdMalformed',
      'userMissing',
      'userMismatch',
      'identityUnusable',
    ] as const
  ).map((group) => ({
    ...privateVector,
    name: `${group} membership refuses`,
    posix: false,
    components: privateVector.components.map((component) =>
      component.group === undefined ? component : { ...component, group },
    ),
  })),
  ...['world writable', 'broad leaf'].map((name) => ({
    ...privateVector,
    name: `UPG ${name} refuses`,
    posix: false,
    components: privateVector.components.map((component, index) =>
      (name === 'world writable' && index === 1) || (name === 'broad leaf' && index === 2)
        ? { ...component, mode: name === 'world writable' ? 0o777 : 0o775 }
        : component,
    ),
  })),
]
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
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`native path refused: ${stderr}`))
    })
    child.stdin.end(input)
  })
}

/** Debian/Kubuntu passwd row shapes: field 4 is the primary gid. The fixture
 * user takes the real uid/gid (readable even where passwd names are not) so
 * the proof sees a consistent identity on every machine. */
function fixturePasswd(uid: number, gid: number, group: string | undefined): string {
  if (group === 'passwdEmpty') return ''
  const self =
    group === 'userMismatch'
      ? `randy:x:${String(uid + 1)}:${String(gid)}:Randy,,,:/home/randy:/bin/bash`
      : `randy:x:${String(uid)}:${String(gid)}:Randy,,,:/home/randy:/bin/bash`
  const rows = [
    'root:x:0:0:root:/root:/bin/bash',
    'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
    'bin:x:2:2:bin:/bin:/usr/sbin/nologin',
    'sys:x:3:3:sys:/dev:/usr/sbin/nologin',
    'sync:x:4:65534:sync:/bin:/bin/sync',
    'mail:x:8:8:mail:/var/mail:/usr/sbin/nologin',
    'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
    'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
  ]
  if (group === 'userMissing') return rows.join('\n')
  if (group === 'shared') rows.push(`intruder:x:${String(uid + 2)}:${String(gid)}::/:/bin/sh`)
  else rows.push(`intruder:x:${String(uid + 2)}:${String(gid + 2)}::/:/bin/sh`)
  rows.push(self)
  if (group === 'passwdMalformed') rows.push('broken-row')
  return rows.join('\n')
}

function fixtureGroup(gid: number, group: string | undefined): string {
  const name = group === 'nameMismatch' ? 'other' : 'randy'
  const members = group === 'listed' ? 'intruder' : ''
  return `${name}:x:${String(gid)}:${members}`
}

describe('one full-path trust rule', () => {
  it.runIf(process.platform !== 'win32').each(portableVectors)(
    'TypeScript shared vector: $name',
    async (vector) => {
      const paths = vector.components.map((_component, index) =>
        index === 0
          ? path.parse(folder).root
          : `${path.parse(folder).root}${Array.from({ length: index }, (_, offset) => `component${String(offset)}`).join(path.sep)}`,
      )
      const originalOpen = fs.open
      const uid = process.getuid?.() ?? 0
      const gid = process.getgid?.() ?? 0
      const rows = await Promise.all(
        vector.components.map(async (component) => {
          const info = await fs.lstat(folder, { bigint: true })
          info.uid = BigInt({ root: 0, user: uid, foreign: uid + 1 }[component.owner])
          info.gid = BigInt(gid + (component.group === 'wrongGid' ? 1 : 0))
          info.mode = BigInt(component.mode | (component.sticky ? 0o1000 : 0))
          Object.defineProperty(info, 'isDirectory', {
            value: () => component.directory && !component.symlink,
          })
          return info
        }),
      )
      const group = vector.components.find((component) => component.group !== undefined)?.group
      // Every lookup the proof uses is installed before the first awaited
      // product call, and every spy is restored in the same finally, so one
      // failing vector cannot leak mocks into the next.
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('fixture platform')
      const userRead = vi.spyOn(os, 'userInfo').mockImplementation(() => {
        if (group === 'identityUnusable') throw new Error('fixture passwd withheld')
        return { username: 'randy', uid, gid, shell: '/bin/sh', homedir: '/home/randy' }
      })
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
      const lookups: string[] = []
      const lookup = vi.spyOn(processTree, 'runProgram').mockImplementation((_file, args) => {
        lookups.push(args[0] ?? '')
        if (args[0] === 'group') {
          return group === 'unknown' || group === 'groupUnusable'
            ? Promise.reject(new Error('fixture group withheld'))
            : Promise.resolve(fixtureGroup(gid, group))
        }
        if (args[0] === 'passwd') {
          return group === 'passwdUnusable'
            ? Promise.reject(new Error('fixture passwd withheld'))
            : Promise.resolve(fixturePasswd(uid, gid, group))
        }
        throw new Error('removed lookup called')
      })
      Object.defineProperty(process, 'platform', { value: 'linux' })
      try {
        // Native ACL proof is separate from the portable POSIX metadata walk.
        const shouldPass = vector.posix
        const result = verifyTrustedPath(paths.at(-1) ?? '/', true, () =>
          vector.components.at(-1)?.acl === true
            ? Promise.reject(new Error('ELSP_PRIVATE: native ACL'))
            : Promise.resolve(),
        )
        if (shouldPass) {
          await expect(result).resolves.toHaveProperty('directory')
        } else {
          await expect(result).rejects.toThrow('ELSP_PRIVATE')
          const expected = group === undefined ? undefined : groupRefusals.get(group)
          if (expected !== undefined) {
            let refusal: unknown
            try {
              await result
              throw new Error('vector falsely passed')
            } catch (error: unknown) {
              refusal = error
            }
            const detail =
              refusal instanceof Error && refusal.cause instanceof Error
                ? refusal.cause.message
                : String(refusal)
            expect(detail).toContain(expected)
          }
        }
        // The getent initgroups/getgrouplist path is deleted: no vector may use it.
        expect(lookups).not.toContain('initgroups')
      } finally {
        resolving.mockRestore()
        stating.mockRestore()
        opening.mockRestore()
        lookup.mockRestore()
        userRead.mockRestore()
        Object.defineProperty(process, 'platform', platform)
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
  it.runIf(process.platform === 'darwin')(
    'native helper refuses the staff primary group against the real libc',
    async () => {
      if (native === undefined) throw new Error('missing native fixture')
      // This Mac has no user-private group: getgrgid(getgid()) is staff, not
      // the user, with root among its members, so the real lookup refuses.
      const gid = process.getgid?.()
      if (gid === undefined) throw new Error('fixture gid')
      const privateGroup = async (candidate: number) => {
        const output = await nativeRun(native.helperPath, ['private-group', String(candidate)], '')
        return z.strictObject({ private: z.boolean() }).parse(JSON.parse(output))
      }
      const own = await privateGroup(gid)
      expect(own.private).toBe(false)
      for (const other of [0, 1, 12, 80, 99, 501, 65_534]) {
        if (other === gid) continue
        const refused = await privateGroup(other)
        expect(refused.private).toBe(false)
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'a real user-private group admits a group-writable directory, else named skip',
    async (context) => {
      const gid = process.getgid?.()
      if (gid === undefined) throw new Error('fixture gid')
      // Establish admission-shape with the real lookups before asserting.
      let isPrivate: boolean
      if (process.platform === 'darwin') {
        if (native === undefined) throw new Error('missing native fixture')
        const output = await nativeRun(native.helperPath, ['private-group', String(gid)], '')
        isPrivate = z.strictObject({ private: z.boolean() }).parse(JSON.parse(output)).private
      } else {
        const { runProgram } = processTree
        const groupText = await runProgram('/usr/bin/getent', ['group', String(gid)], process.env)
        const usersText = await runProgram('/usr/bin/getent', ['passwd'], process.env)
        const group = groupText.trim().split(':')
        const rows = usersText
          .trim()
          .split('\n')
          .map((line) => line.split(':'))
        const self = rows.find(
          (row) => row[2] !== undefined && Number(row[2]) === process.getuid?.(),
        )
        isPrivate =
          group.length === 4 &&
          self !== undefined &&
          group[0] === self[0] &&
          group[2] === String(gid) &&
          (group[3] ?? '').split(',').every((member) => member === '' || member === self[0]) &&
          rows.every((row) => row[0] === self[0] || row[3] !== String(gid))
      }
      if (!isPrivate) {
        context.skip(
          'the running primary group is not a user-private group here (macOS staff refuses)',
        )
        return
      }
      const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'muse-upg-real-')))
      const directory = path.join(root, 'shared')
      try {
        await mkdir(directory, { mode: 0o775 })
        await chmod(directory, 0o775)
        await expect(verifyTrustedPath(directory, false)).resolves.toHaveProperty('directory')
      } finally {
        await removeFolder(root)
      }
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
