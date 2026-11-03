// The name a Windows vault root goes by in the OS store. `vaultRootHash` names the
// anchor and audit accounts, and a vault reached under another name misses its own
// records and refuses to open. The name is a pure function of the path's spelling, so
// this suite loads no keyring and starts no broker: the real store's cases are in
// test/unit/vault/vaultStoreScope.test.ts.
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentDataFolder } from '../../src/runtime/dataFolder'
import {
  vaultAnchorAccount,
  vaultBrokerDataDir,
  vaultRootHash,
} from '../../src/runtime/vault/vaultStoreScope'
import { removeFolder } from './helpers/temporaryFolders'

const HOME = String.raw`C:\Users\Someone`
const LOCAL_APP_DATA = String.raw`C:\Users\Someone\AppData\Local`

describe.skipIf(process.platform !== 'win32')('the name a Windows vault root goes by', () => {
  it('is one name for every separator, letter-case and dot spelling of the folder', () => {
    const root = vaultBrokerDataDir(
      agentDataFolder({
        platform: 'win32',
        env: { LOCALAPPDATA: LOCAL_APP_DATA },
        homeDir: HOME,
      }),
    )
    for (const spelling of [
      root.toLowerCase(),
      root.toUpperCase(),
      root.replaceAll(path.win32.sep, '/'),
      `${root}${path.win32.sep}`,
      [root, 'audit', '..'].join(path.win32.sep),
    ])
      expect(vaultRootHash(spelling), spelling).toBe(vaultRootHash(root))
  })

  it('is one name whichever way a client finds the data folder', () => {
    // Every client takes this one route: LOCALAPPDATA, else the home folder's AppData\Local.
    const fromEnvironment = agentDataFolder({
      platform: 'win32',
      env: { LOCALAPPDATA: LOCAL_APP_DATA },
      homeDir: HOME,
    })
    const fromHome = agentDataFolder({ platform: 'win32', env: {}, homeDir: HOME.toLowerCase() })
    expect(vaultAnchorAccount(vaultBrokerDataDir(fromHome))).toBe(
      vaultAnchorAccount(vaultBrokerDataDir(fromEnvironment)),
    )
  })

  // Resolving links here would rename the records of a vault whose folder is reached
  // through one, and moving a folder behind a link would then lose them.
  it('reads no file system: a junction keeps its name, whatever it reaches', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'vs-name-'))
    try {
      const folder = path.join(scratch, 'folder')
      const junction = path.join(scratch, 'junction')
      await mkdir(folder)
      await symlink(folder, junction, 'junction')
      expect(realpathSync.native(junction)).toBe(realpathSync.native(folder))
      const name = vaultRootHash(junction)
      expect(name).not.toBe(vaultRootHash(folder))
      await rm(junction, { force: true })
      expect(vaultRootHash(junction)).toBe(name)
    } finally {
      await removeFolder(scratch)
    }
  })

  // Hosted Windows' TEMP goes through a short name (RUNNER~1), and so does this suite's there.
  it('reads no file system: a short name is named as spelled', () => {
    const given = tmpdir()
    const long = realpathSync.native(given)
    expect(vaultRootHash(given) === vaultRootHash(long)).toBe(
      given.toLowerCase() === long.toLowerCase(),
    )
  })
})
