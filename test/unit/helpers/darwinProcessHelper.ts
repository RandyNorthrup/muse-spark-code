import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { removeFolder } from './temporaryFolders'

/** Build/sign the production sources in a private fixture, including on a clean Mac checkout. */
export async function darwinProcessHelper(): Promise<{
  helperPath: string
  remove: () => Promise<void>
}> {
  // Source-keyed worktree cache: concurrent native suites share one expensive
  // universal build, while every fixture still gets its own signed artifact.
  const sources = ['Dictation.swift', 'Info.plist', 'build.sh']
  const contents = await Promise.all(
    sources.map((file) => readFile(path.resolve('native/darwin', file))),
  )
  const manifest = await readFile(path.resolve('package.json'))
  const hash = createHash('sha256')
  for (const bytes of [...contents, manifest]) hash.update(bytes)
  const cache = path.resolve('temp', 'darwin-helper-cache', hash.digest('hex'))
  const artifact = path.join(cache, 'native', 'darwin', 'muse-dictate')
  await mkdir(path.dirname(cache), { recursive: true })
  let isBuilder = false
  try {
    await mkdir(cache, { mode: 0o700 })
    isBuilder = true
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  if (isBuilder) {
    try {
      const native = path.dirname(artifact)
      await mkdir(native, { recursive: true })
      for (const [index, file] of sources.entries()) {
        const bytes = contents[index]
        if (bytes === undefined) throw new Error('missing native source')
        await writeFile(path.join(native, file), bytes)
      }
      await writeFile(path.join(cache, 'package.json'), manifest)
      await promisify(execFile)('/bin/bash', [path.join(native, 'build.sh')], {
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        timeout: 120_000,
      })
      await writeFile(path.join(cache, 'ready'), '')
    } catch (error: unknown) {
      await removeFolder(cache)
      throw error
    }
  } else {
    // Build time is setup, outside each test's unchanged five-second deadline.
    const deadline = Date.now() + 120_000
    for (;;) {
      try {
        await readFile(path.join(cache, 'ready'))
        break
      } catch {
        if (Date.now() >= deadline) throw new Error('native cache build did not finish')
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25)
      })
    }
  }
  const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-native-helper-'))
  const native = path.join(folder, 'native', 'darwin')
  try {
    // build.sh compiles every source beside it (M105 screen recording, M109
    // vault) and localizes the screen app from its .lproj folders and the UI
    // tables, so the fixture holds the whole folder rather than a file list.
    await mkdir(native, { recursive: true })
    const helperPath = path.join(native, 'muse-dictate')
    await copyFile(artifact, helperPath)
    return { helperPath, remove: () => removeFolder(folder) }
  } catch (error: unknown) {
    await removeFolder(folder)
    throw error
  }
}
