import './helpers/lspPrivateDirectoryMock'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  rename,
  realpath,
  symlink,
} from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as processTree from '../../src/host/processTree'
import {
  openPrivateRecord,
  privateDirectory,
  writePrivateRecord,
} from '../../src/runtime/lsp/registry'
import { processAuthority } from '../../src/runtime/lsp/processAuthority'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../src/host/processTree', async (importOriginal) => ({
  ...(await importOriginal<typeof processTree>()),
}))
vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-registry-')))
afterAll(() => removeFolder(folder))

// Inject the interleaving after the real no-follow open has acquired its fd.
function afterOpen(file: string, inspect: (handle: FileHandle) => Promise<void>) {
  const actualOpen = fs.open
  return vi.spyOn(fs, 'open').mockImplementation(async (name, flags, mode) => {
    const handle = await actualOpen(name, flags, mode)
    if (name === file) await inspect(handle)
    return handle
  })
}
function changedMetadata(file: string, change: (metadata: BigIntStats) => void) {
  return afterOpen(file, async (handle) => {
    const metadata = await handle.stat({ bigint: true })
    change(metadata)
    vi.spyOn(handle, 'stat').mockResolvedValue(metadata)
  })
}

describe('M104L private registry authority', () => {
  it.runIf(process.platform !== 'win32')(
    'creates 0700 directories and 0600 records, refusing hard links and changed descriptors',
    async () => {
      const directory = path.join(folder, 'private')
      expect(await privateDirectory(directory, true)).toEqual({ isNew: true })
      const createdDirectory = await lstat(directory)
      expect(createdDirectory.mode & 0o777).toBe(0o700)
      const record = path.join(directory, 'owner.json')
      await writePrivateRecord(record, '{}')
      const createdRecord = await lstat(record)
      expect(createdRecord.mode & 0o777).toBe(0o600)
      const handle = await openPrivateRecord(record)
      await handle.close()
      const metadata = vi.spyOn(fs, 'lstat')
      const changed = await fs.stat(record, { bigint: true })
      changed.ino += 1n
      metadata.mockResolvedValueOnce(changed)
      try {
        await expect(openPrivateRecord(record)).rejects.toThrow('ELSP_PRIVATE')
      } finally {
        metadata.mockRestore()
      }
      await link(record, path.join(directory, 'hard-link'))
      await expect(openPrivateRecord(record)).rejects.toThrow('ELSP_PRIVATE')
    },
  )
  it.runIf(process.platform !== 'win32')(
    'refuses the review symlink-substitution setup at an unsafe parent before creation',
    async () => {
      const parent = path.join(folder, 'unsafe-parent')
      const directory = path.join(parent, 'private')
      await mkdir(parent, { mode: 0o777 })
      await chmod(parent, 0o777)
      const creating = vi.spyOn(fs, 'mkdir')
      try {
        await expect(privateDirectory(directory, true)).rejects.toThrow('ELSP_PRIVATE')
        expect(creating).not.toHaveBeenCalled()
        await expect(readFile(path.join(directory, 'owner.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } finally {
        creating.mockRestore()
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'refuses an untrusted root, a foreign ancestor, and a symlink ancestor',
    async () => {
      const parent = path.join(folder, 'ancestor')
      await mkdir(parent, { mode: 0o700 })
      const opening = changedMetadata(parent, (metadata) => {
        metadata.uid += 1n
      })
      try {
        await expect(privateDirectory(path.join(parent, 'foreign'), true)).rejects.toThrow(
          'ELSP_PRIVATE',
        )
      } finally {
        opening.mockRestore()
      }
      const alias = path.join(folder, 'ancestor-alias')
      await symlink(parent, alias)
      await expect(privateDirectory(path.join(alias, 'private'), true)).rejects.toThrow()
    },
  )
  it.runIf(process.platform !== 'win32')(
    'refuses a safe held directory whose pathname becomes a substituted symlink',
    async () => {
      const directory = path.join(folder, 'safe-held-race')
      const target = path.join(folder, 'safe-held-target')
      await mkdir(directory, { mode: 0o700 })
      await mkdir(target, { mode: 0o755 })
      const opening = afterOpen(directory, async () => {
        await rename(directory, `${directory}-held`)
        await symlink(target, directory)
      })
      try {
        await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
      } finally {
        opening.mockRestore()
      }
    },
  )

  it.runIf(process.platform !== 'win32')(
    'does not publish record contents when its verified parent is replaced before the write',
    async () => {
      const directory = path.join(folder, 'record-parent-race')
      const target = path.join(folder, 'redirected')
      await mkdir(directory, { mode: 0o700 })
      await mkdir(target, { mode: 0o777 })
      const file = path.join(directory, 'owner.json')
      const opening = afterOpen(file, async () => {
        await rename(directory, `${directory}-held`)
        await symlink(target, directory)
      })
      try {
        await expect(writePrivateRecord(file, 'private-control-sentinel')).rejects.toThrow(
          'ELSP_PRIVATE',
        )
        expect(await readFile(path.join(`${directory}-held`, 'owner.json'), 'utf8')).toBe('')
        await expect(readFile(path.join(target, 'owner.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } finally {
        opening.mockRestore()
      }
    },
  )
  it.runIf(process.platform !== 'win32').each([0o700, 0o777])(
    'refuses substitution and restoration during exclusive creation with target mode %s before writing contents',
    async (mode) => {
      const directory = path.join(folder, `restore-original-${String(mode)}`)
      const target = path.join(folder, `restore-target-${String(mode)}`)
      await mkdir(directory, { mode: 0o700 })
      await mkdir(target, { mode })
      await chmod(target, mode)
      const file = path.join(directory, 'owner.json')
      const nativeOpen = fs.open
      const opening = vi.spyOn(fs, 'open').mockImplementation(async (name, flags, mode) => {
        if (name !== file) return await nativeOpen(name, flags, mode)
        await rename(directory, `${directory}-held`)
        await symlink(target, directory)
        try {
          return await nativeOpen(name, flags, mode)
        } finally {
          await fs.unlink(directory)
          await rename(`${directory}-held`, directory)
        }
      })
      try {
        await expect(writePrivateRecord(file, 'private-control-sentinel')).rejects.toThrow(
          'ELSP_PRIVATE',
        )
        expect(await readFile(path.join(target, 'owner.json'), 'utf8')).toBe('')
        await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        opening.mockRestore()
      }
    },
  )

  it.runIf(process.platform !== 'win32').each(['foreignOwner', 'broadMode', 'extraLink'])(
    'rejects empty record fstat %s before its first write',
    async (fault) => {
      const directory = path.join(folder, `record-${fault}`)
      await mkdir(directory, { mode: 0o700 })
      const file = path.join(directory, 'owner.json')
      const opening = changedMetadata(file, (metadata) => {
        if (fault === 'foreignOwner') metadata.uid += 1n
        else if (fault === 'broadMode') metadata.mode |= 0o044n
        else metadata.nlink += 1n
      })
      try {
        await expect(writePrivateRecord(file, 'private-control-sentinel')).rejects.toThrow(
          'ELSP_PRIVATE',
        )
        expect(await readFile(file, 'utf8')).toBe('')
      } finally {
        opening.mockRestore()
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'never overwrites a record or follows an occupied leaf symlink',
    async () => {
      const directory = path.join(folder, 'exclusive-records')
      await mkdir(directory, { mode: 0o700 })
      const file = path.join(directory, 'owner.json')
      await writePrivateRecord(file, 'original')
      await expect(writePrivateRecord(file, 'replacement')).rejects.toMatchObject({
        code: 'EEXIST',
      })
      expect(await readFile(file, 'utf8')).toBe('original')
      const alias = path.join(directory, 'alias.json')
      await symlink(file, alias)
      await expect(writePrivateRecord(alias, 'replacement')).rejects.toThrow()
      expect(await readFile(file, 'utf8')).toBe('original')
    },
  )

  it.runIf(process.platform !== 'win32')(
    'refuses a pre-existing completed receipt without replacing its generation',
    async () => {
      const directory = path.join(folder, 'exclusive-receipt')
      await mkdir(directory, { mode: 0o700 })
      const authority = await processAuthority(folder, directory)
      const root = { pid: process.pid, startTime: '1' }
      const binding = {
        generation: 'a'.repeat(32),
        ownerId: '00000000-0000-4000-8000-000000000001',
        ticketId: '00000000-0000-4000-8000-000000000002',
        guardian: root,
        root,
      }
      const file = path.join(directory, 'owner.tree')
      await authority.writeReceipt(file, binding, [root], true)
      const before = await readFile(file, 'utf8')
      await expect(
        authority.writeReceipt(file, { ...binding, generation: 'b'.repeat(32) }, [root], true),
      ).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(file, 'utf8')).toBe(before)
    },
  )

  it.runIf(process.platform === 'darwin')(
    'verifies the empty held record ACL before writing any content',
    async () => {
      const directory = path.join(folder, 'record-acl')
      await mkdir(directory, { mode: 0o700 })
      const file = path.join(directory, 'owner.json')
      const opening = afterOpen(file, async () => {
        await processTree.runProgram('/bin/chmod', ['+a', 'user:nobody allow read', file], {})
      })
      try {
        await expect(writePrivateRecord(file, 'private-control-sentinel')).rejects.toThrow(
          'ELSP_PRIVATE',
        )
        expect(await readFile(file, 'utf8')).toBe('')
        expect(opening).toHaveBeenCalledWith(file, expect.any(Number), 0o600)
      } finally {
        opening.mockRestore()
      }
    },
  )

  it.runIf(process.platform === 'darwin')(
    'refuses a macOS extended ACL on the held directory fd',
    async () => {
      const directory = path.join(folder, 'acl')
      await mkdir(directory, { mode: 0o700 })
      await processTree.runProgram('/bin/chmod', ['+a', 'user:nobody allow read', directory], {})
      await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
    },
  )
  it.runIf(process.platform !== 'win32')(
    'uses no-follow fstat and refuses a foreign directory owner before trusting its path',
    async () => {
      const directory = path.join(folder, 'foreign-directory')
      await mkdir(directory, { mode: 0o700 })
      const opening = changedMetadata(directory, (metadata) => {
        metadata.uid += 1n
      })
      const restating = vi.spyOn(fs, 'lstat')
      try {
        await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
        expect(opening).toHaveBeenCalledWith(directory, expect.any(Number))
        expect(restating).not.toHaveBeenCalledWith(directory, { bigint: true })
      } finally {
        opening.mockRestore()
        restating.mockRestore()
      }
    },
  )
  it.runIf(process.platform === 'darwin')(
    'binds the native ACL receipt to the exact fstat descriptor identity',
    async () => {
      const directory = path.join(folder, 'descriptor-receipt')
      await mkdir(directory, { mode: 0o700 })
      const opening = changedMetadata(directory, (metadata) => {
        metadata.ino += 1n
      })
      try {
        await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
      } finally {
        opening.mockRestore()
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'creates with final 0700 permissions and refuses a replacement before fd verification',
    async () => {
      const directory = path.join(folder, 'creation-race')
      const actualOpen = fs.open
      const creating = vi.spyOn(fs, 'mkdir')
      const opening = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
        if (file === directory) await chmod(directory, 0o755)
        return await actualOpen(file, flags, mode)
      })
      try {
        await expect(privateDirectory(directory, true)).rejects.toThrow('ELSP_PRIVATE')
        expect(creating).toHaveBeenCalledWith(directory, { mode: 0o700 })
        const unchanged = await lstat(directory)
        expect(unchanged.mode & 0o777).toBe(0o755)
      } finally {
        creating.mockRestore()
        opening.mockRestore()
      }
    },
  )
  it.runIf(process.platform === 'darwin')(
    'refuses an unsafe held inode even when its path is replaced by a safe directory during the ACL probe',
    async () => {
      const directory = path.join(folder, 'acl-race')
      await mkdir(directory, { mode: 0o700 })
      await processTree.runProgram('/bin/chmod', ['+a', 'user:nobody allow read', directory], {})
      const actualOpen = fs.open
      const opening = vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
        const handle = await actualOpen(file, flags, mode)
        if (file === directory) {
          await rename(directory, `${directory}-held`)
          await mkdir(directory, { mode: 0o700 })
        }
        return handle
      })
      try {
        await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
      } finally {
        opening.mockRestore()
      }
    },
  )
  it('requires protected owner/SYSTEM creation and same-handle non-reparse ACL proof in the shipped Windows helper', async () => {
    const csharp = await readFile('native/windows/MuseSparkJob.cs', 'utf8')
    const helper = csharp.slice(csharp.indexOf('public static class MuseSparkPrivateDirectory'))
    expect(helper).toContain('security.SetOwner(current)')
    expect(helper).toContain('security.SetAccessRuleProtection(true, false)')
    expect(helper).toContain('foreach (var sid in new[] { current, system })')
    expect(helper).toContain('attributes.Descriptor = pinned.AddrOfPinnedObject()')
    expect(helper).toContain('CreateDirectoryW(path, ref attributes)')
    expect(helper).toContain('GetFileInformationByHandle(handle, out info)')
    expect(helper).toContain('(info.Attributes & REPARSE) != 0')
    expect(helper).toContain('GetSecurityInfo(handle, 1, OWNER_DACL')
    expect(helper).toContain('current.Equals(security.Owner)')
    expect(helper).toContain('DiscretionaryAclProtected) == 0')
    expect(helper).toContain(
      '!current.Equals(ace.SecurityIdentifier) && !system.Equals(ace.SecurityIdentifier)',
    )
    expect(helper).toContain('SHARE_READ_WRITE = 3')
    expect(helper).not.toContain('Set-Acl')
    expect(helper).toContain('public static void VerifyParents')
    expect(helper).toContain('throw new InvalidOperationException("writable parent")')
    expect(helper).toContain(
      'CreateRecordW(path, READ_CONTROL | GENERIC_WRITE, SHARE_READ_WRITE, ref attributes, CREATE_NEW, OPEN_REPARSE_BACKUP',
    )
    const writing = helper.slice(helper.indexOf('public static void WriteRecord'))
    expect(writing).toContain('Inspect(handle, false, false)')
    expect(writing).toContain('actual.Volume != parentInfo.Volume')
    expect(writing.indexOf('Inspect(handle, false, false)')).toBeLessThan(
      writing.indexOf('stream.Write(bytes'),
    )
    expect(writing.indexOf('stream.Write(bytes')).toBeLessThan(
      writing.indexOf('CloseHandle(parent)'),
    )
  })
  it.each(['created', 'foreignReplacement', 'junctionReplacement', 'inheritedAcl'])(
    'Windows native creation %s cannot use a create-then-harden path',
    async (fault) => {
      const runner = vi
        .spyOn(processTree, 'runProgram')
        .mockImplementation(() =>
          fault === 'created'
            ? Promise.resolve(JSON.stringify({ isNew: true, volume: '1', index: '2' }))
            : Promise.reject(new Error('held handle refused')),
        )
      const creating = vi.spyOn(fs, 'mkdir')
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
      if (descriptor === undefined) throw new Error('fixture platform')
      Object.defineProperty(process, 'platform', { value: 'win32' })
      try {
        if (fault === 'created')
          await expect(privateDirectory(String.raw`C:\private\directory`, true)).resolves.toEqual({
            isNew: true,
          })
        else
          await expect(privateDirectory(String.raw`C:\private\directory`, true)).rejects.toThrow(
            'ELSP_PRIVATE',
          )
        expect(creating).not.toHaveBeenCalled()
        expect(runner).toHaveBeenCalledOnce()
        const call = runner.mock.calls[0]
        const script = Buffer.from(call?.[1].at(-1) ?? '', 'base64').toString('utf16le')
        expect(script).toContain('[MuseSparkPrivateDirectory]::Verify($inputData.directory, $true)')
        expect(script).not.toContain('Set-Acl')
        expect(call?.[2]).not.toHaveProperty('META_API_KEY')
      } finally {
        Object.defineProperty(process, 'platform', descriptor)
        creating.mockRestore()
        runner.mockRestore()
      }
    },
  )

  it.each(['valid', 'foreignOwner', 'foreignGrant', 'deny', 'partial', 'unprotected'])(
    'verifies Windows ACL %s without rewriting an existing directory or record',
    async (fault) => {
      const directory = path.join(folder, `windows-${fault}`)
      await mkdir(directory, { mode: 0o700 })
      const record = path.join(directory, 'owner.json')
      await writeFile(record, '{}', { mode: 0o600 })
      const receipt = {
        owner: fault === 'foreignOwner' ? 'other' : 'self',
        current: 'self',
        protected: fault !== 'unprotected',
        rules: [
          {
            sid: fault === 'foreignGrant' ? 'other' : 'self',
            allow: fault !== 'deny',
            full: fault !== 'partial',
          },
        ],
      }
      const runner = vi.spyOn(processTree, 'runProgram').mockImplementation((_file, args) => {
        const script = Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le')
        if (script.includes('[MuseSparkPrivateDirectory]::Verify')) {
          return fault === 'valid'
            ? Promise.resolve(JSON.stringify({ isNew: false, volume: '1', index: '2' }))
            : Promise.reject(new Error('native refused'))
        }
        return Promise.resolve(JSON.stringify(receipt))
      })
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
      if (descriptor === undefined) throw new Error('fixture platform')
      Object.defineProperty(process, 'platform', { value: 'win32' })
      try {
        if (fault === 'valid') {
          await privateDirectory(directory)
          const handle = await openPrivateRecord(record)
          await handle.close()
        } else {
          await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
          await expect(openPrivateRecord(record)).rejects.toThrow('ELSP_PRIVATE')
        }
        for (const call of runner.mock.calls) {
          const script = Buffer.from(call[1].at(-1) ?? '', 'base64').toString('utf16le')
          expect(script).toMatch(/Get-Acl|MuseSparkPrivateDirectory/u)
          expect(script).not.toContain('Set-Acl')
          expect(call[2]).not.toHaveProperty('META_API_KEY')
        }
      } finally {
        Object.defineProperty(process, 'platform', descriptor)
        runner.mockRestore()
      }
    },
  )
  it.runIf(process.platform !== 'win32')(
    'refuses existing broad directory permissions without repairing them',
    async () => {
      const directory = path.join(folder, 'broad')
      await mkdir(directory, { mode: 0o755 })
      await chmod(directory, 0o755)
      await expect(privateDirectory(directory, true)).rejects.toThrow('ELSP_PRIVATE')
      const unchanged = await lstat(directory)
      expect(unchanged.mode & 0o777).toBe(0o755)
    },
  )
})
