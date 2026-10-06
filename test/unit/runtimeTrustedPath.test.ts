import { spawn } from 'node:child_process'
import { readFile, mkdtemp, mkdir, chmod, realpath, symlink, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as processTree from '../../src/host/processTree'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
      'wrongName',
      'listed',
      'primary',
      'malformed',
      'missingUser',
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
const portableVectors = [
  ...vectors,
  ...(['wrongGid', 'wrongName', 'listed', 'primary', 'malformed', 'missingUser'] as const).map(
    (group) => ({
      ...privateVector,
      name: `${group} membership refuses`,
      posix: false,
      components: privateVector.components.map((component) =>
        component.group === undefined ? component : { ...component, group },
      ),
    }),
  ),
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
const groupFixture = path.join(folder, 'group-lookups')
beforeAll(async () => {
  if (process.platform !== 'darwin') return
  const source = await readFile('native/darwin/Dictation.swift', 'utf8')
  const membership = source.slice(
    source.indexOf('func isUserPrivateGroup('),
    source.indexOf('struct PrivatePathComponent:'),
  )
  // Compile the production lookup function unchanged against test-only libc
  // stand-ins. No OS account, group or membership is modified.
  const fixture = `
import Darwin
import Foundation
final class LookupFixture {
var scenario = "private"
var cursor = 0
func getuid() -> uid_t { 501 }
func getgid() -> gid_t { 20 }
struct User { let pw_name: UnsafeMutablePointer<CChar>?; let pw_uid: uid_t; let pw_gid: gid_t }
struct Group { let gr_name: UnsafeMutablePointer<CChar>?; let gr_mem: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>? }
struct UserEntry { let pointee: User }
struct GroupEntry { let pointee: Group }
let name = strdup("fakeuser")
let other = strdup("other")
let members: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?> = {
    let value = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(capacity: 2)
    value.initialize(repeating: nil, count: 2)
    return value
}()
func getpwuid(_ uid: uid_t) -> UserEntry? { UserEntry(pointee: User(pw_name: name, pw_uid: 501, pw_gid: 20)) }
func getgrgid(_ gid: gid_t) -> GroupEntry? {
    members.pointee = scenario == "listed" ? other : nil
    return GroupEntry(pointee: Group(gr_name: scenario == "wrongName" ? other : name, gr_mem: members))
}
func setpwent() { cursor = 0 }
func endpwent() {}
func getpwent() -> UserEntry? {
    cursor += 1
    if cursor == 1 { return getpwuid(501) }
    if cursor == 2 { return UserEntry(pointee: User(pw_name: other, pw_uid: 502, pw_gid: scenario == "primary" ? 20 : 21)) }
    errno = scenario == "unavailable" ? EIO : 0
    return nil
}
func getgrouplist(_ user: String, _ primary: Int32, _ groups: UnsafeMutablePointer<Int32>?, _ count: inout Int32) -> Int32 {
    if scenario == "unknown" { count = 0; return -1 }
    count = 2
    guard let groups = groups else { return -1 }
    groups[0] = primary
    groups[1] = scenario == "shared" ? 20 : primary
    return 0
}
`
  const cases = `
}
let lookups = LookupFixture()
var results: [Bool] = []
for entry in ["private", "shared", "unknown", "listed", "primary", "wrongName", "wrongGid", "unavailable"] {
    lookups.scenario = entry
    results.append(lookups.isUserPrivateGroup(entry == "wrongGid" ? 21 : 20))
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results))
`
  const file = `${groupFixture}.swift`
  await writeFile(file, fixture + membership + cases)
  await nativeRun('/usr/bin/swiftc', [file, '-o', groupFixture], '')
})
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
      const rows = await Promise.all(
        vector.components.map(async (component) => {
          const info = await fs.lstat(folder, { bigint: true })
          const uid = process.getuid?.() ?? 0
          info.uid = BigInt({ root: 0, user: uid, foreign: uid + 1 }[component.owner])
          info.gid = BigInt((process.getgid?.() ?? 0) + (component.group === 'wrongGid' ? 1 : 0))
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
      const group = vector.components.find((component) => component.group !== undefined)?.group
      const current = os.userInfo()
      const lookup = vi.spyOn(processTree, 'runProgram').mockImplementation((_file, args) => {
        if (args[0] === 'group')
          return Promise.resolve(
            `${group === 'wrongName' ? 'other' : current.username}:x:${String(current.gid)}:${group === 'listed' ? 'other' : ''}`,
          )
        if (args[0] === 'passwd')
          return Promise.resolve(
            `${group === 'missingUser' ? 'absent' : current.username}:x:${String(current.uid)}:${String(current.gid)}::/:/bin/sh\nother:x:${String(current.uid + 1)}:${String(current.gid + (group === 'primary' ? 0 : 1))}::/:/bin/sh`,
          )
        if (args[0] === 'initgroups') {
          if (group === 'unknown') return Promise.reject(new Error('membership unavailable'))
          if (group === 'malformed') return Promise.resolve('other bad-data')
          return Promise.resolve(
            `other ${String(current.gid + 1)}${group === 'shared' ? ` ${String(current.gid)}` : ''}`,
          )
        }
        if (args[0] === 'private-group')
          return Promise.resolve(JSON.stringify({ private: group === 'private' }))
        throw new Error('unexpected membership lookup')
      })
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('fixture platform')
      Object.defineProperty(process, 'platform', { value: 'linux' })
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
        lookup.mockRestore()
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
    'native private-group lookup refuses every other or unknown membership',
    async () => {
      const results = z.array(z.boolean()).parse(JSON.parse(await nativeRun(groupFixture, [], '')))
      expect(results).toEqual([true, false, false, false, false, false, false, false])
      if (native === undefined) throw new Error('missing native fixture')
      const result = z
        .strictObject({ private: z.boolean() })
        .parse(
          JSON.parse(
            await nativeRun(
              native.helperPath,
              ['private-group', String(os.userInfo().gid + 1)],
              '',
            ),
          ),
        )
      expect(result.private).toBe(false)
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
