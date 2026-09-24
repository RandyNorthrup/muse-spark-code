// The Windows job helper (M27): compiled once into the storage folder and
// reused, earlier versions removed, a self-test before any command relies
// on it, and the statement each command starts with. Windows PowerShell is
// stood in for, so this runs on every OS; the real compile and kill are in
// processTree.test.ts.

import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  joinStatement,
  newShellJob,
  shellJobAssembly,
  shellJobAssemblyName,
} from '../../src/host/backend/shellJob'
import { shellArguments } from '../../src/host/backend/toolIo'
import type { RunProgram } from '../../src/host/processTree'
import {
  SHELL_JOB_FOLDER,
  SHELL_JOB_NAME_PREFIX,
  WINDOWS_POWERSHELL_UTF8_PREAMBLE,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '' }

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'muse-shelljob-'))
})

afterAll(() => removeFolder(paths.root))

/** A stand-in Windows PowerShell: `Add-Type -OutputAssembly` writes the file, the self-test answers. */
function fakePowerShell(selfTest = 'joined\r\n') {
  const scripts: string[] = []
  const run: RunProgram = async (_file, args) => {
    const script = args.at(-1) ?? ''
    scripts.push(script)
    const output = /-OutputAssembly '([^']+)'/.exec(script)?.[1]
    if (output !== undefined) {
      await writeFile(output, 'assembly')
      return ''
    }
    return selfTest
  }
  return { run, scripts }
}

function storage(name: string): Promise<string> {
  return mkdtemp(path.join(paths.root, `${name}-`))
}

describe('shellJobAssembly (M27)', () => {
  it('compiles once, removes earlier versions and reuses the assembly afterwards', async () => {
    const storageDir = await storage('fresh')
    const folder = path.join(storageDir, SHELL_JOB_FOLDER)
    // An assembly of an earlier source, and a file that is not one.
    await mkdir(folder)
    await writeFile(path.join(folder, 'MuseSparkJob-0000000000000000.dll'), 'old')
    await writeFile(path.join(folder, 'notes.txt'), 'kept')
    const powershell = fakePowerShell()
    const logged: string[] = []
    const ready = shellJobAssembly({
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message) => {
        logged.push(message)
      },
      run: powershell.run,
    })
    const assembly = await ready()
    expect(assembly).toBe(path.join(folder, shellJobAssemblyName()))
    expect(await ready()).toBe(assembly)
    const left = await readdir(folder)
    expect(left.toSorted((a, b) => a.localeCompare(b))).toEqual([
      shellJobAssemblyName(),
      'notes.txt',
    ])
    // One compile, one self-test, however often it is asked.
    expect(powershell.scripts).toHaveLength(2)
    expect(powershell.scripts[0]).toContain('-OutputType Library')
    expect(powershell.scripts[1]).toContain(`::Join('${SHELL_JOB_NAME_PREFIX}`)
    expect(logged).toEqual([])
    // A later window finds it compiled and only tests it.
    const later = fakePowerShell()
    await shellJobAssembly({
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: () => undefined,
      run: later.run,
    })()
    expect(later.scripts).toHaveLength(1)
    expect(later.scripts[0]).toContain('::Join(')
  })

  it('says jobs are unavailable, and gives no assembly, when the self-test fails', async () => {
    const storageDir = await storage('locked')
    const logged: string[] = []
    const assembly = await shellJobAssembly({
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message) => {
        logged.push(message)
      },
      run: fakePowerShell(
        'Cannot add type. Definition of new types is not supported in this language mode.',
      ).run,
    })()
    expect(assembly).toBeUndefined()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(
      /^Windows job objects are unavailable \(Error: the self-test answered "Cannot add type/,
    )
    expect(logged[0]).toContain('ended with taskkill and a sweep for its orphans')
  })

  it('says so when the compile itself fails, leaving no half-made file', async () => {
    const storageDir = await storage('broken')
    const logged: string[] = []
    const assembly = await shellJobAssembly({
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message) => {
        logged.push(message)
      },
      run: () => Promise.reject(new Error('csc.exe exited with code 1')),
    })()
    expect(assembly).toBeUndefined()
    expect(logged[0]).toContain('csc.exe exited with code 1')
    expect(await readdir(path.join(storageDir, SHELL_JOB_FOLDER))).toEqual([])
  })
})

describe('the statement a command joins its job with (M27)', () => {
  it('quotes the assembly path and swallows a failure, first in the command line', () => {
    const job = {
      name: String.raw`Local\MuseSparkShell-1`,
      assemblyPath: String.raw`C:\Users\O'Brien\job.dll`,
    }
    expect(joinStatement(job)).toBe(
      String.raw`try { Add-Type -Path 'C:\Users\O''Brien\job.dll'; [MuseSparkJob]::Join('Local\MuseSparkShell-1') } catch { }; `,
    )
    expect(shellArguments('win32', 'Write-Output ok', job).at(-1)).toBe(
      `${joinStatement(job)}${WINDOWS_POWERSHELL_UTF8_PREAMBLE}Write-Output ok`,
    )
    expect(shellArguments('win32', 'Write-Output ok').at(-1)).toBe(
      `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}Write-Output ok`,
    )
  })

  it('names every job afresh', () => {
    const first = newShellJob('a.dll')
    const second = newShellJob('a.dll')
    expect(first.name.startsWith(SHELL_JOB_NAME_PREFIX)).toBe(true)
    expect(first.name).not.toBe(second.name)
  })
})
