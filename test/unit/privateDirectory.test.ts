import { Buffer } from 'node:buffer'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { runProgram, windowsPowerShell } from '../../src/host/processTree'
import { createPrivateDirectory, PrivateDirectoryRefused } from '../../src/runtime/privateDirectory'
import type { TokenWindowsAcl } from '../../src/runtime/tokenFile'
import { removeFolder } from './helpers/temporaryFolders'

const SID = 'S-1-5-21-100-200-300-1001'
const receipt = {
  ownerSid: SID,
  currentSid: SID,
  protected: true,
  rules: [{ sid: SID, inherited: false, allow: true, fullControl: true }],
}
const FULL_CONTROL = 2_032_127
const OWNER_DIRECTORY_MODE = 0o700
const SENTINEL = 'synthetic sentinel'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await removeFolder(root)
})
async function root(parent = tmpdir()): Promise<string> {
  const made = await fs.mkdtemp(path.join(parent, 'muse-vb-dir-test-'))
  roots.push(made)
  return made
}
const owned: TokenWindowsAcl = { secure: () => Promise.resolve(receipt) }

describe('createPrivateDirectory', () => {
  it('creates one fresh, empty folder in the resolved parent and secures it once as a folder', async () => {
    const parent = await root()
    const secure = vi.fn<TokenWindowsAcl['secure']>(() => Promise.resolve(receipt))
    const directory = await createPrivateDirectory({ parent, acl: { secure } })
    expect(path.dirname(directory)).toBe(await fs.realpath(parent))
    expect(path.basename(directory)).toMatch(/^muse-media-[a-f0-9]{32}$/u)
    expect(secure).toHaveBeenCalledTimes(1)
    expect(secure).toHaveBeenCalledWith(directory, true)
    expect(await fs.readdir(directory)).toEqual([])
    const second = await createPrivateDirectory({ parent, acl: owned })
    expect(second).not.toBe(directory)
  })

  it('refuses an existing folder and leaves it, its contents and its permissions alone', async () => {
    const parent = await root()
    const existing = path.join(parent, 'taken')
    await fs.mkdir(existing)
    await fs.writeFile(path.join(existing, 'kept'), SENTINEL)
    const before = await fs.stat(existing)
    const secure = vi.fn<TokenWindowsAcl['secure']>(() => Promise.resolve(receipt))
    const starting = createPrivateDirectory({ parent, acl: { secure }, name: () => 'taken' })
    await expect(starting).rejects.toBeInstanceOf(PrivateDirectoryRefused)
    expect(secure).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(existing, 'kept'), 'utf8')).toBe(SENTINEL)
    const after = await fs.stat(existing)
    expect(after.mode).toBe(before.mode)
  })

  it.each([
    ['unprotected DACL', () => Promise.resolve({ ...receipt, protected: false })],
    ['foreign owner', () => Promise.resolve({ ...receipt, ownerSid: 'S-1-5-21-9-9-9-2002' })],
    [
      'broad grant',
      () =>
        Promise.resolve({
          ...receipt,
          rules: [
            ...receipt.rules,
            { sid: 'S-1-1-0', inherited: false, allow: true, fullControl: true },
          ],
        }),
    ],
    ['malformed receipt', () => Promise.resolve({})],
    [
      'failed ACL helper',
      () => Promise.reject(new Error(String.raw`synthetic private OS output C:\x`)),
    ],
  ] as const)('refuses a %s and leaves nothing half-made', async (_label, secure) => {
    const parent = await root()
    const starting = createPrivateDirectory({ parent, acl: { secure } })
    await expect(starting).rejects.toThrow(PrivateDirectoryRefused)
    await expect(starting).rejects.toMatchObject({ code: 'EPRIVATE_DIRECTORY' })
    await expect(starting).rejects.not.toThrow(/synthetic|[A-Za-z]:\\|\//u)
    expect(await fs.readdir(parent)).toEqual([])
  })

  it('refuses a folder that something entered before it was secured, and removes it', async () => {
    const parent = await root()
    const secure: TokenWindowsAcl['secure'] = async (directory) => {
      await fs.writeFile(path.join(directory, 'planted'), SENTINEL)
      return receipt
    }
    await expect(createPrivateDirectory({ parent, acl: { secure } })).rejects.toThrow(
      PrivateDirectoryRefused,
    )
    expect(await fs.readdir(parent)).toEqual([])
  })

  it('never removes a folder swapped in for the one it made', async () => {
    const parent = await root()
    const elsewhere = await root()
    await fs.writeFile(path.join(elsewhere, 'kept'), SENTINEL)
    const secure: TokenWindowsAcl['secure'] = async (directory) => {
      await fs.rmdir(directory)
      await fs.symlink(elsewhere, directory, 'junction')
      return { ...receipt, protected: false }
    }
    await expect(createPrivateDirectory({ parent, acl: { secure } })).rejects.toThrow(
      PrivateDirectoryRefused,
    )
    expect(await fs.readFile(path.join(elsewhere, 'kept'), 'utf8')).toBe(SENTINEL)
  })

  it.each(['', '.', '..', '../escape', 'nested/name', String.raw`nested\name`])(
    'refuses the folder name %j without creating anything',
    async (name) => {
      const parent = await root()
      const outside = path.dirname(parent)
      const before = await fs.readdir(outside)
      await expect(
        createPrivateDirectory({ parent, acl: owned, name: () => name }),
      ).rejects.toThrow(PrivateDirectoryRefused)
      expect(await fs.readdir(parent)).toEqual([])
      expect(await fs.readdir(outside)).toEqual(before)
    },
  )

  it('refuses a missing parent and a parent that is a file', async () => {
    const parent = await root()
    await expect(
      createPrivateDirectory({ parent: path.join(parent, 'missing'), acl: owned }),
    ).rejects.toThrow(PrivateDirectoryRefused)
    await fs.writeFile(path.join(parent, 'file'), SENTINEL)
    await expect(
      createPrivateDirectory({ parent: path.join(parent, 'file'), acl: owned }),
    ).rejects.toThrow(PrivateDirectoryRefused)
    expect(await fs.readdir(parent)).toEqual(['file'])
  })

  it('works through a linked parent folder by its resolved identity', async () => {
    const target = await root()
    const holder = await root()
    const link = path.join(holder, 'linked-profile')
    await fs.symlink(target, link, 'junction')
    const directory = await createPrivateDirectory({ parent: link, acl: owned })
    expect(path.dirname(directory)).toBe(await fs.realpath(target))
    expect(await fs.readdir(target)).toEqual([path.basename(directory)])
  })

  it.skipIf(process.platform === 'win32')(
    'makes a real POSIX 0700 folder owned by this user',
    async () => {
      const directory = await createPrivateDirectory({ parent: await root() })
      const info = await fs.stat(directory)
      expect(info.mode & 0o777).toBe(OWNER_DIRECTORY_MODE)
      expect(info.uid).toBe(process.getuid === undefined ? undefined : process.getuid())
    },
  )
})

const aclReadingSchema = z.array(
  z.strictObject({
    owner: z.string(),
    current: z.string(),
    protected: z.boolean(),
    rules: z.array(
      z.strictObject({
        sid: z.string(),
        inherited: z.boolean(),
        rights: z.number(),
        type: z.string(),
        inheritance: z.string(),
        propagation: z.string(),
      }),
    ),
  }),
)

/** Get-Acl, independently of the routine under test, for each path at once. */
async function readAcls(paths: readonly string[]): Promise<z.infer<typeof aclReadingSchema>> {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) throw new Error('SystemRoot is required on Windows')
  const shell = windowsPowerShell(systemRoot)
  const payload = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64')
  const script = `$ErrorActionPreference = 'Stop'
$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$sid = [System.Security.Principal.SecurityIdentifier]
$out = @(foreach ($p in $paths) {
  $acl = Get-Acl -LiteralPath $p
  $rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object { @{ sid = $_.IdentityReference.Value; inherited = $_.IsInherited; rights = [int64]$_.FileSystemRights; type = [string]$_.AccessControlType; inheritance = [string]$_.InheritanceFlags; propagation = [string]$_.PropagationFlags } })
  @{ owner = $acl.GetOwner($sid).Value; current = $current; protected = $acl.AreAccessRulesProtected; rules = $rules }
})
ConvertTo-Json -InputObject $out -Compress -Depth 5`
  const stdout = await runProgram(
    shell.file,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    shell.env,
  )
  return aclReadingSchema.parse(JSON.parse(stdout))
}

describe.skipIf(process.platform !== 'win32')('createPrivateDirectory on real Windows ACLs', () => {
  async function expectOwnerOnly(parent: string): Promise<void> {
    const directory = await createPrivateDirectory({ parent })
    expect(path.dirname(directory)).toBe(await fs.realpath(parent))
    const file = path.join(directory, 'converted.wav')
    await fs.writeFile(file, SENTINEL)
    const child = path.join(directory, 'nested')
    await fs.mkdir(child)
    const [folder, inner, nested] = await readAcls([directory, file, child])
    if (folder === undefined || inner === undefined || nested === undefined)
      throw new Error('Get-Acl answered too few readings')
    expect(folder.protected).toBe(true)
    expect(folder.owner).toBe(folder.current)
    expect(folder.rules).toEqual([
      {
        sid: folder.current,
        inherited: false,
        rights: FULL_CONTROL,
        type: 'Allow',
        inheritance: 'ContainerInherit, ObjectInherit',
        propagation: 'None',
      },
    ])
    // What conversion writes inside inherits the owner's grant and nothing else.
    for (const [reading, inheritance] of [
      [inner, 'None'],
      [nested, 'ContainerInherit, ObjectInherit'],
    ] as const) {
      expect(reading.protected).toBe(false)
      expect(reading.rules).toEqual([
        {
          sid: folder.current,
          inherited: true,
          rights: FULL_CONTROL,
          type: 'Allow',
          inheritance,
          propagation: 'None',
        },
      ])
    }
  }

  it('reads back a protected owner-only DACL that its contents inherit', async () => {
    await expectOwnerOnly(await root())
  })

  it('secures a folder under a junctioned parent at its resolved location', async () => {
    const target = await root()
    const holder = await root()
    const link = path.join(holder, 'junctioned-temp')
    await fs.symlink(target, link, 'junction')
    await expectOwnerOnly(link)
  })

  // A second fixed drive is the rig's to name (the Windows host has D: and
  // E:); nothing assumes the system drive.
  const secondDrive = process.env['MEDIA_VB_SECOND_DRIVE']
  it.skipIf(secondDrive === undefined)('secures a folder on another drive letter', async () => {
    if (secondDrive === undefined) throw new Error('MEDIA_VB_SECOND_DRIVE is required')
    const parent = await root(secondDrive)
    expect(path.parse(await fs.realpath(parent)).root.toUpperCase()).toBe(
      path.parse(path.resolve(secondDrive)).root.toUpperCase(),
    )
    await expectOwnerOnly(parent)
  })

  it('refuses an existing folder without touching its ACL', async () => {
    const parent = await root()
    const existing = path.join(parent, 'taken')
    await fs.mkdir(existing)
    const [before] = await readAcls([existing])
    await expect(createPrivateDirectory({ parent, name: () => 'taken' })).rejects.toThrow(
      PrivateDirectoryRefused,
    )
    const [after] = await readAcls([existing])
    expect(after).toEqual(before)
    expect(before?.protected).toBe(false)
  })
})
