import { execFile } from 'node:child_process'
import { readFile, mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  WINDOWS_TRUSTED_ACL_SCRIPT,
  windowsTrustedPathVerifier,
} from '../../src/runtime/windowsTrustedPath'
import { backgroundProcessRunner } from '../../src/runtime/schedules/nodeBackgroundIo'
import type * as ResourceLauncher from '../../src/core/resources/launcher'

// The ACL policy table runs through the schedule runner's OS helper command;
// since spawn4 that is the governed bounded command, whose admission and
// containment are proved in spawnGovernance and spawnRuntimeAdmission.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const actual = await original<typeof ResourceLauncher>()
  const { fixtureResourceCommand } = await import('./helpers/resourceProcess')
  return { ...actual, execResourceFile: fixtureResourceCommand }
})

const vectors = z
  .strictObject({
    version: z.literal(1),
    windows: z.array(
      z.strictObject({
        name: z.string(),
        path: z.string(),
        leafKind: z.enum(['file', 'directory']),
        isRoot: z.boolean(),
        isDirectory: z.boolean(),
        reparsePoint: z.boolean(),
        sddl: z.string(),
        ok: z.boolean(),
      }),
    ),
  })
  .parse(
    JSON.parse(await readFile(path.resolve('test/fixtures/trusted-path-vectors.json'), 'utf8')),
  )
const run = backgroundProcessRunner({ SystemRoot: process.env['SystemRoot'] })

/** A protected DACL: only the current user, SYSTEM and Administrators. */
async function ownerOnly(directory: string): Promise<void> {
  const system32 = path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32')
  const exec = promisify(execFile)
  const { stdout } = await exec(path.join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'])
  const sid = /"(S-1-[\d-]+)"/u.exec(stdout)?.[1]
  if (sid === undefined) throw new Error('Current user SID unavailable')
  await exec(path.join(system32, 'icacls.exe'), [
    directory,
    '/inheritance:r',
    '/grant:r',
    `*${sid}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F',
  ])
}
async function removeTemporaryDirectory(directory: string): Promise<void> {
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()))
  await rm(directory, { recursive: true, force: true })
}
const verdicts: boolean[] = []
const taskVectors = [
  {
    name: 'current user writer',
    owner: 'S-1-5-21-1-2-3-1000',
    writer: 'S-1-5-21-1-2-3-1000',
    ok: true,
  },
  { name: 'SYSTEM writer', owner: 'S-1-5-18', writer: 'S-1-5-18', ok: true },
  { name: 'Administrators writer', owner: 'S-1-5-32-544', writer: 'S-1-5-32-544', ok: true },
  {
    name: 'untrusted writer',
    owner: 'S-1-5-21-1-2-3-1000',
    writer: 'S-1-5-21-4-5-6-1000',
    ok: false,
  },
  {
    name: 'TrustedInstaller writer',
    owner: 'S-1-5-21-1-2-3-1000',
    writer: 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',
    ok: false,
  },
]
const taskVerdicts: boolean[] = []
beforeAll(async () => {
  if (process.platform !== 'win32') return
  // One native invocation for the complete shared table, within the default deadline.
  const table = Buffer.from(JSON.stringify(vectors.windows)).toString('base64')
  const policy = WINDOWS_TRUSTED_ACL_SCRIPT.replace(
    '[Security.Principal.WindowsIdentity]::GetCurrent()',
    "[pscustomobject]@{ User = [pscustomobject]@{ Value = 'S-1-5-21-1-2-3-1000' } }",
  )
  const taskTable = Buffer.from(JSON.stringify(taskVectors)).toString('base64')
  const script = `$ErrorActionPreference = 'Stop'; ${policy}; $vectors = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${table}')) | ConvertFrom-Json; $results = @(); foreach ($vector in $vectors) { $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetSecurityDescriptorSddlForm($vector.sddl); $results += (-not $vector.reparsePoint -and (Test-TrustedAcl $acl $vector.isRoot $vector.isDirectory)) }; $tasks = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${taskTable}')) | ConvertFrom-Json; foreach ($task in $tasks) { $acl = [Security.AccessControl.FileSecurity]::new(); $acl.SetSecurityDescriptorSddlForm(('O:' + $task.owner + 'D:P(A;;FA;;;' + $task.writer + ')')); $results += (Test-TrustedAcl $acl $false $false $true) }; ConvertTo-Json -Compress -InputObject $results`
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ])
  expect(result.exitCode).toBe(0)
  const parsed = z.array(z.boolean()).parse(JSON.parse(result.stdout))
  verdicts.push(...parsed.slice(0, vectors.windows.length))
  taskVerdicts.push(...parsed.slice(vectors.windows.length))
})

beforeAll(async () => {
  if (process.platform !== 'linux') return
  const policy = WINDOWS_TRUSTED_ACL_SCRIPT.replace(
    '[Security.Principal.WindowsIdentity]::GetCurrent()',
    "[pscustomobject]@{ User = [pscustomobject]@{ Value = 'S-1-5-21-1-2-3-1000' } }",
  )
  const table = Buffer.from(JSON.stringify(taskVectors)).toString('base64')
  // Linux has no native .NET ACL API. Fake descriptors exercise the exact predicate.
  const script = `$ErrorActionPreference = 'Stop'; ${policy}; $tasks = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${table}')) | ConvertFrom-Json; $results = @(); foreach ($task in $tasks) { $acl = [pscustomobject]@{ Owner = $task.owner; Rules = @([pscustomobject]@{ AccessControlType = 'Allow'; IdentityReference = [pscustomobject]@{ Value = $task.writer }; FileSystemRights = [Security.AccessControl.FileSystemRights]::FullControl; PropagationFlags = [Security.AccessControl.PropagationFlags]::None; InheritanceFlags = [Security.AccessControl.InheritanceFlags]::None }) }; $acl | Add-Member -MemberType ScriptMethod -Name GetOwner -Value { param($kind) [pscustomobject]@{ Value = $this.Owner } }; $acl | Add-Member -MemberType ScriptMethod -Name GetAccessRules -Value { param($explicit, $inherited, $kind) $this.Rules }; $results += (Test-TrustedAcl $acl $false $false $true) }; ConvertTo-Json -Compress -InputObject $results`
  let result
  try {
    result = await backgroundProcessRunner(process.env)('pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ])
  } catch (error: unknown) {
    // PowerShell is optional on POSIX CI; real descriptors run on Windows above.
    if (
      error instanceof Error &&
      error.cause instanceof Error &&
      'code' in error.cause &&
      error.cause.code === 'ENOENT'
    )
      return
    throw error
  }
  expect(result.exitCode).toBe(0)
  taskVerdicts.push(...z.array(z.boolean()).parse(JSON.parse(result.stdout)))
})

describe('shared Windows trusted-path vectors', () => {
  it.each(taskVectors.map((vector, index) => ({ ...vector, index })))(
    'scheduler task SID: $name',
    (vector) => {
      if (taskVerdicts.length > 0) expect(taskVerdicts[vector.index]).toBe(vector.ok)
    },
  )
  it.each(vectors.windows.map((vector, index) => ({ ...vector, index })))('$name', (vector) => {
    if (process.platform === 'win32') expect(verdicts[vector.index]).toBe(vector.ok)
    expect(vector.path.replaceAll('\\', '/')).toMatch(/^C:\//)
  })
  it('accepts the rig actual drive-root ACL through the production verifier', async () => {
    if (process.platform !== 'win32') return
    expect(await windowsTrustedPathVerifier(run).verify('C:/', { leafKind: 'directory' })).toEqual({
      ok: true,
      path: 'C:\\',
    })
  })
  it('checks the trusted root and every component below it, root first', async () => {
    if (process.platform !== 'win32') return
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-shared-trust-'))
    try {
      // Owner-only, as on hosted runners: this machine's %TEMP% may grant other
      // accounts Modify, which is above the root and so never checked here.
      await ownerOnly(directory)
      const nested = path.join(directory, 'nested')
      await mkdir(nested)
      const leaf = path.join(nested, 'agent.js')
      await writeFile(leaf, 'fixture')
      const refusing = (refused: string) => {
        const calls: string[] = []
        const verifier = windowsTrustedPathVerifier(async (file, args) => {
          const script = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le')
          calls.push(script)
          return script.includes(`Get-Acl -LiteralPath '${refused.replaceAll("'", "''")}'`)
            ? { exitCode: 0, stdout: 'false' }
            : await run(file, args)
        })
        return { calls, verifier }
      }
      // The default root is the file's own folder: refused there, nothing else asked.
      const atRoot = refusing(nested)
      expect(await atRoot.verifier.verify(leaf, { leafKind: 'file' })).toMatchObject({
        refused: true,
        component: nested,
      })
      expect(atRoot.calls).toHaveLength(1)
      // An explicit root: the root passes, the component below it is refused.
      const belowRoot = refusing(nested)
      expect(
        await belowRoot.verifier.verify(leaf, { leafKind: 'file', root: directory }),
      ).toMatchObject({ refused: true, component: nested })
      expect(belowRoot.calls).toHaveLength(2)
      expect(
        await windowsTrustedPathVerifier(run).verify(leaf, { leafKind: 'file', root: directory }),
      ).toEqual({ ok: true, path: leaf })
      // Fake the reparse metadata: no security settings or persistent junctions change.
      const io = {
        realpath: vi.fn().mockResolvedValue(leaf),
        lstat: vi.fn().mockResolvedValue({
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => true,
        }),
      }
      expect(
        await windowsTrustedPathVerifier(run, io).verify(leaf, { leafKind: 'file' }),
      ).toMatchObject({ refused: true, component: leaf })
    } finally {
      await removeTemporaryDirectory(directory)
    }
  })

  // Owner rule 2026-10-08 (PLAN "Windows paths: any drive"): links at or above
  // the trusted root are normal and trusted by resolved identity; a link below
  // it is refused at the first such component, even one that stays inside.
  it('accepts junctions at and above the trusted root and refuses one below it', async () => {
    if (process.platform !== 'win32') return
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-trust-root-'))
    try {
      await ownerOnly(directory)
      const real = path.join(directory, 'real-profile')
      const data = path.join(real, 'data')
      await mkdir(data, { recursive: true })
      const leaf = path.join(data, 'agent.js')
      await writeFile(leaf, 'fixture')
      const verifier = windowsTrustedPathVerifier(run)

      // A relocated profile: a junction above the root.
      const profile = path.join(directory, 'profile')
      await symlink(real, profile, 'junction')
      const viaProfile = path.join(profile, 'data', 'agent.js')
      expect(
        await verifier.verify(viaProfile, { leafKind: 'file', root: path.join(profile, 'data') }),
      ).toEqual({ ok: true, path: leaf })

      // The root itself a junction to an owner-only folder elsewhere.
      const rootLink = path.join(directory, 'root-link')
      await symlink(data, rootLink, 'junction')
      expect(
        await verifier.verify(path.join(rootLink, 'agent.js'), {
          leafKind: 'file',
          root: rootLink,
        }),
      ).toEqual({ ok: true, path: leaf })
      // Without an explicit root a file's own folder is its root: also a link, also accepted.
      expect(await verifier.verify(path.join(rootLink, 'agent.js'), { leafKind: 'file' })).toEqual({
        ok: true,
        path: leaf,
      })

      // Below the root: a junction escaping the tree, and one staying inside it.
      const tree = path.join(directory, 'tree')
      const outside = path.join(directory, 'outside')
      await mkdir(path.join(tree, 'inner'), { recursive: true })
      await mkdir(outside)
      await writeFile(path.join(outside, 'agent.js'), 'fixture')
      await writeFile(path.join(tree, 'inner', 'agent.js'), 'fixture')
      const escape = path.join(tree, 'escape')
      await symlink(outside, escape, 'junction')
      expect(
        await verifier.verify(path.join(escape, 'agent.js'), { leafKind: 'file', root: tree }),
      ).toMatchObject({ refused: true, component: escape, reason: 'link below the trusted root' })
      const inside = path.join(tree, 'alias')
      await symlink(path.join(tree, 'inner'), inside, 'junction')
      expect(
        await verifier.verify(path.join(inside, 'agent.js'), { leafKind: 'file', root: tree }),
      ).toMatchObject({ refused: true, component: inside, reason: 'link below the trusted root' })

      // Outside the named root, by path.
      expect(
        await verifier.verify(path.join(outside, 'agent.js'), { leafKind: 'file', root: tree }),
      ).toMatchObject({ refused: true, reason: 'outside its trusted root' })

      // Drive-letter spelling differs between the leaf and its root: same folder, accepted.
      const lower = `${leaf.slice(0, 1).toLowerCase()}${leaf.slice(1)}`
      const upperRoot = `${data.slice(0, 1).toUpperCase()}${data.slice(1)}`
      expect(await verifier.verify(lower, { leafKind: 'file', root: upperRoot })).toMatchObject({
        ok: true,
      })
    } finally {
      await removeTemporaryDirectory(directory)
    }
  })
})
