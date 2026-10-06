import './helpers/lspPrivateDirectoryMock'
import { chmod, link, lstat, mkdir, mkdtemp, writeFile, readFile, rename } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as processTree from '../../src/host/processTree'
import {
  openPrivateRecord,
  privateDirectory,
  writePrivateRecord,
} from '../../src/runtime/lsp/registry'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../src/host/processTree', async (importOriginal) => ({
  ...(await importOriginal<typeof processTree>()),
}))
vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

const folder = await mkdtemp(path.join(tmpdir(), 'muse-registry-'))
afterAll(() => removeFolder(folder))

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
    'uses no-follow fstat and refuses a foreign directory owner without a path restat',
    async () => {
      const directory = path.join(folder, 'foreign-directory')
      await mkdir(directory, { mode: 0o700 })
      const handle = await fs.open(directory, 0)
      const metadata = await handle.stat({ bigint: true })
      metadata.uid += 1n
      const inspecting = vi.spyOn(handle, 'stat').mockResolvedValue(metadata)
      const opening = vi.spyOn(fs, 'open').mockResolvedValueOnce(handle)
      const restating = vi.spyOn(fs, 'lstat')
      try {
        await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
        expect(opening).toHaveBeenCalledWith(directory, expect.any(Number))
        expect(restating).not.toHaveBeenCalled()
      } finally {
        inspecting.mockRestore()
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
      const handle = await fs.open(directory, 0)
      const metadata = await handle.stat({ bigint: true })
      metadata.ino += 1n
      const inspecting = vi.spyOn(handle, 'stat').mockResolvedValue(metadata)
      const opening = vi.spyOn(fs, 'open').mockResolvedValueOnce(handle)
      try {
        await expect(privateDirectory(directory)).rejects.toThrow('ELSP_PRIVATE')
      } finally {
        inspecting.mockRestore()
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
    expect(helper).toContain('!current.Equals(security.Owner)')
    expect(helper).toContain('DiscretionaryAclProtected) == 0')
    expect(helper).toContain(
      '!current.Equals(ace.SecurityIdentifier) && !system.Equals(ace.SecurityIdentifier)',
    )
    expect(helper).toContain('SHARE_READ_WRITE = 3')
    expect(helper).not.toContain('Set-Acl')
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
