import { chmod, link, lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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
  it.runIf(process.platform === 'darwin')('refuses a macOS extended ACL receipt', async () => {
    const runner = vi
      .spyOn(processTree, 'runProgram')
      .mockResolvedValue('drwx------+ 1 owner group 0 directory\n 0: user:other allow read\n')
    try {
      await expect(privateDirectory(folder)).rejects.toThrow('ELSP_PRIVATE')
    } finally {
      runner.mockRestore()
    }
  })
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
      const runner = vi.spyOn(processTree, 'runProgram').mockResolvedValue(JSON.stringify(receipt))
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
          expect(script).toContain('Get-Acl')
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
