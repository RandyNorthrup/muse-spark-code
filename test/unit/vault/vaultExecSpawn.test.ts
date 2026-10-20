import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vaultPrivateDirectory } from '../../../src/core/vault/broker/files'
import { prepareVaultExecHelperPaths } from '../../../src/host/vault/vaultExecSpawn'
import { denyWrites } from '../helpers/deniedAccess'

// The exec helper paths over real directories: created owner-only, removed
// on close, and a failed write removes the half-built folder while the
// original failure still rejects.
describe('vault exec helper paths', () => {
  it('writes the refusing and askpass helpers, then removes them on close', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vs-exec-helpers-'))
    try {
      const helpers = await prepareVaultExecHelperPaths(
        root,
        '/opt/node',
        '/opt/entry.js',
        'endpoint',
        process.platform,
        (dir) => vaultPrivateDirectory(dir),
      )
      try {
        expect(helpers.gitHelper).toContain('endpoint')
        const refusing = process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n'
        expect(await readFile(helpers.refusingHelper, 'utf8')).toBe(refusing)
        if (process.platform !== 'win32')
          expect(await readFile(helpers.askpassPath, 'utf8')).toContain('askpass')
      } finally {
        await helpers.close()
      }
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('a refused helper write removes the folder and rejects with the refusal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vs-exec-refused-'))
    try {
      // The kernel refuses the write for real: the folder is read-only after
      // the owner-only protection below runs (mode 0555, or on Windows a
      // denial of new entries).
      await expect(
        prepareVaultExecHelperPaths(
          root,
          '/opt/node',
          '/opt/entry.js',
          'endpoint',
          process.platform,
          async (dir) => {
            await vaultPrivateDirectory(dir)
            if (dir !== root) await denyWrites(dir)
          },
        ),
      ).rejects.toBeInstanceOf(Error)
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
