import { readFile, mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
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
  it('checks every intermediate directory and rejects a native junction', async () => {
    if (process.platform !== 'win32') return
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm115-shared-trust-'))
    try {
      const nested = path.join(directory, 'nested')
      await mkdir(nested)
      const leaf = path.join(nested, 'agent.js')
      await writeFile(leaf, 'fixture')
      const calls: string[] = []
      const verifier = windowsTrustedPathVerifier(async (file, args) => {
        const script = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le')
        calls.push(script)
        return script.includes(`Get-Acl -LiteralPath '${nested.replaceAll("'", "''")}'`)
          ? { exitCode: 0, stdout: 'false' }
          : await run(file, args)
      })
      expect(await verifier.verify(leaf, { leafKind: 'file' })).toMatchObject({
        refused: true,
        component: nested,
      })
      expect(calls).toHaveLength(2)
      const junction = path.join(directory, 'junction')
      await symlink(nested, junction, 'junction')
      expect(
        await windowsTrustedPathVerifier(run).verify(path.join(junction, 'agent.js'), {
          leafKind: 'file',
        }),
      ).toMatchObject({ refused: true, component: junction })
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
      expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()))
      await rm(directory, { recursive: true, force: true })
    }
  })
})
