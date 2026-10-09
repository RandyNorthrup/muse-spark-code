import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  mcpJobExecutable,
  mcpJobExecutableName,
  sealedMcpJobExecutable,
} from '../../src/host/backend/mcpJobExecutable'
import { isResourceHelperChanged } from '../../src/host/backend/helperIntegrity'
import type { RunProgram } from '../../src/host/processTree'
import { SHELL_JOB_FOLDER } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { readJobSource } from './helpers/jobSource'

const paths = { root: '' }

/** The rejection a promise settles with, or undefined when it resolves. */
async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending
    return undefined
  } catch (error: unknown) {
    return error
  }
}

beforeAll(async () => {
  paths.root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-mcp-executable-test-')))
})

afterAll(() => removeFolder(paths.root))

describe('M50 compiled Windows job executable', () => {
  it('compiles once and leaves M27 shell-job DLLs alone', async () => {
    const storageDir = await mkdtemp(path.join(paths.root, 'ready-'))
    const folder = path.join(storageDir, SHELL_JOB_FOLDER)
    await mkdir(folder)
    await writeFile(path.join(folder, 'MuseSparkMcpJob-old.exe'), 'stale')
    await writeFile(path.join(folder, 'MuseSparkJob-live.dll'), 'M27')
    const scripts: string[] = []
    const run: RunProgram = async (_file, args) => {
      if (args[0] === '--self-test') return 'muse-spark-mcp-job-ready\n'
      const script = args.join('\n')
      scripts.push(script)
      const output = args.find((arg) => arg.startsWith('/out:'))?.slice('/out:'.length)
      if (output === undefined) throw new Error('compiler output was not named')
      await writeFile(output, 'executable')
      return ''
    }
    const logged: string[] = []
    const deps = {
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message: string) => {
        logged.push(message)
      },
      run,
    }
    const ready = mcpJobExecutable(deps)
    const name = mcpJobExecutableName(await readJobSource('mcpLauncher'))
    const executable = path.join(folder, name)
    expect(await ready()).toBe(executable)
    expect(await ready()).toBe(executable)
    const left = await readdir(folder)
    expect(left.toSorted((a, b) => a.localeCompare(b))).toEqual(
      ['MuseSparkJob-live.dll', name].toSorted((a, b) => a.localeCompare(b)),
    )
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('/target:exe')
    expect(scripts[0]).toContain(
      String.raw`/reference:C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Runtime.Serialization.dll`,
    )
    expect(scripts[0]).toContain(
      String.raw`/reference:C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Xml.dll`,
    )
    expect(logged).toEqual([])
    let didRunAgain = false
    expect(
      await mcpJobExecutable({
        ...deps,
        run: (_file, args) => {
          if (args[0] === '--self-test') return Promise.resolve('muse-spark-mcp-job-ready\n')
          didRunAgain = true
          throw new Error('a cached executable must not be recompiled')
        },
      })(),
    ).toBe(executable)
    expect(didRunAgain).toBe(false)
  })

  it('refuses a changed helper before use and recompiles it on the next call', async () => {
    const storageDir = await mkdtemp(path.join(paths.root, 'sealed-'))
    let compiles = 0
    let selfTests = 0
    const run: RunProgram = async (_file, args) => {
      if (args[0] === '--self-test') {
        selfTests++
        return 'muse-spark-mcp-job-ready\n'
      }
      compiles++
      const output = args.find((arg) => arg.startsWith('/out:'))?.slice('/out:'.length)
      if (output === undefined) throw new Error('compiler output was not named')
      await writeFile(output, 'executable')
      return ''
    }
    const logged: string[] = []
    const deps = {
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message: string) => {
        logged.push(message)
      },
      run,
    }
    const sealed = sealedMcpJobExecutable(deps)
    const helper = await sealed()
    if (helper === undefined) throw new Error('helper unavailable')
    await helper.verify()
    // Same bytes in a new file (another identity) are still the self-tested helper.
    const bytes = await readFile(helper.path)
    await rm(helper.path)
    await writeFile(helper.path, bytes)
    await helper.verify()
    // Changed bytes are refused, typed, and never handed out, even when the
    // writer kept the size and put the file's times back (any same-user process can).
    const atSeconds = 1_700_000_000
    await utimes(helper.path, atSeconds, atSeconds)
    await helper.verify()
    const before = await stat(helper.path, { bigint: true })
    await writeFile(helper.path, 'EXECUTABLE')
    await utimes(helper.path, atSeconds, atSeconds)
    const after = await stat(helper.path, { bigint: true })
    // The metadata a stat check would compare is identical; only the bytes differ.
    expect([after.ino, after.size, after.mtimeNs, after.birthtimeNs]).toEqual([
      before.ino,
      before.size,
      before.mtimeNs,
      before.birthtimeNs,
    ])
    const failure = await rejectionOf(helper.verify())
    expect(isResourceHelperChanged(failure)).toBe(true)
    // The next call re-prepares: the file is compiled again, then self-tested.
    const next = await sealed()
    expect(next?.path).toBe(helper.path)
    expect(compiles).toBe(2)
    expect(selfTests).toBe(2)
    expect(await readFile(helper.path, 'utf8')).toBe('executable')
    // The path factory refuses a changed helper (undefined: fail closed) the same way.
    const pathFactory = mcpJobExecutable(deps)
    expect(await pathFactory()).toBe(helper.path)
    await writeFile(helper.path, 'replaced!!')
    expect(await pathFactory()).toBeUndefined()
    expect(logged.some((line) => line.includes('changed and is refused'))).toBe(true)
  })

  it('fails closed when the compiler cannot build the launcher', async () => {
    const storageDir = await mkdtemp(path.join(paths.root, 'broken-'))
    const logged: string[] = []
    let compiles = 0
    const ready = mcpJobExecutable({
      readJobSource,
      storageDir,
      systemRoot: String.raw`C:\Windows`,
      log: (message) => {
        logged.push(message)
      },
      run: () => {
        compiles++
        return Promise.reject(new Error('compiler unavailable'))
      },
    })
    expect(await ready()).toBeUndefined()
    // Unavailable stays unavailable for this binding: no compile per launch.
    expect(await ready()).toBeUndefined()
    expect(compiles).toBe(1)
    expect(logged).toEqual([
      expect.stringContaining(
        'Windows MCP job executable is unavailable (Error: compiler unavailable)',
      ),
    ])
    expect(await readdir(path.join(storageDir, SHELL_JOB_FOLDER))).toEqual([])
  })

  it.skipIf(process.platform !== 'win32')(
    'rejects a corrupt cached executable before any MCP server can use it',
    async () => {
      const storageDir = await mkdtemp(path.join(paths.root, 'corrupt-'))
      const folder = path.join(storageDir, SHELL_JOB_FOLDER)
      await mkdir(folder)
      await writeFile(
        path.join(folder, mcpJobExecutableName(await readJobSource('mcpLauncher'))),
        'not a Windows executable',
      )
      const logged: string[] = []
      const ready = mcpJobExecutable({
        readJobSource,
        storageDir,
        systemRoot: process.env['SystemRoot'] ?? '',
        log: (message) => {
          logged.push(message)
        },
      })
      expect(await ready()).toBeUndefined()
      expect(logged.join('\n')).toContain('self-test')
    },
  )
})
