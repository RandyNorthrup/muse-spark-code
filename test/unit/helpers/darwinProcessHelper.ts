import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { removeFolder } from './temporaryFolders'

/** Build/sign the production sources in a private fixture, including on a clean Mac checkout. */
export async function darwinProcessHelper(): Promise<{
  helperPath: string
  remove: () => Promise<void>
}> {
  const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-native-helper-'))
  const native = path.join(folder, 'native', 'darwin')
  try {
    await mkdir(native, { recursive: true })
    for (const file of ['Dictation.swift', 'Info.plist', 'build.sh'])
      await copyFile(path.resolve('native/darwin', file), path.join(native, file))
    await copyFile(path.resolve('package.json'), path.join(folder, 'package.json'))
    await promisify(execFile)('/bin/bash', [path.join(native, 'build.sh')], {
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      timeout: 120_000,
    })
    return { helperPath: path.join(native, 'muse-dictate'), remove: () => removeFolder(folder) }
  } catch (error: unknown) {
    await removeFolder(folder)
    throw error
  }
}
