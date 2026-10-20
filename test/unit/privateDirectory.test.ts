import { Buffer } from 'node:buffer'
import { realpathSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { noWorkspaceChildEnvironment, windowsPowerShell } from '../../src/core/execGuard'
import { runProgram } from '../../src/host/processTree'
import {
  createPrivateDirectory,
  openPrivateRoot,
  PrivateDirectoryRefused,
  PrivateRootRefused,
  type PrivateRoot,
  type WindowsAclReader,
} from '../../src/runtime/privateDirectory'
import { secureOwnerOnly, type TokenWindowsAcl } from '../../src/runtime/tokenFile'
import { removeFolder } from './helpers/temporaryFolders'

const SID = 'S-1-5-21-100-200-300-1001'
const USERS = 'S-1-5-32-545'
const SYSTEM = 'S-1-5-18'
const ADMINISTRATORS = 'S-1-5-32-544'
const FULL_CONTROL = 2_032_127
const READ_AND_EXECUTE = 1_179_817
const receipt = {
  ownerSid: SID,
  currentSid: SID,
  protected: true,
  rules: [{ sid: SID, inherited: false, allow: true, fullControl: true }],
}
const OWNER_DIRECTORY_MODE = 0o700
const SENTINEL = 'synthetic sentinel'

const areas: string[] = []
afterEach(async () => {
  for (const folder of areas.splice(0)) await removeFolder(folder)
})
/** A scratch folder of this test's own, never the shared system temp itself. */
async function area(parent = tmpdir()): Promise<string> {
  const made = await fs.mkdtemp(path.join(parent, 'muse-vb-dir-test-'))
  areas.push(made)
  return made
}
const owned: TokenWindowsAcl = { secure: () => Promise.resolve(receipt) }

interface Rule {
  sid: string
  allow: boolean
  rights: number
}
const reading = (rules: readonly Rule[], ownerSid = SID) => ({
  ownerSid,
  currentSid: SID,
  rules: [{ sid: SID, allow: true, rights: FULL_CONTROL }, ...rules],
})
/** A Windows ACL reading per path: the parent's and the root's can differ. */
function reader(parent: object = reading([]), root: object = reading([])) {
  const calls: string[] = []
  const read: WindowsAclReader['read'] = (directory) => {
    calls.push(directory)
    return Promise.resolve(path.basename(directory) === 'media' ? root : parent)
  }
  return { read, calls }
}

/** A securing ACL that records its calls and answers the receipt. */
function recordingSecure() {
  const calls: (readonly [string, boolean])[] = []
  const secure: TokenWindowsAcl['secure'] = (directory, created) => {
    calls.push([directory, created])
    return Promise.resolve(receipt)
  }
  return { secure, calls }
}

/** A root under a scratch folder, through the fake Windows reading. */
async function fakeRoot(): Promise<PrivateRoot> {
  return await openPrivateRoot(path.join(await area(), 'media'), { reader: reader(), acl: owned })
}

describe('openPrivateRoot', () => {
  it('makes an absent root owner-only before any check passes it, then reads it back', async () => {
    const parent = await area()
    const { secure, calls: secureCalls } = recordingSecure()
    const fake = reader()
    const root = await openPrivateRoot(path.join(parent, 'media'), {
      reader: fake,
      acl: { secure },
    })
    expect(root.path).toBe(path.join(await fs.realpath(parent), 'media'))
    expect(secureCalls).toEqual([[root.path, true]])
    expect(fake.calls.map((directory) => path.basename(directory))).toEqual([
      path.basename(parent),
      'media',
    ])
    // Opening it again checks the existing root and never secures it anew.
    await openPrivateRoot(root.path, { reader: fake, acl: { secure } })
    expect(secureCalls).toHaveLength(1)
  })

  it.each([
    ['Users full control', { sid: USERS, allow: true, rights: FULL_CONTROL }],
    ['Everyone write', { sid: 'S-1-1-0', allow: true, rights: 2 }],
    ['Authenticated Users change permissions', { sid: 'S-1-5-11', allow: true, rights: 262_144 }],
    ['generic all', { sid: USERS, allow: true, rights: 268_435_456 }],
  ])(
    'refuses a parent granting another principal %s, before making anything',
    async (_label, rule) => {
      const parent = await area()
      const { secure, calls: secureCalls } = recordingSecure()
      await expect(
        openPrivateRoot(path.join(parent, 'media'), {
          reader: reader(reading([rule])),
          acl: { secure },
        }),
      ).rejects.toMatchObject({ code: 'EPRIVATE_ROOT' })
      expect(await fs.readdir(parent)).toEqual([])
      expect(secureCalls).toHaveLength(0)
    },
  )

  it('accepts a parent where others may only read (a sandbox group), and denials', async () => {
    const parent = await area()
    const root = await openPrivateRoot(path.join(parent, 'media'), {
      reader: reader(
        reading([
          { sid: USERS, allow: true, rights: READ_AND_EXECUTE },
          { sid: 'S-1-1-0', allow: false, rights: FULL_CONTROL },
        ]),
      ),
      acl: owned,
    })
    expect(await fs.readdir(parent)).toEqual([path.basename(root.path)])
  })

  it('refuses an existing root with any grant beyond the user, SYSTEM and Administrators', async () => {
    const parent = await area()
    await fs.mkdir(path.join(parent, 'media'))
    await fs.writeFile(path.join(parent, 'media', 'kept'), SENTINEL)
    const { secure, calls: secureCalls } = recordingSecure()
    await expect(
      openPrivateRoot(path.join(parent, 'media'), {
        reader: reader(
          reading([]),
          reading([{ sid: USERS, allow: true, rights: READ_AND_EXECUTE }]),
        ),
        acl: { secure },
      }),
    ).rejects.toBeInstanceOf(PrivateRootRefused)
    // Checked, never repaired, never removed.
    expect(secureCalls).toHaveLength(0)
    expect(await fs.readdir(path.join(parent, 'media'))).toEqual(['kept'])
  })

  it('accepts a root held by the user with SYSTEM and Administrators', async () => {
    const parent = await area()
    await fs.mkdir(path.join(parent, 'media'))
    const trusted = reading(
      [
        { sid: SYSTEM, allow: true, rights: FULL_CONTROL },
        { sid: ADMINISTRATORS, allow: true, rights: FULL_CONTROL },
      ],
      ADMINISTRATORS,
    )
    const root = await openPrivateRoot(path.join(parent, 'media'), {
      reader: reader(trusted, trusted),
    })
    expect(path.basename(root.path)).toBe('media')
  })

  it.each([
    ['a foreign owner', reading([], 'S-1-5-21-9-9-9-2002')],
    ['a malformed reading', {}],
  ])('refuses a root reading with %s and removes the root it made', async (_label, bad) => {
    const parent = await area()
    await expect(
      openPrivateRoot(path.join(parent, 'media'), { reader: reader(reading([]), bad), acl: owned }),
    ).rejects.toBeInstanceOf(PrivateRootRefused)
    expect(await fs.readdir(parent)).toEqual([])
  })

  it('refuses a failed reader and a root it could not make owner-only, leaving nothing', async () => {
    const parent = await area()
    const failing = { read: () => Promise.reject(new Error(String.raw`synthetic C:\private`)) }
    const refused = openPrivateRoot(path.join(parent, 'media'), { reader: failing, acl: owned })
    await expect(refused).rejects.toBeInstanceOf(PrivateRootRefused)
    await expect(refused).rejects.not.toThrow(/synthetic|[A-Za-z]:\\|\//u)
    await expect(
      openPrivateRoot(path.join(parent, 'media'), {
        reader: reader(),
        acl: { secure: () => Promise.resolve({ ...receipt, protected: false }) },
      }),
    ).rejects.toBeInstanceOf(PrivateRootRefused)
    expect(await fs.readdir(parent)).toEqual([])
  })

  it('refuses a root that is itself a link, but follows links above it', async () => {
    const target = await area()
    const holder = await area()
    await fs.symlink(target, path.join(holder, 'media'), 'junction')
    await expect(
      openPrivateRoot(path.join(holder, 'media'), { reader: reader(), acl: owned }),
    ).rejects.toBeInstanceOf(PrivateRootRefused)
    // A relocated profile folder above the root is normal.
    const linked = path.join(holder, 'linked-profile')
    await fs.symlink(target, linked, 'junction')
    const root = await openPrivateRoot(path.join(linked, 'media'), {
      reader: reader(),
      acl: owned,
    })
    expect(root.path).toBe(path.join(await fs.realpath(target), 'media'))
  })

  it.each(['.', '..', 'two words'])('refuses the root name %j', async (name) => {
    const parent = await area()
    // Concatenated: path.join would normalize the dots away.
    await expect(
      openPrivateRoot(`${parent}${path.sep}${name}`, { reader: reader(), acl: owned }),
    ).rejects.toBeInstanceOf(PrivateRootRefused)
    expect(await fs.readdir(parent)).toEqual([])
  })
})

describe.skipIf(process.platform === 'win32')('openPrivateRoot on real POSIX modes', () => {
  it('makes a real 0700 root owned by this user', async () => {
    const root = await openPrivateRoot(path.join(await area(), 'media'))
    const info = await fs.stat(root.path)
    expect(info.mode & 0o777).toBe(OWNER_DIRECTORY_MODE)
    expect(info.uid).toBe(process.getuid === undefined ? undefined : process.getuid())
  })

  it('refuses an existing root with group or other bits, without repairing it', async () => {
    const parent = await area()
    await fs.mkdir(path.join(parent, 'media'))
    await fs.chmod(path.join(parent, 'media'), 0o750)
    await expect(openPrivateRoot(path.join(parent, 'media'))).rejects.toBeInstanceOf(
      PrivateRootRefused,
    )
    const info = await fs.stat(path.join(parent, 'media'))
    expect(info.mode & 0o777).toBe(0o750)
  })

  it('refuses, before making anything, a parent others can write (no sticky bit)', async () => {
    const parent = await area()
    await fs.chmod(parent, 0o777)
    await expect(openPrivateRoot(path.join(parent, 'media'))).rejects.toBeInstanceOf(
      PrivateRootRefused,
    )
    expect(await fs.readdir(parent)).toEqual([])
  })
})

describe('createPrivateDirectory', () => {
  it('creates one fresh, empty folder in its root and secures it once as a folder', async () => {
    const root = await fakeRoot()
    const { secure, calls: secureCalls } = recordingSecure()
    const directory = await createPrivateDirectory(root, { acl: { secure } })
    expect(path.dirname(directory)).toBe(root.path)
    // It carries its root's owner token, which crash reclaim reads (RVMEDIAV3 3).
    expect(root.owner).toMatch(/^[a-f0-9]{32}$/u)
    expect(path.basename(directory)).toMatch(
      new RegExp(`^muse-media-${root.owner}-[a-f0-9]{32}$`, 'u'),
    )
    expect(secureCalls).toEqual([[directory, true]])
    expect(await fs.readdir(directory)).toEqual([])
    const second = await createPrivateDirectory(root, { acl: owned })
    expect(second).not.toBe(directory)
  })

  it('refuses once its root is no longer the folder it verified, making nothing', async () => {
    const root = await fakeRoot()
    await fs.rename(root.path, `${root.path}-moved`)
    await fs.mkdir(root.path, { mode: OWNER_DIRECTORY_MODE })
    await expect(createPrivateDirectory(root, { acl: owned })).rejects.toMatchObject({
      code: 'EPRIVATE_DIRECTORY',
    })
    expect(await fs.readdir(root.path)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')(
    'refuses once its POSIX root has gained group or other bits',
    async () => {
      const root = await openPrivateRoot(path.join(await area(), 'media'))
      await fs.chmod(root.path, 0o755)
      await expect(createPrivateDirectory(root)).rejects.toBeInstanceOf(PrivateDirectoryRefused)
      expect(await fs.readdir(root.path)).toEqual([])
    },
  )

  it('refuses an existing folder and leaves it, its contents and its permissions alone', async () => {
    const root = await fakeRoot()
    const existing = path.join(root.path, 'taken')
    await fs.mkdir(existing)
    await fs.writeFile(path.join(existing, 'kept'), SENTINEL)
    const before = await fs.stat(existing)
    const { secure, calls: secureCalls } = recordingSecure()
    const starting = createPrivateDirectory(root, { acl: { secure }, name: () => 'taken' })
    await expect(starting).rejects.toBeInstanceOf(PrivateDirectoryRefused)
    expect(secureCalls).toHaveLength(0)
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
    const root = await fakeRoot()
    const starting = createPrivateDirectory(root, { acl: { secure } })
    await expect(starting).rejects.toThrow(PrivateDirectoryRefused)
    await expect(starting).rejects.toMatchObject({ code: 'EPRIVATE_DIRECTORY' })
    await expect(starting).rejects.not.toThrow(/synthetic|[A-Za-z]:\\|\//u)
    expect(await fs.readdir(root.path)).toEqual([])
  })

  it('refuses a folder that something entered before it was secured, and removes it', async () => {
    const root = await fakeRoot()
    const secure: TokenWindowsAcl['secure'] = async (directory) => {
      await fs.writeFile(path.join(directory, 'planted'), SENTINEL)
      return receipt
    }
    await expect(createPrivateDirectory(root, { acl: { secure } })).rejects.toThrow(
      PrivateDirectoryRefused,
    )
    expect(await fs.readdir(root.path)).toEqual([])
  })

  it('never removes a folder swapped in for the one it made', async () => {
    const root = await fakeRoot()
    const elsewhere = await area()
    await fs.writeFile(path.join(elsewhere, 'kept'), SENTINEL)
    const secure: TokenWindowsAcl['secure'] = async (directory) => {
      await fs.rmdir(directory)
      await fs.symlink(elsewhere, directory, 'junction')
      return { ...receipt, protected: false }
    }
    await expect(createPrivateDirectory(root, { acl: { secure } })).rejects.toThrow(
      PrivateDirectoryRefused,
    )
    expect(await fs.readFile(path.join(elsewhere, 'kept'), 'utf8')).toBe(SENTINEL)
  })

  // `two words` is one valid component on every OS: only the plain-name rule refuses it.
  it.each(['', '.', '..', '../escape', 'nested/name', String.raw`nested\name`, 'two words'])(
    'refuses the folder name %j without creating anything',
    async (name) => {
      const root = await fakeRoot()
      const outside = path.dirname(root.path)
      await expect(createPrivateDirectory(root, { acl: owned, name: () => name })).rejects.toThrow(
        PrivateDirectoryRefused,
      )
      expect(await fs.readdir(root.path)).toEqual([])
      expect(await fs.readdir(outside)).toEqual(['media'])
    },
  )

  it.skipIf(process.platform === 'win32')(
    'makes a real POSIX 0700 folder owned by this user',
    async () => {
      const root = await openPrivateRoot(path.join(await area(), 'media'))
      const directory = await createPrivateDirectory(root)
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

function systemRoot(): string {
  const root = process.env['SystemRoot']
  if (root === undefined) throw new Error('SystemRoot is required on Windows')
  return root
}

/** Get-Acl, independently of the routine under test, for each path at once. */
async function readAcls(paths: readonly string[]): Promise<z.infer<typeof aclReadingSchema>> {
  const shell = windowsPowerShell(systemRoot())
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

/** A real inheritable Users full-control grant, as a shared temp folder may carry. */
async function grantUsers(folder: string): Promise<void> {
  await runProgram(
    path.win32.join(systemRoot(), 'System32', 'icacls.exe'),
    [folder, '/grant', `*${USERS}:(OI)(CI)F`],
    noWorkspaceChildEnvironment('win32', { SystemRoot: systemRoot() }, realpathSync),
  )
}

/** A private scratch area: this machine's temp folder may grant sandbox groups write. */
async function privateArea(parent = tmpdir()): Promise<string> {
  const folder = await area(parent)
  await secureOwnerOnly(folder, 'directory')
  return folder
}

describe.skipIf(process.platform !== 'win32')('the private root on real Windows ACLs', () => {
  async function expectOwnerOnly(parent: string): Promise<void> {
    const root = await openPrivateRoot(path.join(parent, 'media'))
    expect(path.dirname(root.path)).toBe(await fs.realpath(parent))
    const directory = await createPrivateDirectory(root)
    const file = path.join(directory, 'converted.wav')
    await fs.writeFile(file, SENTINEL)
    const child = path.join(directory, 'nested')
    await fs.mkdir(child)
    const [rootAcl, folder, inner, nested] = await readAcls([root.path, directory, file, child])
    if (
      rootAcl === undefined ||
      folder === undefined ||
      inner === undefined ||
      nested === undefined
    )
      throw new Error('Get-Acl answered too few readings')
    // The root a new folder inherits from already holds only the owner.
    for (const reading of [rootAcl, folder]) {
      expect(reading.protected).toBe(true)
      expect(reading.owner).toBe(reading.current)
      expect(reading.rules).toEqual([
        {
          sid: reading.current,
          inherited: false,
          rights: FULL_CONTROL,
          type: 'Allow',
          inheritance: 'ContainerInherit, ObjectInherit',
          propagation: 'None',
        },
      ])
    }
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

  it('makes an owner-only root whose folders and contents inherit only the owner', async () => {
    await expectOwnerOnly(await privateArea())
  })

  it('refuses a parent with an inheritable Users full-control grant before making anything', async () => {
    const parent = await privateArea()
    await grantUsers(parent)
    await expect(openPrivateRoot(path.join(parent, 'media'))).rejects.toMatchObject({
      code: 'EPRIVATE_ROOT',
    })
    expect(await fs.readdir(parent)).toEqual([])
  })

  it('refuses an existing root that carries a Users grant, leaving its ACL alone', async () => {
    const parent = await privateArea()
    const existing = path.join(parent, 'media')
    await fs.mkdir(existing)
    await grantUsers(existing)
    const [before] = await readAcls([existing])
    await expect(openPrivateRoot(existing)).rejects.toBeInstanceOf(PrivateRootRefused)
    const [after] = await readAcls([existing])
    expect(after).toEqual(before)
  })

  it('makes its root under a junctioned parent at the resolved location', async () => {
    const target = await privateArea()
    const holder = await privateArea()
    const link = path.join(holder, 'junctioned-storage')
    await fs.symlink(target, link, 'junction')
    await expectOwnerOnly(link)
  })

  // Second fixed drives are the rig's to name; nothing assumes the system
  // drive. The Windows host has NTFS E: and exFAT D:, which holds no ACLs.
  const secondDrive = process.env['MEDIA_VB_SECOND_DRIVE']
  it.skipIf(secondDrive === undefined)('makes its root on another drive letter', async () => {
    if (secondDrive === undefined) throw new Error('MEDIA_VB_SECOND_DRIVE is required')
    const parent = await privateArea(secondDrive)
    expect(path.parse(await fs.realpath(parent)).root.toUpperCase()).toBe(
      path.parse(path.resolve(secondDrive)).root.toUpperCase(),
    )
    await expectOwnerOnly(parent)
  })

  const aclFreeDrive = process.env['MEDIA_VB_NO_ACL_DRIVE']
  it.skipIf(aclFreeDrive === undefined)(
    'refuses a root on a drive that cannot hold an ACL (exFAT, FAT) and leaves nothing',
    async () => {
      if (aclFreeDrive === undefined) throw new Error('MEDIA_VB_NO_ACL_DRIVE is required')
      const parent = await area(aclFreeDrive)
      await expect(openPrivateRoot(path.join(parent, 'media'))).rejects.toBeInstanceOf(
        PrivateRootRefused,
      )
      expect(await fs.readdir(parent)).toEqual([])
    },
  )

  it('refuses an existing folder in the root without touching its ACL', async () => {
    const root = await openPrivateRoot(path.join(await privateArea(), 'media'))
    const existing = path.join(root.path, 'taken')
    await fs.mkdir(existing)
    const [before] = await readAcls([existing])
    await expect(createPrivateDirectory(root, { name: () => 'taken' })).rejects.toThrow(
      PrivateDirectoryRefused,
    )
    const [after] = await readAcls([existing])
    expect(after).toEqual(before)
    expect(before?.protected).toBe(false)
  })
})
