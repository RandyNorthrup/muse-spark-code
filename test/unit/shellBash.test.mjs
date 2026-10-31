// The Bourne shell the installer tests run in (helpers/shellBash.mjs). On
// Windows it is Git's bash.exe under Program Files; where Git lives elsewhere
// the helper finds the sh.exe beside the git on PATH. That second route threw
// `resolveExecutable is not a function` (the helper imported it from a module
// that does not export it), so these tests start the shell the helper names.
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { testBash } from './helpers/shellBash'
import { removeFolder } from './helpers/temporaryFolders'

const folders = []
afterAll(async () => {
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

/** What a shell prints for a one-word script, started the way the installer tests start it. */
function said(shell) {
  const result = spawnSync(shell, ['-c', 'echo muse'], { encoding: 'utf8', windowsHide: true })
  return { status: result.status, stdout: result.stdout.trim() }
}

describe('the installer tests’ Bourne shell', () => {
  it('is a shell that runs a script', () => {
    expect(said(testBash())).toEqual({ status: 0, stdout: 'muse' })
  })

  it.runIf(process.platform === 'win32')(
    'is found through git on PATH when Program Files has no Git',
    () => {
      const empty = mkdtempSync(path.join(tmpdir(), 'muse-no-git-'))
      folders.push(empty)
      const saved = process.env.ProgramFiles
      process.env.ProgramFiles = empty
      try {
        const shell = testBash()
        // Not the bare `bash` it falls back to when Git is nowhere: Git's own sh.exe.
        expect(shell).toMatch(/[\\/]usr[\\/]bin[\\/]sh\.exe$/u)
        expect(said(shell)).toEqual({ status: 0, stdout: 'muse' })
      } finally {
        if (saved === undefined) delete process.env.ProgramFiles
        else process.env.ProgramFiles = saved
      }
    },
  )
})
