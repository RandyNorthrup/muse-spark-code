import { execFile } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { removeFolder } from './temporaryFolders'

// build.sh's own outputs; a developer Mac may hold them from an earlier build.
const BUILT = /(?:^|[/\\])muse-dictate(?:-screen\.app|-screen\.tgz)?$/u

/** Build/sign the production sources in a private fixture, including on a clean Mac checkout. */
export async function darwinProcessHelper(): Promise<{
  helperPath: string
  remove: () => Promise<void>
}> {
  const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-native-helper-'))
  const native = path.join(folder, 'native', 'darwin')
  const posix = path.join(folder, 'native', 'posix')
  try {
    // build.sh compiles every source beside it (M105 screen recording, M109
    // vault) and localizes the screen app from its .lproj folders and the UI
    // tables, so the fixture holds the whole folder rather than a file list.
    // The vault-peer block compiles beside it from ../../native/posix, so
    // that folder is staged too, with the broker peer source it includes.
    await mkdir(native, { recursive: true })
    await cp(path.resolve('native/darwin'), native, {
      recursive: true,
      filter: (source) => !BUILT.test(source),
    })
    await mkdir(posix, { recursive: true })
    await cp(path.resolve('native/posix'), posix, { recursive: true })
    const peerDir = path.join(folder, 'src', 'core', 'vault', 'broker')
    await mkdir(peerDir, { recursive: true })
    await copyFile(
      path.resolve('src', 'core', 'vault', 'broker', 'peer.c'),
      path.join(peerDir, 'peer.c'),
    )
    await mkdir(path.join(folder, 'l10n'))
    const tables = await readdir('l10n')
    for (const file of tables)
      if (/^ui\.[a-z-]+\.json$/u.test(file))
        await copyFile(path.resolve('l10n', file), path.join(folder, 'l10n', file))
    await copyFile(path.resolve('package.json'), path.join(folder, 'package.json'))
    await promisify(execFile)('/bin/bash', [path.join(native, 'build.sh')], {
      // build.sh runs `node` for the bundle's localized Info.plist.
      env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: 'C' },
      timeout: 120_000,
    })
    return { helperPath: path.join(native, 'muse-dictate'), remove: () => removeFolder(folder) }
  } catch (error: unknown) {
    await removeFolder(folder)
    throw error
  }
}
